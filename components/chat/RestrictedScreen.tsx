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

      <h2 className="text-2xl font-bold text-slate-900 text-center mb-2">
        Medication Sourcing Locked
      </h2>
      <p className="text-slate-600 text-center text-sm mb-6 leading-relaxed max-w-sm">
        This substance or medication is classified as highly controlled or restricted under Nigerian health regulations. We are legally prohibited from displaying pharmacy availability, pricing, or facilitating supply.
      </p>

      <div className="w-full bg-slate-50 border border-slate-100 rounded-xl p-4 mb-8 space-y-3">
        <div className="flex items-start space-x-3">
          <ShieldAlert className="w-5 h-5 text-slate-700 mt-0.5 flex-shrink-0" />
          <div>
            <h4 className="text-sm font-semibold text-slate-800">Regulatory Compliance</h4>
            <p className="text-xs text-slate-600 leading-relaxed mt-0.5">
              These restrictions are in place to prevent substance misuse, illegal distribution, and self-medication risks.
            </p>
          </div>
        </div>

        <div className="flex items-start space-x-3">
          <AlertCircle className="w-5 h-5 text-slate-700 mt-0.5 flex-shrink-0" />
          <div>
            <h4 className="text-sm font-semibold text-slate-800">What you should do</h4>
            <p className="text-xs text-slate-600 leading-relaxed mt-0.5">
              Please visit a registered medical practitioner at a hospital or licensed clinic to obtain clinical assessment and prescription.
            </p>
          </div>
        </div>
      </div>

      <button
        onClick={onBack}
        className="flex items-center justify-center space-x-2 text-slate-500 hover:text-slate-800 transition-colors text-sm font-medium"
      >
        <ArrowLeft className="w-4 h-4" />
        <span>Return to Chat</span>
      </button>
    </div>
  );
}
