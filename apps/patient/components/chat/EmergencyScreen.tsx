import { Button } from '@/components/ui/button'
import React from 'react';
import { Phone, AlertTriangle, ShieldAlert, ArrowLeft } from 'lucide-react';

interface EmergencyScreenProps {
  onBack: () => void;
  userState?: string | null;
}

export default function EmergencyScreen({ onBack, userState }: EmergencyScreenProps) {
  const isLagos = userState?.toLowerCase().includes('lagos') || false;

  const handleCall = (number: string) => {
    window.location.href = `tel:${number}`;
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-[500px] w-full max-w-lg mx-auto p-6 bg-white border border-amber-200 rounded-2xl shadow-xl animate-in fade-in slide-in-from-bottom-4 duration-300">
      <div className="flex items-center justify-center w-16 h-16 bg-amber-50 rounded-full mb-6">
        <AlertTriangle className="w-8 h-8 text-amber-600 animate-pulse" />
      </div>

      <h2 className="text-2xl font-bold text-ink text-center mb-2">
        This May Be an Emergency
      </h2>
      <p className="text-ink-muted text-center text-sm mb-8 leading-relaxed max-w-sm">
        For your safety, please seek immediate medical care. AI tools and search systems cannot diagnose or treat life-threatening conditions.
      </p>

      <div className="w-full space-y-4 mb-8">
        {/* National Emergency */}
        <Button
          onClick={() => handleCall('112')}
          className="flex items-center justify-between w-full p-4 bg-amber-600 hover:bg-amber-700 active:scale-[0.99] text-white rounded-xl font-semibold shadow-md transition-all"
        >
          <div className="flex items-center space-x-3">
            <Phone className="w-5 h-5" />
            <div className="text-left">
              <div className="text-xs text-amber-100 uppercase tracking-wider font-semibold">National Emergency</div>
              <div className="text-lg">Call 112</div>
            </div>
          </div>
          <span className="text-xs bg-amber-500 bg-opacity-35 px-2.5 py-1 rounded-full text-white font-medium">Free Call</span>
        </Button>

        {/* Lagos state Emergency */}
        <Button
          onClick={() => handleCall('767')}
          className={`flex items-center justify-between w-full p-4 bg-ink hover:bg-ink active:scale-[0.99] text-white rounded-xl font-semibold shadow-md transition-all ${
            isLagos ? 'border-2 border-amber-400' : ''
          }`}
        >
          <div className="flex items-center space-x-3">
            <Phone className="w-5 h-5 text-amber-400" />
            <div className="text-left">
              <div className="text-xs text-ink-light uppercase tracking-wider font-semibold">Lagos Emergency (LASEMA)</div>
              <div className="text-lg">Call 767</div>
            </div>
          </div>
          {isLagos && (
            <span className="text-xs bg-amber-400 bg-opacity-20 text-amber-400 border border-amber-400 border-opacity-30 px-2 py-0.5 rounded-full font-medium">
              Recommended for Lagos
            </span>
          )}
        </Button>

        {/* FRSC Accident Line */}
        <Button
          onClick={() => handleCall('122')}
          className="flex items-center justify-between w-full p-4 bg-surface hover:bg-border active:scale-[0.99] text-ink rounded-xl font-semibold transition-all border border-border"
        >
          <div className="flex items-center space-x-3">
            <ShieldAlert className="w-5 h-5 text-ink-muted" />
            <div className="text-left">
              <div className="text-xs text-surface0 uppercase tracking-wider font-semibold">FRSC Road Accidents</div>
              <div className="text-lg">Call 122</div>
            </div>
          </div>
          <span className="text-xs text-surface0">National</span>
        </Button>
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
