import React from 'react';
import { Heart, Phone, ArrowLeft } from 'lucide-react';

interface CrisisScreenProps {
  onBack: () => void;
}

export default function CrisisScreen({ onBack }: CrisisScreenProps) {
  const handleCall = (number: string) => {
    window.location.href = `tel:${number}`;
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-[500px] w-full max-w-lg mx-auto p-6 bg-white border border-rose-100 rounded-2xl shadow-xl animate-in fade-in slide-in-from-bottom-4 duration-300">
      <div className="flex items-center justify-center w-16 h-16 bg-rose-50 rounded-full mb-6">
        <Heart className="w-8 h-8 text-rose-500 fill-rose-100 animate-pulse" />
      </div>

      <h2 className="text-2xl font-bold text-slate-900 text-center mb-2">
        You Are Not Alone
      </h2>
      <p className="text-slate-600 text-center text-sm mb-8 leading-relaxed max-w-sm">
        If you are struggling, feeling overwhelmed, or having thoughts of self-harm, please reach out to someone who cares. Support is available for you right now.
      </p>

      <div className="w-full space-y-4 mb-8">
        <div className="p-4 bg-rose-50 rounded-xl border border-rose-100">
          <h4 className="text-sm font-bold text-rose-950 mb-1">
            Mentally Aware Nigeria Initiative (MANI)
          </h4>
          <p className="text-xs text-rose-900 mb-4 leading-relaxed">
            Free, confidential, and professional psychological support in Nigeria. Available 24/7.
          </p>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              onClick={() => handleCall('08091116264')}
              className="flex items-center justify-center space-x-2 py-3 px-4 bg-rose-600 hover:bg-rose-700 active:scale-[0.99] text-white rounded-lg text-sm font-semibold transition-all shadow-sm"
            >
              <Phone className="w-4 h-4" />
              <span>Call 0809 111 6264</span>
            </button>
            
            <button
              onClick={() => handleCall('070062646264')}
              className="flex items-center justify-center space-x-2 py-3 px-4 bg-rose-600 hover:bg-rose-700 active:scale-[0.99] text-white rounded-lg text-sm font-semibold transition-all shadow-sm"
            >
              <Phone className="w-4 h-4" />
              <span>Call 0700 6264 6264</span>
            </button>
          </div>
        </div>

        {/* National Emergency Link */}
        <button
          onClick={() => handleCall('112')}
          className="flex items-center justify-between w-full p-4 bg-slate-900 hover:bg-slate-800 active:scale-[0.99] text-white rounded-xl font-semibold shadow-md transition-all"
        >
          <div className="flex items-center space-x-3">
            <Phone className="w-5 h-5 text-rose-400" />
            <div className="text-left">
              <div className="text-xs text-slate-400 uppercase tracking-wider font-semibold">General Emergency Line</div>
              <div className="text-lg">Call 112</div>
            </div>
          </div>
          <span className="text-xs text-slate-400">National</span>
        </button>
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
