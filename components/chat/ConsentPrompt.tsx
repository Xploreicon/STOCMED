import { Button } from '@/components/ui/button'
import React, { useState, useEffect } from 'react';
import { ShieldCheck, X, HelpCircle } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useUser } from '@/hooks/useUser';

interface ConsentPromptProps {
  onStatusChange?: (consented: boolean) => void;
}

export default function ConsentPrompt({ onStatusChange }: ConsentPromptProps) {
  const { user } = useUser();
  const [showPrompt, setShowPrompt] = useState(false);
  const [hasCheckedConsent, setHasCheckedConsent] = useState(false);

  useEffect(() => {
    if (!user || hasCheckedConsent) return;

    const checkConsent = async () => {
      const supabase = createClient();
      try {
        const { data, error } = await (supabase.from('research_consent') as any)
          .select('consented')
          .eq('user_id', user.id)
          .maybeSingle();

        if (error) throw error;

        // Show prompt if there's no stored record
        if (!data) {
          setShowPrompt(true);
        } else if (onStatusChange) {
          onStatusChange(data.consented);
        }
      } catch (err) {
        console.error('Error checking research consent status:', err);
      } finally {
        setHasCheckedConsent(true);
      }
    };

    checkConsent();
  }, [user, hasCheckedConsent, onStatusChange]);

  const handleConsent = async (consented: boolean) => {
    if (!user) return;
    const supabase = createClient();

    try {
      const { error } = await (supabase.from('research_consent') as any).upsert({
        user_id: user.id,
        consented,
        consent_text_version: 'NDPR_V1',
        sessions_since_consent: 0,
        updated_at: new Date().toISOString(),
      });

      if (error) throw error;

      setShowPrompt(false);
      if (onStatusChange) {
        onStatusChange(consented);
      }
    } catch (err) {
      console.error('Error saving research consent:', err);
    }
  };

  if (!showPrompt) return null;

  return (
    <div className="w-full bg-blue-50/75 backdrop-blur-md border border-blue-100 rounded-xl p-4 flex flex-col md:flex-row md:items-center md:justify-between space-y-3 md:space-y-0 md:space-x-4 animate-in fade-in slide-in-from-top-4 duration-300">
      <div className="flex items-start space-x-3">
        <ShieldCheck className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" />
        <div className="text-left">
          <h4 className="text-xs font-bold text-blue-900 flex items-center">
            NDPR Privacy & Research Consent
          </h4>
          <p className="text-xs text-blue-800 leading-relaxed mt-0.5">
            StocMed supports Nigerian health system research. We only analyze anonymized, de-identified queries to improve local drug availability. You can change your choice anytime in Settings.
          </p>
        </div>
      </div>

      <div className="flex items-center space-x-2 flex-shrink-0 self-end md:self-center">
        <Button
          onClick={() => handleConsent(false)}
          className="px-3 py-1.5 text-xs text-ink-muted hover:text-ink font-medium hover:bg-surface/50 rounded-lg transition-colors"
        >
          Keep Private
        </Button>
        
        <Button
          onClick={() => handleConsent(true)}
          className="px-3.5 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-sm transition-colors"
        >
          Accept & Support
        </Button>
      </div>
    </div>
  );
}
