'use client';

import { usePatientOwner } from '@/hooks/usePatientOwner';
import { usePatientFetch } from '@/hooks/usePatientFetch';
import { isPatientAbort } from '@/lib/patient-operation';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2, ShieldCheck, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { NotificationPreferencesCard } from '@/components/patient/NotificationPreferencesCard';
import { Dialog, DialogContent } from '@/components/ui/dialog';

export default function PatientSettingsPage() {
  const nativeFetch = usePatientFetch();
  const { assertOwner } = usePatientOwner();
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
  const [consentError, setConsentError] = useState<string | null>(null);
  const [deletingData, setDeletingData] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteConfirmed, setDeleteConfirmed] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    const init = async () => {
      try {
        const capturedOwnerId = await assertOwner();
        const { data: { user }, error: userError } = await supabase.auth.getUser();
        await assertOwner(user?.id);
        if (userError) throw userError;
        if (!user) {
          router.push('/login?redirectTo=/settings');
          return;
        }
        setUserExists(true);
        const { data: consentData, error: consentLoadError } = await (supabase.from('research_consent') as any)
          .select('consented')
          .eq('user_id', capturedOwnerId)
          .maybeSingle();
        await assertOwner();
        if (consentLoadError) throw consentLoadError;
        setConsented(consentData?.consented ?? false);
      } catch (err) {
        if (isPatientAbort(err)) return;
        console.error('Failed to load consent:', err);
        setConsented(false);
        setConsentError('We could not verify your stored consent choice. Please choose again.');
      } finally {
        setLoading(false);
      }
    };

    init();
  }, [router, supabase, assertOwner]);

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
      await assertOwner();
      const { error } = await supabase.auth.updateUser({
        password,
      });
      await assertOwner();

      if (error) {
        setPasswordError(error.message ?? 'Unable to change password.');
        return;
      }

      setPassword('');
      setConfirmPassword('');
      setPasswordMessage('Password updated successfully.');
    } catch (error) {
      if (isPatientAbort(error)) return;
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
    <div className="mx-auto flex w-full max-w-[920px] flex-col gap-6">
      <div>
        <h1 className="text-[25px] sm:text-[30px] font-display font-semibold text-ink">Settings</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Manage account security, notifications and privacy.
        </p>
      </div>

      <Card className="shadow-none hover:shadow-none bg-white">
        <CardHeader className="flex flex-row items-start gap-3">
          <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center mt-0.5">
            <ShieldCheck className="h-5 w-5 text-primary" />
          </div>
          <div>
            <CardTitle className="text-base font-semibold">Change password</CardTitle>
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
                  autoComplete="new-password"
                  placeholder="Enter a new password"
                  className="h-11"
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
                  autoComplete="new-password"
                  placeholder="Re-enter your new password"
                  className="h-11"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  minLength={8}
                  required
                />
              </div>
            </div>

            {passwordError && (
              <p className="text-sm text-danger" role="alert">{passwordError}</p>
            )}
            {passwordMessage && (
              <p className="text-sm text-success" role="status">{passwordMessage}</p>
            )}

            <div className="flex justify-end"><Button type="submit" disabled={changingPassword} className="h-11 shadow-none">
              {changingPassword ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Updating password...
                </>
              ) : (
                'Update password'
              )}
            </Button></div>
          </form>
        </CardContent>
      </Card>

      <NotificationPreferencesCard />

      <Card className="shadow-none hover:shadow-none bg-white">
        <CardHeader className="flex flex-row items-start gap-3">
          <div className="h-9 w-9 rounded-full bg-success/10 flex items-center justify-center mt-0.5">
            <ShieldCheck className="h-5 w-5 text-success" />
          </div>
          <div>
            <CardTitle className="text-base font-semibold">Privacy & research consent</CardTitle>
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
                const nextConsent = checked === true;
                setSavingConsent(true);
                setConsentError(null);
                try {
                  const capturedOwnerId = await assertOwner();
                  const { data: savedConsent, error: consentWriteError } = await (
                    supabase.from('research_consent') as any
                  )
                    .upsert({
                      user_id: capturedOwnerId,
                      consented: nextConsent,
                      consent_text_version: 'NDPR_V1',
                      updated_at: new Date().toISOString(),
                    })
                    .select('consented, consent_text_version')
                    .single();

                  await assertOwner();
                  if (consentWriteError) throw consentWriteError;
                  if (
                    !savedConsent
                    || savedConsent.consented !== nextConsent
                    || savedConsent.consent_text_version !== 'NDPR_V1'
                  ) {
                    throw new Error('The stored consent record did not match your choice.');
                  }

                  setConsented(nextConsent);
                  toast.success(nextConsent ? 'Research consent recorded' : 'Research consent withdrawn');
                } catch (err) {
                  if (isPatientAbort(err)) return;
                  console.error('Failed to update consent:', err);
                  setConsentError('Your consent choice was not saved. Please try again.');
                  toast.error('Consent choice was not saved');
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
          {consentError && (
            <p className="text-sm font-medium text-danger" role="alert">
              {consentError}
            </p>
          )}
        </CardContent>
      </Card>

      <Card className="shadow-none hover:shadow-none bg-white">
        <CardHeader className="flex flex-row items-start gap-3">
          <div className="h-9 w-9 rounded-lg bg-danger/10 flex items-center justify-center mt-0.5">
            <Trash2 className="h-5 w-5 text-danger" />
          </div>
          <div>
            <CardTitle className="text-base font-semibold">Delete my data</CardTitle>
            <p className="mt-1 text-sm text-ink-muted">
              Remove your linked search, chat, consent, intake, and prescription data. Anonymous aggregate records cannot identify you.
            </p>
          </div>
        </CardHeader>
        <CardContent className="flex justify-end">
          <Button variant="outline" className="border-danger text-danger shadow-none hover:bg-danger/5" disabled={deletingData} onClick={() => { setDeleteConfirmed(false); setDeleteError(null); setDeleteDialogOpen(true); }}>
            {deletingData ? 'Deleting…' : 'Delete my data'}
          </Button>
        </CardContent>
      </Card>
      <Dialog open={deleteDialogOpen} onOpenChange={(open) => { if (!deletingData) setDeleteDialogOpen(open); }}>
        <DialogContent role="dialog" aria-modal="true" aria-labelledby="delete-data-title" className="max-w-lg p-5 sm:p-6">
          <h2 id="delete-data-title" className="text-xl font-semibold text-ink">Delete my data?</h2>
          <p className="mt-3 text-sm leading-relaxed text-ink-muted">This removes your linked searches, chats, consent and other eligible personal records. This cannot be undone. Anonymous aggregate records that cannot identify you remain.</p>
          <p className="mt-3 rounded-button bg-surface p-3 text-xs leading-relaxed text-ink-muted">Prescription records may need to remain until their approved retention period ends. If records cannot yet be removed, we will show the reason.</p>
          <div className="mt-5 flex items-start gap-3"><Checkbox id="confirm-delete-data" checked={deleteConfirmed} onCheckedChange={(checked) => setDeleteConfirmed(checked === true)} disabled={deletingData} className="mt-0.5" /><Label htmlFor="confirm-delete-data" className="text-sm leading-relaxed">I understand that eligible data will be permanently deleted.</Label></div>
          {deleteError && <p className="mt-4 text-sm text-danger" role="alert">{deleteError}</p>}
          <div className="mt-6 flex flex-col-reverse sm:flex-row sm:justify-end gap-3">
            <Button variant="outline" disabled={deletingData} onClick={() => setDeleteDialogOpen(false)}>Cancel</Button>
            <Button variant="destructive" disabled={deletingData || !deleteConfirmed} onClick={async () => {
              setDeletingData(true);
              setDeleteError(null);
              try {
                await assertOwner();
                const response = await nativeFetch('/api/privacy/delete-my-data', { method: 'DELETE' });
                const result = await response.json().catch(() => null);
                await assertOwner();
                if (!response.ok) throw new Error(result?.error || 'Your data could not be deleted');
                toast.success(response.status === 202 ? 'Linked data deleted. Private file removal is queued.' : 'Your linked data has been deleted');
                setDeleteDialogOpen(false);
                router.refresh();
              } catch (error) {
                if (isPatientAbort(error)) return;
                setDeleteError(error instanceof Error ? error.message : 'Your data could not be deleted. Check your connection and try again.');
              } finally {
                setDeletingData(false);
              }
            }}>{deletingData ? 'Deleting…' : 'Delete my data'}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
