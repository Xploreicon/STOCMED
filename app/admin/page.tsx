'use client';

import React, { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useUser } from '@/hooks/useUser';
import { ClipboardList, Clock, AlertTriangle, CheckCircle, Eye, Loader2, ArrowRight } from 'lucide-react';
import { toast } from 'sonner';

export default function SymptomQueuePage() {
  const { user } = useUser();
  const [intakes, setIntakes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIntake, setSelectedIntake] = useState<any | null>(null);
  const [responseHtml, setResponseHtml] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [signedPhotoUrl, setSignedPhotoUrl] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>('all');

  const supabase = createClient();

  useEffect(() => {
    fetchIntakes();
    
    // Set up real-time subscription for intake list updates
    const channel = supabase
      .channel('symptom_intake_updates')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'symptom_intakes' },
        () => {
          fetchIntakes();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [filterStatus]);

  // Fetch signed URL for attachments securely (NDPR Compliance)
  useEffect(() => {
    if (!selectedIntake || !selectedIntake.photo_url) {
      setSignedPhotoUrl(null);
      return;
    }

    const resolveSignedUrl = async () => {
      try {
        const { data, error } = await supabase.storage
          .from('prescriptions')
          .createSignedUrl(selectedIntake.photo_url, 600); // 10 minute token

        if (error) throw error;
        setSignedPhotoUrl(data.signedUrl);
      } catch (err) {
        console.error('Failed to resolve signed URL:', err);
        setSignedPhotoUrl(null);
      }
    };

    resolveSignedUrl();
  }, [selectedIntake]);

  const fetchIntakes = async () => {
    try {
      let query = (supabase.from('symptom_intakes') as any).select('*');
      
      if (filterStatus !== 'all') {
        query = query.eq('status', filterStatus);
      }

      const { data, error } = await query.order('created_at', { ascending: true });

      if (error) throw error;
      setIntakes(data || []);
    } catch (err: any) {
      console.error('Error fetching intakes:', err);
      toast.error('Failed to load symptom intakes queue.');
    } finally {
      setLoading(false);
    }
  };

  const handleClaim = async (intakeId: string) => {
    if (!user) return;
    try {
      const { error } = await (supabase.from('symptom_intakes') as any)
        .update({
          status: 'under_review',
          assigned_pharmacist: user.id,
          updated_at: new Date().toISOString(),
        })
        .eq('id', intakeId);

      if (error) throw error;

      toast.success('Ticket claimed successfully. You are now reviewing this case.');
      
      // Update local details view
      setSelectedIntake((prev: any) => ({
        ...prev,
        status: 'under_review',
        assigned_pharmacist: user.id,
      }));
    } catch (err: any) {
      console.error('Error claiming ticket:', err);
      toast.error('Failed to claim ticket.');
    }
  };

  const handleSubmitResponse = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedIntake || !responseHtml.trim()) return;

    setIsSubmitting(true);
    try {
      const { error } = await (supabase.from('symptom_intakes') as any)
        .update({
          status: 'answered',
          pharmacist_response: responseHtml,
          updated_at: new Date().toISOString(),
        })
        .eq('id', selectedIntake.id);

      if (error) throw error;

      toast.success('Pharmacist response submitted successfully!');
      setResponseHtml('');
      setSelectedIntake(null);
      fetchIntakes();
    } catch (err: any) {
      console.error('Error submitting response:', err);
      toast.error('Failed to submit response.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between border-b border-slate-200 pb-4">
        <div>
          <h1 className="text-2xl font-bold font-display text-slate-900">
            Symptom Intake Queue
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Review symptoms and durational data submitted by patients under licensed pharmacist SLA.
          </p>
        </div>

        {/* Filter controls */}
        <div className="flex items-center space-x-2">
          <span className="text-xs font-semibold text-slate-500">Filter status:</span>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="text-xs bg-white border border-slate-200 rounded-lg p-2 font-medium"
          >
            <option value="all">All tickets</option>
            <option value="submitted">Submitted</option>
            <option value="under_review">Under Review</option>
            <option value="answered">Completed</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Intakes List Column */}
        <div className="lg:col-span-2 space-y-3">
          {loading ? (
            <div className="flex flex-col items-center justify-center p-20 bg-white border border-slate-200 rounded-2xl">
              <Loader2 className="w-8 h-8 text-blue-600 animate-spin mb-3" />
              <span className="text-sm text-slate-500">Syncing intake queue...</span>
            </div>
          ) : intakes.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-20 bg-white border border-slate-200 border-dashed rounded-2xl">
              <ClipboardList className="w-12 h-12 text-slate-300 mb-3" />
              <span className="text-sm font-semibold text-slate-600">No tickets found</span>
              <span className="text-xs text-slate-400 mt-1">Everything is clear for this filter status.</span>
            </div>
          ) : (
            intakes.map((item) => (
              <div
                key={item.id}
                onClick={() => setSelectedIntake(item)}
                className={`p-4 bg-white border rounded-xl shadow-sm hover:shadow-md cursor-pointer transition-all flex items-start justify-between ${
                  selectedIntake?.id === item.id ? 'border-2 border-blue-600' : 'border-slate-200'
                }`}
              >
                <div className="space-y-1.5 text-left">
                  <div className="flex items-center space-x-2">
                    <span className="text-xs font-bold text-slate-900">Patient Intake</span>
                    <span
                      className={`text-[10px] uppercase font-bold tracking-wide px-2 py-0.5 rounded-full ${
                        item.status === 'submitted'
                          ? 'bg-amber-100 text-amber-800'
                          : item.status === 'under_review'
                          ? 'bg-blue-100 text-blue-800'
                          : 'bg-green-100 text-green-800'
                      }`}
                    >
                      {item.status.replace('_', ' ')}
                    </span>
                  </div>

                  <p className="text-xs text-slate-600 font-semibold line-clamp-2">
                    Symptoms: {item.symptoms}
                  </p>
                  
                  <div className="flex items-center space-x-3 text-[11px] text-slate-400 font-medium">
                    <span>Duration: {item.duration}</span>
                    <span>•</span>
                    <span>Severity: <span className="font-bold text-slate-600">{item.severity}</span></span>
                    <span>•</span>
                    <span>Age: {item.age}</span>
                  </div>
                </div>

                <button className="p-2 hover:bg-slate-50 text-slate-400 hover:text-slate-700 rounded-lg transition-colors">
                  <Eye className="w-4 h-4" />
                </button>
              </div>
            ))
          )}
        </div>

        {/* Selected Intake Details Column */}
        <div className="lg:col-span-1">
          {selectedIntake ? (
            <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-5 text-left sticky top-6">
              <div>
                <h3 className="text-sm font-bold text-slate-900">Intake Details</h3>
                <p className="text-[11px] text-slate-400 font-mono mt-0.5">ID: {selectedIntake.id}</p>
              </div>

              {/* Status Section */}
              <div className="p-3 bg-slate-50 border border-slate-100 rounded-xl space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-500">Status:</span>
                  <span
                    className={`uppercase font-bold tracking-wide text-[10px] px-2 py-0.5 rounded-full ${
                      selectedIntake.status === 'submitted'
                        ? 'bg-amber-100 text-amber-800'
                        : selectedIntake.status === 'under_review'
                        ? 'bg-blue-100 text-blue-800'
                        : 'bg-green-100 text-green-800'
                    }`}
                  >
                    {selectedIntake.status}
                  </span>
                </div>
                
                {selectedIntake.status === 'submitted' && (
                  <button
                    onClick={() => handleClaim(selectedIntake.id)}
                    className="w-full mt-2 py-2 bg-blue-600 hover:bg-blue-700 active:scale-[0.99] text-white text-xs font-semibold rounded-lg shadow transition-all"
                  >
                    Claim Ticket & Review
                  </button>
                )}
              </div>

              {/* Patient details list */}
              <div className="space-y-3.5 border-b border-slate-150 pb-4">
                <div>
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Symptoms</span>
                  <p className="text-xs text-slate-800 leading-relaxed font-medium mt-1">{selectedIntake.symptoms}</p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Duration</span>
                    <p className="text-xs text-slate-800 font-medium mt-1">{selectedIntake.duration}</p>
                  </div>
                  <div>
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Severity</span>
                    <p className="text-xs text-slate-800 font-bold mt-1 capitalize">{selectedIntake.severity}</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Age</span>
                    <p className="text-xs text-slate-800 font-medium mt-1">{selectedIntake.age}</p>
                  </div>
                  <div>
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Pregnancy</span>
                    <p className="text-xs text-slate-800 font-medium mt-1">
                      {selectedIntake.pregnancy_breastfeeding ? 'Yes (Preg/Breastfeed)' : 'No'}
                    </p>
                  </div>
                </div>

                {selectedIntake.current_medications && (
                  <div>
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Current Meds</span>
                    <p className="text-xs text-slate-800 font-medium mt-1">{selectedIntake.current_medications}</p>
                  </div>
                )}

                {selectedIntake.allergies && (
                  <div>
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Allergies</span>
                    <p className="text-xs text-slate-850 font-bold text-amber-700 mt-1">{selectedIntake.allergies}</p>
                  </div>
                )}

                {selectedIntake.photo_url && (
                  <div>
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Attachment</span>
                    {signedPhotoUrl ? (
                      <a
                        href={signedPhotoUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-blue-600 hover:text-blue-800 font-semibold underline mt-1 block"
                      >
                        View Photo / Document
                      </a>
                    ) : (
                      <span className="text-[10px] text-slate-400 mt-1 block">Resolving photo link...</span>
                    )}
                  </div>
                )}
              </div>

              {/* Responder console */}
              {selectedIntake.status === 'under_review' && selectedIntake.assigned_pharmacist === user?.id && (
                <form onSubmit={handleSubmitResponse} className="space-y-3.5">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                      Pharmacist Clinical Answer
                    </label>
                    <textarea
                      value={responseHtml}
                      onChange={(e) => setResponseHtml(e.target.value)}
                      placeholder="Write your recommendation, OTC instructions, or doctor consultation redirection details..."
                      className="w-full mt-1.5 p-3 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:border-blue-500 focus:bg-white focus:outline-none transition-all resize-none h-24"
                      required
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="w-full py-2.5 bg-green-600 hover:bg-green-700 disabled:bg-green-300 active:scale-[0.99] text-white text-xs font-semibold rounded-xl flex items-center justify-center space-x-2 transition-all shadow-md"
                  >
                    {isSubmitting ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <span>Submit Answer</span>
                    )}
                  </button>
                </form>
              )}

              {selectedIntake.status === 'answered' && (
                <div className="bg-green-50 border border-green-100 rounded-xl p-3">
                  <div className="flex items-center space-x-1.5">
                    <CheckCircle className="w-4 h-4 text-green-600" />
                    <span className="text-xs font-bold text-green-950">Resolved</span>
                  </div>
                  <p className="text-xs text-green-900 leading-relaxed whitespace-pre-line mt-2">
                    {selectedIntake.pharmacist_response}
                  </p>
                </div>
              )}
            </div>
          ) : (
            <div className="bg-slate-50 border border-slate-200 border-dashed rounded-2xl p-8 text-center">
              <ClipboardList className="w-10 h-10 text-slate-300 mx-auto mb-2" />
              <span className="text-xs font-semibold text-slate-500">Select a ticket to review</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
