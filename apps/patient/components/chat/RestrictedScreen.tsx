import { Button } from '@/components/ui/button'
import React from 'react';
import { Lock, AlertCircle, ArrowLeft, ShieldAlert } from 'lucide-react';

interface RestrictedScreenProps {
  onBack: () => void;
}

export default function RestrictedScreen({ onBack }: RestrictedScreenProps) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[500px] w-full max-w-lg mx-auto p-6 bg-white border border-red-100 rounded-2xl shadow-xl animate-in fade-in slide-in-from-bottom-4 duration-300">
      <div className="flex items-center justify-center w-16 h-16 bg-red-50 rounded-full mb-6">
        <Lock className="w-8 h-8 text-red-600" />
      </div>

      <h2 className="text-2xl font-bold text-ink text-center mb-2">
        Medication Sourcing Locked
      </h2>
      <p className="text-ink-muted text-center text-sm mb-6 leading-relaxed max-w-sm">
        This substance or medication is classified as highly controlled or restricted under Nigerian health regulations. We are legally prohibited from displaying pharmacy availability, pricing, or facilitating supply.
      </p>

      <div className="w-full bg-surface border border-surface rounded-xl p-4 mb-8 space-y-3">
        <div className="flex items-start space-x-3">
          <ShieldAlert className="w-5 h-5 text-ink mt-0.5 flex-shrink-0" />
          <div>
            <h4 className="text-sm font-semibold text-ink">Regulatory Compliance</h4>
            <p className="text-xs text-ink-muted leading-relaxed mt-0.5">
              These restrictions are in place to prevent substance misuse, illegal distribution, and self-medication risks.
            </p>
          </div>
        </div>

        <div className="flex items-start space-x-3">
          <AlertCircle className="w-5 h-5 text-ink mt-0.5 flex-shrink-0" />
          <div>
            <h4 className="text-sm font-semibold text-ink">What you should do</h4>
            <p className="text-xs text-ink-muted leading-relaxed mt-0.5">
              Please visit a registered medical practitioner at a hospital or licensed clinic to obtain clinical assessment and prescription.
            </p>
          </div>
        </div>
      </div>

      <Button
        onClick={onBack}
        className="flex items-center justify-center space-x-2 text-surface0 hover:text-ink transition-colors text-sm font-medium"
      >
        <ArrowLeft className="w-4 h-4" />
        <span>Return to Chat</span>
      </Button>
    </div>
  );
}
