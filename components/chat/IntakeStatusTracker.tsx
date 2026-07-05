import React, { useEffect, useState } from 'react';
import { Clock, CheckCircle2, UserCheck, MessageSquare, Loader2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

interface IntakeStatusTrackerProps {
  intakeId: string;
}

export default function IntakeStatusTracker({ intakeId }: IntakeStatusTrackerProps) {
  const [intake, setIntake] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    let subscription: any = null;

    const fetchIntake = async () => {
      try {
        const { data, error: fetchErr } = await supabase
          .from('symptom_intakes')
          .select('*, assigned_pharmacist:public_users!assigned_pharmacist(full_name)')
          .eq('id', intakeId)
          .maybeSingle();

        // Fallback in case the join configuration causes issues
        if (fetchErr || !data) {
          const { data: simpleData, error: simpleErr } = await supabase
            .from('symptom_intakes')
            .select('*')
            .eq('id', intakeId)
            .maybeSingle();

          if (simpleErr) throw simpleErr;
          setIntake(simpleData);
        } else {
          setIntake(data);
        }
      } catch (err: any) {
        console.error('Error fetching intake status:', err);
        setError(err.message || 'Failed to load intake status');
      } finally {
        setLoading(false);
      }
    };

    fetchIntake();

    // Subscribe to real-time updates for this specific intake
    const channel = supabase
      .channel(`symptom_intake_status_${intakeId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'symptom_intakes',
          filter: `id=eq.${intakeId}`,
        },
        (payload) => {
          setIntake(payload.new);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [intakeId]);

  if (loading) {
    return (
      <div className="w-full bg-slate-50 border border-slate-200 rounded-2xl p-6 flex flex-col items-center justify-center">
        <Loader2 className="w-6 h-6 text-blue-600 animate-spin mb-2" />
        <span className="text-xs text-slate-500">Loading intake status tracker...</span>
      </div>
    );
  }

  if (error || !intake) {
    return (
      <div className="w-full bg-red-50 border border-red-200 rounded-2xl p-4 text-center">
        <span className="text-xs font-semibold text-red-800">
          {error || 'Intake record not found.'}
        </span>
      </div>
    );
  }

  const status = intake.status; // 'submitted', 'under_review', 'answered'
  
  // Calculate remaining time for 4-hour SLA
  const deadline = new Date(intake.sla_deadline);
  const isSlaMet = new Date() < deadline;

  return (
    <div className="w-full bg-slate-50 border border-slate-200 rounded-2xl p-5 shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-200 pb-3 mb-4">
        <div>
          <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wide">
            Intake Queue Status
          </h4>
          <span className="text-[10px] text-slate-400 font-mono mt-0.5 block">
            ID: {intakeId.slice(0, 8)}
          </span>
        </div>
        
        <div className="flex items-center space-x-1.5 bg-blue-50 px-2.5 py-1 rounded-full text-blue-700">
          <Clock className="w-3.5 h-3.5" />
          <span className="text-[11px] font-semibold">
            {isSlaMet ? 'SLA: 4-Hour Response' : 'Duty Pharmacist Reviewing'}
          </span>
        </div>
      </div>

      {/* Timeline steps */}
      <div className="relative flex items-center justify-between mb-6 px-4">
        <div className="absolute left-6 right-6 top-1/2 -translate-y-1/2 h-0.5 bg-slate-200 -z-10" />
        <div
          className="absolute left-6 top-1/2 -translate-y-1/2 h-0.5 bg-blue-600 -z-10 transition-all duration-500"
          style={{
            width: status === 'submitted' ? '0%' : status === 'under_review' ? '50%' : '100%',
          }}
        />

        {/* Step 1: Submitted */}
        <div className="flex flex-col items-center">
          <div
            className={`w-6 h-6 rounded-full flex items-center justify-center border-2 text-[10px] font-bold ${
              status === 'submitted'
                ? 'bg-blue-600 border-blue-600 text-white'
                : 'bg-white border-blue-600 text-blue-600'
            }`}
          >
            1
          </div>
          <span className="text-[10px] font-semibold text-slate-700 mt-1.5">Submitted</span>
        </div>

        {/* Step 2: Under Review */}
        <div className="flex flex-col items-center">
          <div
            className={`w-6 h-6 rounded-full flex items-center justify-center border-2 text-[10px] font-bold ${
              status === 'under_review'
                ? 'bg-blue-600 border-blue-600 text-white animate-pulse'
                : status === 'answered'
                ? 'bg-white border-blue-600 text-blue-600'
                : 'bg-white border-slate-300 text-slate-400'
            }`}
          >
            2
          </div>
          <span className="text-[10px] font-semibold text-slate-500 mt-1.5">Reviewing</span>
        </div>

        {/* Step 3: Completed */}
        <div className="flex flex-col items-center">
          <div
            className={`w-6 h-6 rounded-full flex items-center justify-center border-2 text-[10px] font-bold ${
              status === 'answered'
                ? 'bg-green-600 border-green-600 text-white'
                : 'bg-white border-slate-300 text-slate-400'
            }`}
          >
            3
          </div>
          <span className="text-[10px] font-semibold text-slate-500 mt-1.5">Completed</span>
        </div>
      </div>

      {/* Response Box */}
      {status === 'answered' && intake.pharmacist_response ? (
        <div className="bg-white border border-green-150 rounded-xl p-4 text-left animate-in fade-in slide-in-from-bottom-2 duration-300">
          <div className="flex items-center space-x-2 mb-2">
            <UserCheck className="w-4 h-4 text-green-600" />
            <span className="text-xs font-bold text-green-950">
              Pharmacist Response
            </span>
          </div>
          <p className="text-xs text-slate-700 leading-relaxed whitespace-pre-line">
            {intake.pharmacist_response}
          </p>
        </div>
      ) : (
        <div className="bg-slate-100/50 border border-slate-200 border-dashed rounded-xl p-4 text-center">
          <MessageSquare className="w-5 h-5 text-slate-400 mx-auto mb-1.5" />
          <span className="text-xs font-semibold text-slate-700 block">
            {status === 'under_review' ? 'Pharmacist is writing a response...' : 'Symptom intake submitted'}
          </span>
          <span className="text-[10px] text-slate-500 mt-0.5 block">
            {status === 'under_review'
              ? 'Our pharmacist has claimed your ticket and is preparing recommendations.'
              : 'Our pharmacist will review this ticket and suggest safe next steps shortly.'}
          </span>
        </div>
      )}
    </div>
  );
}
