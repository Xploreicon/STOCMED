'use client';

import { Button } from '@/components/ui/button'

import React, { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useUser } from '@/hooks/useUser';
import { AlertTriangle, FileText, Clock, CheckCircle, XCircle, Eye, Loader2, ClipboardCheck } from 'lucide-react';
import { toast } from 'sonner';

function InventoryMatcher({ productName }: { productName: string }) {
  const [matchingOutlets, setMatchingOutlets] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!productName) return;

    const findMatches = async () => {
      setLoading(true);
      try {
        const supabase = createClient();
        const parts = productName.split(/[,+]/).map(p => p.trim()).filter(Boolean);
        if (parts.length === 0) return;

        let matches: any[] = [];
        for (const part of parts) {
          const { data, error } = await supabase
            .from('pharmacy_inventory')
            .select(`
              price,
              quantity_in_stock,
              pharmacies!inner (
                pharmacy_name,
                address,
                city
              ),
              products!inner (
                brand_name,
                generic_name
              )
            `)
            .or(`brand_name.ilike.%${part}%,generic_name.ilike.%${part}%`, { foreignTable: 'products' })
            .gt('quantity_in_stock', 0);

          if (!error && data) {
            matches.push(...data);
          }
        }

        const grouped: { [key: string]: any } = {};
        matches.forEach(m => {
          const pName = m.pharmacies?.pharmacy_name;
          if (!pName) return;
          if (!grouped[pName]) {
            grouped[pName] = {
              name: pName,
              address: m.pharmacies.address,
              city: m.pharmacies.city,
              items: [],
            };
          }
          grouped[pName].items.push({
            name: m.products?.brand_name || m.products?.generic_name,
            qty: m.quantity_in_stock,
            price: m.price,
          });
        });

        setMatchingOutlets(Object.values(grouped));
      } catch (err) {
        console.error('Matching inventory error:', err);
      } finally {
        setLoading(false);
      }
    };

    findMatches();
  }, [productName]);

  if (loading) {
    return <span className="text-[10px] text-ink-light mt-1.5 block">Checking stocking outlets...</span>;
  }

  if (matchingOutlets.length === 0) {
    return <span className="mt-1.5 inline-flex items-center gap-1 text-[10px] font-semibold text-amber-600"><AlertTriangle className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />No outlets currently in stock.</span>;
  }

  return (
    <div className="space-y-1.5 mt-2.5">
      <span className="text-[10px] font-bold text-ink-light uppercase tracking-wider block">Stocking Outlets ({matchingOutlets.length})</span>
      <div className="space-y-1.5 bg-surface border border-surface p-2.5 rounded-xl max-h-32 overflow-y-auto">
        {matchingOutlets.map((outlet, i) => (
          <div key={i} className="text-[11px] border-b border-surface last:border-0 pb-1.5 last:pb-0">
            <span className="font-bold text-ink">{outlet.name}</span>
            <span className="text-ink-light block text-[10px]">{outlet.address}, {outlet.city}</span>
            <div className="flex flex-wrap gap-1 mt-1">
              {outlet.items.map((item: any, j: number) => (
                <span key={j} className="bg-white border border-border text-ink px-1.5 py-0.5 rounded text-[9px] font-medium font-sans">
                  {item.name} ({item.qty} in stock)
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function RxQueuePage() {
  const { user } = useUser();
  const [submissions, setSubmissions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSub, setSelectedSub] = useState<any | null>(null);
  const [reviewNotes, setReviewNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [signedFileUrl, setSignedFileUrl] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>('all');

  const supabase = createClient();

  const fetchSubmissions = React.useCallback(async () => {
    try {
      let query = (supabase.from('rx_submissions') as any).select('*');

      if (filterStatus !== 'all') {
        query = query.eq('status', filterStatus);
      }

      const { data, error } = await query.order('created_at', { ascending: true });

      if (error) throw error;
      setSubmissions(data || []);
    } catch (err: any) {
      console.error('Error fetching submissions:', err);
      toast.error('Failed to load prescription submissions.');
    } finally {
      setLoading(false);
    }
  }, [filterStatus, supabase]);

  useEffect(() => {
    fetchSubmissions();

    // Subscribe to real-time changes
    const channel = supabase
      .channel('rx_submission_updates')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'rx_submissions' },
        () => {
          fetchSubmissions();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchSubmissions, supabase]);

  // Securely resolve signed URLs for private prescription storage (NDPR Privacy Compliance)
  useEffect(() => {
    if (!selectedSub || !selectedSub.file_url) {
      setSignedFileUrl(null);
      return;
    }

    const resolveSignedUrl = async () => {
      try {
        const { data, error } = await supabase.storage
          .from('prescriptions')
          .createSignedUrl(selectedSub.file_url, 600); // 10 minute token

        if (error) throw error;
        setSignedFileUrl(data.signedUrl);
      } catch (err) {
        console.error('Failed to resolve signed URL:', err);
        setSignedFileUrl(null);
      }
    };

    resolveSignedUrl();
  }, [selectedSub, supabase]);

  const handleReview = async (status: 'verified' | 'rejected') => {
    if (!selectedSub || !user) return;

    setIsSubmitting(true);
    try {
      const { error } = await (supabase.from('rx_submissions') as any)
        .update({
          status,
          review_notes: reviewNotes || null,
          reviewed_by: user.id,
          updated_at: new Date().toISOString(),
        })
        .eq('id', selectedSub.id);

      if (error) throw error;

      toast.success(`Prescription marked as ${status}!`);
      setReviewNotes('');
      setSelectedSub(null);
      fetchSubmissions();
    } catch (err: any) {
      console.error('Error reviewing prescription:', err);
      toast.error('Failed to save review status.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between border-b border-border pb-4">
        <div>
          <h1 className="text-2xl font-bold font-display text-ink">
            Prescription Queue (Rx Verification)
          </h1>
          <p className="text-sm text-surface0 mt-1">
            Review uploaded patient doctor prescriptions and verify POM access tokens.
          </p>
        </div>

        {/* Filter controls */}
        <div className="flex items-center space-x-2">
          <span className="text-xs font-semibold text-surface0">Filter status:</span>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="text-xs bg-white border border-border rounded-lg p-2 font-medium"
          >
            <option value="all">All submissions</option>
            <option value="submitted">Submitted</option>
            <option value="verified">Verified</option>
            <option value="rejected">Rejected</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Submissions List Column */}
        <div className="lg:col-span-2 space-y-3">
          {loading ? (
            <div className="flex flex-col items-center justify-center p-20 bg-white border border-border rounded-2xl">
              <Loader2 className="w-8 h-8 text-blue-600 animate-spin mb-3" />
              <span className="text-sm text-surface0">Syncing prescription queue...</span>
            </div>
          ) : submissions.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-20 bg-white border border-border border-dashed rounded-2xl">
              <FileText className="w-12 h-12 text-border mb-3" />
              <span className="text-sm font-semibold text-ink-muted">No submissions found</span>
              <span className="text-xs text-ink-light mt-1">Everything is clear for this filter status.</span>
            </div>
          ) : (
            submissions.map((item) => (
              <div
                key={item.id}
                onClick={() => setSelectedSub(item)}
                className={`p-4 bg-white border rounded-xl shadow-sm hover:shadow-md cursor-pointer transition-all flex items-start justify-between ${
                  selectedSub?.id === item.id ? 'border-2 border-blue-600' : 'border-border'
                }`}
              >
                <div className="space-y-1.5 text-left">
                  <div className="flex items-center space-x-2">
                    <span className="text-xs font-bold text-ink">Rx Review</span>
                    <span
                      className={`text-[10px] uppercase font-bold tracking-wide px-2 py-0.5 rounded-full ${
                        item.status === 'submitted'
                          ? 'bg-amber-100 text-amber-800'
                          : item.status === 'verified'
                          ? 'bg-green-100 text-green-800'
                          : 'bg-red-100 text-red-800'
                      }`}
                    >
                      {item.status}
                    </span>
                  </div>

                  <p className="text-xs text-ink-muted font-semibold">
                    Medication: <span className="text-ink font-bold">{item.product_name}</span>
                  </p>

                  <div className="flex items-center space-x-3 text-[11px] text-ink-light font-medium">
                    <span>Submitted: {new Date(item.created_at).toLocaleString()}</span>
                  </div>
                </div>

                <Button className="p-2 hover:bg-surface text-ink-light hover:text-ink rounded-lg transition-colors">
                  <Eye className="w-4 h-4" />
                </Button>
              </div>
            ))
          )}
        </div>

        {/* Selected Submission details */}
        <div className="lg:col-span-1">
          {selectedSub ? (
            <div className="bg-white border border-border rounded-2xl p-5 shadow-sm space-y-5 text-left sticky top-6">
              <div>
                <h3 className="text-sm font-bold text-ink font-display">Prescription Review</h3>
                <p className="text-[11px] text-ink-light font-mono mt-0.5">ID: {selectedSub.id}</p>
              </div>

              <div className="space-y-3.5 border-b border-surface pb-4">
                <div>
                  <span className="text-[10px] font-bold text-ink-light uppercase tracking-wider block">Target Drug</span>
                  <p className="text-xs text-ink font-bold mt-1">{selectedSub.product_name}</p>
                  <InventoryMatcher productName={selectedSub.product_name} />
                </div>

                <div>
                  <span className="text-[10px] font-bold text-ink-light uppercase tracking-wider block">Uploaded File</span>
                  {signedFileUrl ? (
                    <a
                      href={signedFileUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center space-x-1.5 text-xs text-blue-600 hover:text-blue-800 font-semibold underline mt-1.5"
                    >
                      <FileText className="w-4 h-4" />
                      <span>View Uploaded Document</span>
                    </a>
                  ) : (
                    <span className="text-[10px] text-ink-light mt-1 block">Resolving secure URL...</span>
                  )}
                </div>
              </div>

              {selectedSub.status === 'submitted' ? (
                <div className="space-y-4">
                  <div>
                    <label className="block text-[10px] font-bold text-ink-light uppercase tracking-wider">
                      Reviewer Notes
                    </label>
                    <textarea
                      value={reviewNotes}
                      onChange={(e) => setReviewNotes(e.target.value)}
                      placeholder="Write validation notes (e.g. signature check, expiration validation)..."
                      className="w-full mt-1.5 p-3 text-xs bg-surface border border-border rounded-xl focus:border-blue-500 focus:bg-white focus:outline-none transition-all resize-none h-20"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <Button
                      onClick={() => handleReview('rejected')}
                      disabled={isSubmitting}
                      className="py-2.5 bg-red-50 hover:bg-red-100 text-red-700 text-xs font-semibold rounded-xl border border-red-200 flex items-center justify-center space-x-1.5 transition-all shadow-sm"
                    >
                      <XCircle className="w-4 h-4" />
                      <span>Reject Rx</span>
                    </Button>

                    <Button
                      onClick={() => handleReview('verified')}
                      disabled={isSubmitting}
                      className="py-2.5 bg-green-600 hover:bg-green-700 text-white text-xs font-semibold rounded-xl flex items-center justify-center space-x-1.5 transition-all shadow-md"
                    >
                      <CheckCircle className="w-4 h-4" />
                      <span>Approve & Verify</span>
                    </Button>
                  </div>
                </div>
              ) : (
                <div
                  className={`p-4 rounded-xl border flex items-start space-x-2.5 ${
                    selectedSub.status === 'verified'
                      ? 'bg-green-50 border-green-150 text-green-900'
                      : 'bg-red-50 border-red-150 text-red-900'
                  }`}
                >
                  {selectedSub.status === 'verified' ? (
                    <CheckCircle className="w-5 h-5 text-green-600 mt-0.5 flex-shrink-0" />
                  ) : (
                    <XCircle className="w-5 h-5 text-red-600 mt-0.5 flex-shrink-0" />
                  )}
                  <div className="text-xs">
                    <span className="font-bold block capitalize">Prescription {selectedSub.status}</span>
                    {selectedSub.review_notes && (
                      <p className="mt-1 leading-relaxed opacity-90">{selectedSub.review_notes}</p>
                    )}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="bg-surface border border-border border-dashed rounded-2xl p-8 text-center">
              <ClipboardCheck className="w-10 h-10 text-border mx-auto mb-2" />
              <span className="text-xs font-semibold text-surface0">Select an Rx submission to verify</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
