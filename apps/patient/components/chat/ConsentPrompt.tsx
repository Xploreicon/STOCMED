import { Button } from '@/components/ui/button'
import React, { useState, useEffect } from 'react';
import { ShieldCheck, X, HelpCircle } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { usePatientOwner } from '@/hooks/usePatientOwner';
import { isPatientAbort } from '@/lib/patient-operation';
import { useUser } from '@/hooks/useUser';

interface ConsentPromptProps {
  onStatusChange?: (consented: boolean) => void;
}

export default function ConsentPrompt({ onStatusChange }: ConsentPromptProps) {
  const { user } = useUser();
  const { assertOwner } = usePatientOwner();
  const [showPrompt, setShowPrompt] = useState(false);
  const [hasCheckedConsent, setHasCheckedConsent] = useState(false);
  const [consentError, setConsentError] = useState<string | null>(null);
  const [savingConsent, setSavingConsent] = useState(false);

  useEffect(() => {
    if (!user || hasCheckedConsent) return;

    const checkConsent = async () => {
      const supabase = createClient();
      try {
        const capturedOwnerId = await assertOwner();
        const { data, error } = await (supabase.from('research_consent') as any)
          .select('consented')
          .eq('user_id', capturedOwnerId)
          .maybeSingle();

        await assertOwner();
        if (error) throw error;

        // Show prompt if there's no stored record
        if (!data) {
          setShowPrompt(true);
        } else if (onStatusChange) {
          onStatusChange(data.consented);
        }
      } catch (err) {
        if (isPatientAbort(err)) return;
        console.error('Error checking research consent status:', err);
        setConsentError('We could not verify a stored consent choice. Please choose again.');
        setShowPrompt(true);
      } finally {
        setHasCheckedConsent(true);
      }
    };

    checkConsent();
  }, [user, hasCheckedConsent, onStatusChange, assertOwner]);

  const handleConsent = async (consented: boolean) => {
    if (!user) return;
    const supabase = createClient();

    setSavingConsent(true);
    setConsentError(null);
    try {
      const capturedOwnerId = await assertOwner();
      const { data: savedConsent, error } = await (supabase.from('research_consent') as any)
        .upsert({
          user_id: capturedOwnerId,
          consented,
          consent_text_version: 'NDPR_V1',
          sessions_since_consent: 0,
          updated_at: new Date().toISOString(),
        })
        .select('consented, consent_text_version')
        .single();

      await assertOwner();
      if (error) throw error;
      if (
        !savedConsent
        || savedConsent.consented !== consented
        || savedConsent.consent_text_version !== 'NDPR_V1'
      ) {
        throw new Error('The stored consent record did not match the submitted choice.');
      }

      setShowPrompt(false);
      if (onStatusChange) {
        onStatusChange(consented);
      }
    } catch (err) {
      if (isPatientAbort(err)) return;
      console.error('Error saving research consent:', err);
      setConsentError('Your choice was not saved. Please try again.');
    } finally {
      setSavingConsent(false);
    }
  };

  if (!showPrompt) return null;

  return (
    <div data-tour-blocked="true" className="w-full bg-secondary backdrop-blur-md border border-primary rounded-xl p-4 flex flex-col md:flex-row md:items-center md:justify-between space-y-3 md:space-y-0 md:space-x-4 animate-in fade-in slide-in-from-top-4 duration-300">
      <div className="flex items-start space-x-3">
        <ShieldCheck className="w-5 h-5 text-primary mt-0.5 flex-shrink-0" />
        <div className="text-left">
          <h4 className="text-xs font-bold text-primary flex items-center">
            NDPR Privacy & Research Consent
          </h4>
          <p className="text-xs text-primary leading-relaxed mt-0.5">
            StocMed supports Nigerian health system research. We only analyze anonymized, de-identified queries to improve local drug availability. You can change your choice anytime in Settings.
          </p>
        </div>
      </div>

      <div className="flex flex-col items-end gap-2 flex-shrink-0 self-end md:self-center">
        {consentError && (
          <p className="max-w-xs text-right text-xs font-medium text-danger" role="alert">
            {consentError}
          </p>
        )}
        <div className="flex items-center space-x-2">
        <Button
          disabled={savingConsent}
          onClick={() => handleConsent(false)}
          className="px-3 py-1.5 text-xs text-ink-muted hover:text-ink font-medium hover:bg-surface/50 rounded-lg transition-colors"
        >
          Keep Private
        </Button>
        
        <Button
          disabled={savingConsent}
          onClick={() => handleConsent(true)}
          className="px-3.5 py-1.5 text-xs font-semibold text-white bg-primary hover:bg-primary rounded-lg shadow-sm transition-colors"
        >
          Accept & Support
        </Button>
        </div>
      </div>
    </div>
  );
}
