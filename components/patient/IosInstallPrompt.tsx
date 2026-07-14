'use client';

import { useState, useEffect } from 'react';
import { Share, SquarePlus, X } from 'lucide-react';

export default function IosInstallPrompt() {
  const [showPrompt, setShowPrompt] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as unknown as { standalone?: boolean }).standalone === true;
    const dismissed = localStorage.getItem('stocmed:iosPromptDismissed') === 'true';

    if (isIos && !isStandalone && !dismissed) {
      setShowPrompt(true);
    }
  }, []);

  const handleDismiss = () => {
    setShowPrompt(false);
    if (typeof window !== 'undefined') {
      localStorage.setItem('stocmed:iosPromptDismissed', 'true');
    }
  };

  if (!showPrompt) return null;

  return (
    <div className="fixed bottom-20 left-4 right-4 z-40 bg-slate-900 text-white p-4 rounded-xl shadow-xl border border-slate-700 max-w-md mx-auto animate-in fade-in slide-in-from-bottom-5 duration-300">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 text-xs leading-relaxed">
          <div className="font-semibold text-sm mb-1 flex items-center gap-1.5 text-blue-400">
            <span>Install StocMed App</span>
          </div>
          <p className="text-slate-300">
            Install on your iPhone for instant medication lookup and offline search history:
          </p>
          <div className="mt-2.5 flex items-center gap-1.5 font-medium text-slate-100 bg-slate-800 px-3 py-1.5 rounded-lg border border-slate-700">
            <span>Tap</span>
            <Share className="w-4 h-4 text-blue-400 inline" />
            <span>then select</span>
            <SquarePlus className="w-4 h-4 text-blue-400 inline" />
            <span className="font-bold">&quot;Add to Home Screen&quot;</span>
          </div>
        </div>
        <button
          onClick={handleDismiss}
          className="text-slate-400 hover:text-white p-1 rounded-md transition-colors"
          aria-label="Dismiss prompt"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
