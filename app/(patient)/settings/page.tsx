'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2, ShieldCheck, Bell, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

export default function PatientSettingsPage() {
  const router = useRouter();
  const supabase = createClient();

  const [loading, setLoading] = useState(true);
  const [userExists, setUserExists] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [consented, setConsented] = useState<boolean | null>(null);
  const [savingConsent, setSavingConsent] = useState(false);
  const [deletingData, setDeletingData] = useState(false);

  useEffect(() => {
    const init = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        router.push('/login?redirectTo=/settings');
        return;
      }

      setUserExists(true);

      // Fetch research consent status
      try {
        const { data: consentData } = await (supabase.from('research_consent') as any)
          .select('consented')
          .eq('user_id', user.id)
          .maybeSingle();

        if (consentData) {
          setConsented(consentData.consented);
        } else {
          setConsented(false);
        }
      } catch (err) {
        console.error('Failed to load consent:', err);
      }

      setLoading(false);
    };

    init();
  }, [router, supabase]);

  const handleChangePassword = async (event: React.FormEvent) => {
    event.preventDefault();
    if (changingPassword) return;

    if (!password || password.length < 8) {
      setPasswordError('Password must be at least 8 characters long.');
      return;
    }

    if (password !== confirmPassword) {
      setPasswordError('Passwords do not match.');
      return;
    }

    setChangingPassword(true);
    setPasswordError(null);
    setPasswordMessage(null);

    try {
      const { error } = await supabase.auth.updateUser({
        password,
      });

      if (error) {
        setPasswordError(error.message ?? 'Unable to change password.');
        return;
      }

      setPassword('');
      setConfirmPassword('');
      setPasswordMessage('Password updated successfully.');
    } catch (error) {
      console.error('Password update failed:', error);
      setPasswordError('Something went wrong. Please try again.');
    } finally {
      setChangingPassword(false);
    }
  };

  if (loading || !userExists) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-3xl font-display font-bold text-ink">Settings</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Manage account security, privacy, and account visibility.
        </p>
      </div>

      <Card className="shadow-card">
        <CardHeader className="flex flex-row items-start gap-3">
          <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center mt-0.5">
            <ShieldCheck className="h-5 w-5 text-primary" />
          </div>
          <div>
            <CardTitle>Change password</CardTitle>
            <p className="mt-1 text-sm text-ink-muted">
              Update your password to secure your account.
            </p>
          </div>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={handleChangePassword}>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="new-password">New password</Label>
                <Input
                  id="new-password"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  minLength={8}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm-password">Confirm password</Label>
                <Input
                  id="confirm-password"
                  type="password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  minLength={8}
                  required
                />
              </div>
            </div>

            {passwordError && (
              <p className="text-sm text-danger">{passwordError}</p>
            )}
            {passwordMessage && (
              <p className="text-sm text-success">{passwordMessage}</p>
            )}

            <Button type="submit" disabled={changingPassword}>
              {changingPassword ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Updating password...
                </>
              ) : (
                'Update password'
              )}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card className="shadow-card text-left">
        <CardHeader className="flex flex-row items-start gap-3">
          <div className="h-9 w-9 rounded-lg bg-warning/10 flex items-center justify-center mt-0.5">
            <Bell className="h-5 w-5 text-warning" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle>Notifications & Alerts</CardTitle>
              <span className="rounded-full bg-warning/10 px-2.5 py-1 text-xs font-semibold text-warning">
                Coming soon
              </span>
            </div>
            <p className="mt-1 text-sm text-ink-muted">
              We&apos;re building reliable alerts. Nothing is being saved or sent yet.
            </p>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-start gap-3">
            <Checkbox
              id="notify-stock"
              checked={false}
              disabled
              className="mt-1"
            />
            <div>
              <Label htmlFor="notify-stock">Back-in-stock alerts</Label>
              <p className="text-sm text-ink-muted">
                Planned: alerts when pharmacies restock medications you searched for.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <Checkbox
              id="notify-price"
              checked={false}
              disabled
              className="mt-1"
            />
            <div>
              <Label htmlFor="notify-price">Price-drop alerts</Label>
              <p className="text-sm text-ink-muted">
                Planned: alerts when the price of a saved medication drops.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <Checkbox
              id="notify-refills"
              checked={false}
              disabled
              className="mt-1"
            />
            <div>
              <Label htmlFor="notify-refills">Chronic med refill reminders</Label>
              <p className="text-sm text-ink-muted">
                Planned: optional reminders for chronic prescription refills.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="shadow-card">
        <CardHeader className="flex flex-row items-start gap-3">
          <div className="h-9 w-9 rounded-lg bg-blue-500/10 flex items-center justify-center mt-0.5">
            <ShieldCheck className="h-5 w-5 text-blue-600" />
          </div>
          <div>
            <CardTitle>Privacy & Research Consent</CardTitle>
            <p className="mt-1 text-sm text-ink-muted">
              Control how your search queries contribute to drug supply research.
            </p>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-start gap-3">
            <Checkbox
              id="research-consent"
              checked={consented || false}
              disabled={savingConsent}
              onCheckedChange={async (checked) => {
                const { data: { user } } = await supabase.auth.getUser();
                if (!user) return;
                setSavingConsent(true);
                try {
                  await (supabase.from('research_consent') as any).upsert({
                    user_id: user.id,
                    consented: !!checked,
                    consent_text_version: 'NDPR_V1',
                    updated_at: new Date().toISOString(),
                  });
                  setConsented(!!checked);
                } catch (err) {
                  console.error('Failed to update consent:', err);
                } finally {
                  setSavingConsent(false);
                }
              }}
              className="mt-1 animate-none"
            />
            <div>
              <Label htmlFor="research-consent">Help improve drug availability in Nigeria</Label>
              <p className="text-sm text-ink-muted">
                Allow StocMed to include anonymized, de-identified queries in public health research databases. Your name, location, and account details are completely removed. Under NDPR rules, this is entirely voluntary and you can revoke consent here at any time.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="shadow-card">
        <CardHeader className="flex flex-row items-start gap-3">
          <div className="h-9 w-9 rounded-lg bg-danger/10 flex items-center justify-center mt-0.5">
            <Trash2 className="h-5 w-5 text-danger" />
          </div>
          <div>
            <CardTitle>Delete my data</CardTitle>
            <p className="mt-1 text-sm text-ink-muted">
              Remove your linked search, chat, consent, intake, and prescription data. Anonymous aggregate records cannot identify you.
            </p>
          </div>
        </CardHeader>
        <CardContent>
          <Button variant="destructive" disabled={deletingData} onClick={async () => {
            if (!window.confirm('Delete all data linked to your account? This cannot be undone.')) return;
            setDeletingData(true);
            const response = await fetch('/api/privacy/delete-my-data', { method: 'DELETE' });
            setDeletingData(false);
            if (response.ok) toast.success('Your linked data has been deleted');
            else toast.error('Your data could not be deleted');
          }}>
            {deletingData ? 'Deleting…' : 'Delete my data'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
