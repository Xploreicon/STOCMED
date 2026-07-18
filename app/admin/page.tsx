'use client';

import { Button } from '@/components/ui/button'

import React, { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useUser } from '@/hooks/useUser';
import { ClipboardList, Clock, AlertTriangle, CheckCircle, Eye, Loader2, ArrowRight } from 'lucide-react';
import { toast } from 'sonner';

export default function SymptomQueuePage() {
  const { user, isLoading: userLoading } = useUser();
  const [intakes, setIntakes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIntake, setSelectedIntake] = useState<any | null>(null);
  const [responseHtml, setResponseHtml] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [signedPhotoUrl, setSignedPhotoUrl] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [isLicensedPharmacist, setIsLicensedPharmacist] = useState(false);
  const [roleLoading, setRoleLoading] = useState(true);

  const supabase = createClient();
  const canPerformClinicalActions = !roleLoading && isLicensedPharmacist;

  useEffect(() => {
    let active = true;

    const loadClinicalRole = async () => {
      if (userLoading) return;
      if (!user?.id) {
        if (active) {
          setIsLicensedPharmacist(false);
          setRoleLoading(false);
        }
        return;
      }

      setRoleLoading(true);
      setIsLicensedPharmacist(false);
      const { data, error } = await (supabase.from('users') as any)
        .select(`
          is_stocmed_sp,stocmed_sp_authorized_at,stocmed_sp_authorization_basis,
          is_licensed_pharmacist,pharmacist_license_verified_at,pharmacist_license_verification_basis
        `)
        .eq('user_id', user.id)
        .maybeSingle();

      if (!active) return;
      if (error) {
        console.error('Failed to verify clinical responder role:', error);
        setIsLicensedPharmacist(false);
      } else {
        setIsLicensedPharmacist(Boolean(
          data?.is_stocmed_sp
          && data?.stocmed_sp_authorized_at
          && data?.stocmed_sp_authorization_basis?.trim()
          && data?.is_licensed_pharmacist
          && data?.pharmacist_license_verified_at
          && data?.pharmacist_license_verification_basis?.trim()
        ));
      }
      setRoleLoading(false);
    };

    void loadClinicalRole();
    return () => {
      active = false;
    };
  }, [supabase, user?.id, userLoading]);

  const fetchIntakes = React.useCallback(async () => {
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
  }, [filterStatus, supabase]);

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
  }, [fetchIntakes, supabase]);

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
  }, [selectedIntake, supabase]);

  const handleClaim = async (intakeId: string) => {
    if (!user) return;
    if (!canPerformClinicalActions) {
      toast.error('Only a verified licensed pharmacist can claim a symptom intake.');
      return;
    }
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
    if (!canPerformClinicalActions) {
      toast.error('Only a verified licensed pharmacist can submit a clinical answer.');
      return;
    }

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
      <div className="flex items-center justify-between border-b border-border pb-4">
        <div>
          <h1 className="text-2xl font-bold font-display text-ink">
            Symptom Intake Queue
          </h1>
          <p className="text-sm text-surface0 mt-1">
            Review symptoms and durational data submitted by patients under licensed pharmacist SLA.
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
            <option value="all">All tickets</option>
            <option value="submitted">Submitted</option>
            <option value="under_review">Under Review</option>
            <option value="answered">Completed</option>
          </select>
        </div>
      </div>

      {!roleLoading && !canPerformClinicalActions && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900" role="status">
          <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0" aria-hidden="true" />
          <div>
            <p className="font-semibold">Read-only oversight</p>
            <p className="mt-1 text-xs leading-relaxed">
              You can review symptom intake records, but only a verified licensed pharmacist can claim a case or submit a clinical answer.
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Intakes List Column */}
        <div className="lg:col-span-2 space-y-3">
          {loading ? (
            <div className="flex flex-col items-center justify-center p-20 bg-white border border-border rounded-2xl">
              <Loader2 className="w-8 h-8 text-blue-600 animate-spin mb-3" />
              <span className="text-sm text-surface0">Syncing intake queue...</span>
            </div>
          ) : intakes.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-20 bg-white border border-border border-dashed rounded-2xl">
              <ClipboardList className="w-12 h-12 text-border mb-3" />
              <span className="text-sm font-semibold text-ink-muted">No tickets found</span>
              <span className="text-xs text-ink-light mt-1">Everything is clear for this filter status.</span>
            </div>
          ) : (
            intakes.map((item) => (
              <div
                key={item.id}
                onClick={() => setSelectedIntake(item)}
                className={`p-4 bg-white border rounded-xl shadow-sm hover:shadow-md cursor-pointer transition-all flex items-start justify-between ${
                  selectedIntake?.id === item.id ? 'border-2 border-blue-600' : 'border-border'
                }`}
              >
                <div className="space-y-1.5 text-left">
                  <div className="flex items-center space-x-2">
                    <span className="text-xs font-bold text-ink">Patient Intake</span>
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

                  <p className="text-xs text-ink-muted font-semibold line-clamp-2">
                    Symptoms: {item.symptoms}
                  </p>
                  
                  <div className="flex items-center space-x-3 text-[11px] text-ink-light font-medium">
                    <span>Duration: {item.duration}</span>
                    <span>•</span>
                    <span>Severity: <span className="font-bold text-ink-muted">{item.severity}</span></span>
                    <span>•</span>
                    <span>Age: {item.age}</span>
                  </div>
                </div>

                <Button className="p-2 hover:bg-surface text-ink-light hover:text-ink rounded-lg transition-colors">
                  <Eye className="w-4 h-4" />
                </Button>
              </div>
            ))
          )}
        </div>

        {/* Selected Intake Details Column */}
        <div className="lg:col-span-1">
          {selectedIntake ? (
            <div className="bg-white border border-border rounded-2xl p-5 shadow-sm space-y-5 text-left sticky top-6">
              <div>
                <h3 className="text-sm font-bold text-ink">Intake Details</h3>
                <p className="text-[11px] text-ink-light font-mono mt-0.5">ID: {selectedIntake.id}</p>
              </div>

              {/* Status Section */}
              <div className="p-3 bg-surface border border-surface rounded-xl space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-surface0">Status:</span>
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
                
                {selectedIntake.status === 'submitted' && canPerformClinicalActions && (
                  <Button
                    onClick={() => handleClaim(selectedIntake.id)}
                    className="w-full mt-2 py-2 bg-blue-600 hover:bg-blue-700 active:scale-[0.99] text-white text-xs font-semibold rounded-lg shadow transition-all"
                  >
                    Claim Ticket & Review
                  </Button>
                )}
                {selectedIntake.status === 'submitted' && !roleLoading && !canPerformClinicalActions && (
                  <p className="mt-2 text-[11px] font-medium leading-relaxed text-amber-800">
                    Licensed pharmacist access is required to claim this intake.
                  </p>
                )}
              </div>

              {/* Patient details list */}
              <div className="space-y-3.5 border-b border-surface pb-4">
                <div>
                  <span className="text-[10px] font-bold text-ink-light uppercase tracking-wider block">Symptoms</span>
                  <p className="text-xs text-ink leading-relaxed font-medium mt-1">{selectedIntake.symptoms}</p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <span className="text-[10px] font-bold text-ink-light uppercase tracking-wider block">Duration</span>
                    <p className="text-xs text-ink font-medium mt-1">{selectedIntake.duration}</p>
                  </div>
                  <div>
                    <span className="text-[10px] font-bold text-ink-light uppercase tracking-wider block">Severity</span>
                    <p className="text-xs text-ink font-bold mt-1 capitalize">{selectedIntake.severity}</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <span className="text-[10px] font-bold text-ink-light uppercase tracking-wider block">Age</span>
                    <p className="text-xs text-ink font-medium mt-1">{selectedIntake.age}</p>
                  </div>
                  <div>
                    <span className="text-[10px] font-bold text-ink-light uppercase tracking-wider block">Pregnancy</span>
                    <p className="text-xs text-ink font-medium mt-1">
                      {selectedIntake.pregnancy_breastfeeding ? 'Yes (Preg/Breastfeed)' : 'No'}
                    </p>
                  </div>
                </div>

                {selectedIntake.current_medications && (
                  <div>
                    <span className="text-[10px] font-bold text-ink-light uppercase tracking-wider block">Current Meds</span>
                    <p className="text-xs text-ink font-medium mt-1">{selectedIntake.current_medications}</p>
                  </div>
                )}

                {selectedIntake.allergies && (
                  <div>
                    <span className="text-[10px] font-bold text-ink-light uppercase tracking-wider block">Allergies</span>
                    <p className="text-xs text-ink font-bold text-amber-700 mt-1">{selectedIntake.allergies}</p>
                  </div>
                )}

                {selectedIntake.photo_url && (
                  <div>
                    <span className="text-[10px] font-bold text-ink-light uppercase tracking-wider block">Attachment</span>
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
                      <span className="text-[10px] text-ink-light mt-1 block">Resolving photo link...</span>
                    )}
                  </div>
                )}
              </div>

              {/* Responder console */}
              {canPerformClinicalActions && selectedIntake.status === 'under_review' && selectedIntake.assigned_pharmacist === user?.id && (
                <form onSubmit={handleSubmitResponse} className="space-y-3.5">
                  <div>
                    <label className="block text-[10px] font-bold text-ink-light uppercase tracking-wider">
                      Pharmacist Clinical Answer
                    </label>
                    <textarea
                      value={responseHtml}
                      onChange={(e) => setResponseHtml(e.target.value)}
                      placeholder="Write your recommendation, OTC instructions, or doctor consultation redirection details..."
                      className="w-full mt-1.5 p-3 text-xs bg-surface border border-border rounded-xl focus:border-blue-500 focus:bg-white focus:outline-none transition-all resize-none h-24"
                      required
                    />
                  </div>

                  <Button
                    type="submit"
                    disabled={isSubmitting}
                    className="w-full py-2.5 bg-green-600 hover:bg-green-700 disabled:bg-green-300 active:scale-[0.99] text-white text-xs font-semibold rounded-xl flex items-center justify-center space-x-2 transition-all shadow-md"
                  >
                    {isSubmitting ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <span>Submit Answer</span>
                    )}
                  </Button>
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
            <div className="bg-surface border border-border border-dashed rounded-2xl p-8 text-center">
              <ClipboardList className="w-10 h-10 text-border mx-auto mb-2" />
              <span className="text-xs font-semibold text-surface0">Select a ticket to review</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
