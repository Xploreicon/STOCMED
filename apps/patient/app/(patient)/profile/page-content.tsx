'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { usePatientOwner } from '@/hooks/usePatientOwner';
import { isPatientAbort } from '@/lib/patient-operation';
import { useAuth } from '@/hooks/useAuth';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Loader2, CheckCircle2, AlertCircle } from 'lucide-react';

interface ProfileForm {
  full_name: string;
  email: string;
  phone: string;
  location: string;
}

export default function PatientProfilePage() {
  const router = useRouter();
  const { refreshProfile } = useAuth();
  const { assertOwner } = usePatientOwner();
  const searchParams = useSearchParams();
  const supabase = createClient();
  const requiresLocation = searchParams.get('required') === 'location';

  const [form, setForm] = useState<ProfileForm>({
    full_name: '',
    email: '',
    phone: '',
    location: '',
  });
  const [loading, setLoading] = useState(true);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    const loadProfile = async () => {
      try {
        const capturedOwnerId = await assertOwner();
        const {
          data: { user },
          error: authError,
        } = await supabase.auth.getUser();

        await assertOwner(user?.id);
        if (authError) throw authError;

        if (!user) {
          router.push('/login?redirectTo=/profile');
          return;
        }

        if (!isMounted) return;

        type ProfileRow = {
          full_name: string | null;
          email: string | null;
          phone: string | null;
          location: string | null;
        };

        const { data: profileRow, error: profileError } = await supabase
          .from('users')
          .select('full_name, email, phone, location')
          .eq('user_id', capturedOwnerId)
          .maybeSingle();

        await assertOwner();
        if (profileError) {
          throw profileError;
        }

        const metadataFullName = (user.user_metadata?.full_name as string | undefined) ?? undefined;
        const metadataPhone = (user.user_metadata?.phone as string | undefined) ?? undefined;
        const metadataLocation = (user.user_metadata?.location as string | undefined) ?? undefined;

        const safeProfile = (profileRow ?? {}) as Partial<ProfileRow>;
        const fullName = safeProfile.full_name ?? metadataFullName ?? '';
        const nameParts = fullName.trim().split(/\s+/);
        setFirstName(nameParts.length > 1 ? nameParts.slice(0, -1).join(' ') : fullName);
        setLastName(nameParts.length > 1 ? nameParts[nameParts.length - 1] : '');

        setForm({
          full_name: fullName,
          email: safeProfile.email ?? user.email ?? '',
          phone: safeProfile.phone ?? metadataPhone ?? '',
          location: safeProfile.location ?? metadataLocation ?? '',
        });
        setLoading(false);
      } catch (loadError) {
        if (isPatientAbort(loadError)) return;
        console.error('Failed to load profile:', loadError);
        if (isMounted) {
          setError('Unable to load your profile right now. Please try again later.');
          setLoading(false);
        }
      }
    };

    loadProfile();

    return () => {
      isMounted = false;
    };
  }, [router, supabase, assertOwner]);

  const handleChange = (field: keyof ProfileForm) => (event: React.ChangeEvent<HTMLInputElement>) => {
    setForm((prev) => ({ ...prev, [field]: event.target.value }));
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (saving) return;

    setSaving(true);
    setSuccess(null);
    setError(null);

    try {
      const capturedOwnerId = await assertOwner();
      const {
        data: { user },
        error: fetchError,
      } = await supabase.auth.getUser();

      await assertOwner(user?.id);
      if (fetchError) throw fetchError;
      if (!user) {
        router.push('/login?redirectTo=/profile');
        return;
      }

      if (!form.location.trim()) {
        setError('Primary location is required so pharmacy results can be ranked correctly.');
        return;
      }

      const emailChanged = form.email && form.email !== user.email;

      const updatePayload: Parameters<typeof supabase.auth.updateUser>[0] = {
        data: {
          full_name: form.full_name,
          phone: form.phone,
          location: form.location,
        },
      };

      if (form.email && form.email !== user.email) {
        updatePayload.email = form.email;
      }

      await assertOwner();
      const { error: updateError } = await supabase.auth.updateUser(updatePayload);
      await assertOwner();

      if (updateError) {
        throw updateError;
      }

      const { data: persistedProfile, error: profileWriteError } = await (supabase.from('users') as any)
        .update({
          full_name: form.full_name,
          email: form.email,
          phone: form.phone,
          location: form.location,
        })
        .eq('user_id', capturedOwnerId)
        .select('full_name, email, phone, location')
        .single();

      await assertOwner();
      if (profileWriteError) throw profileWriteError;
      if (
        !persistedProfile
        || persistedProfile.full_name !== form.full_name
        || persistedProfile.email !== form.email
        || persistedProfile.phone !== form.phone
        || persistedProfile.location !== form.location
      ) {
        throw new Error('The saved profile did not match the submitted values.');
      }

      await refreshProfile();
      await assertOwner();

      setSuccess(
        emailChanged
          ? 'Profile updated. Please verify the confirmation email sent to your new address.'
          : 'Profile updated successfully.'
      );
      if (requiresLocation) {
        router.push('/dashboard');
      }
    } catch (updateError) {
      if (isPatientAbort(updateError)) return;
      console.error('Profile update failed:', updateError);
      setError('Unable to update profile at the moment. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-[920px] flex-col gap-6">
      <div>
        <h1 className="text-[25px] sm:text-[30px] font-display font-semibold text-ink">Profile</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Update your personal information and primary search area.
        </p>
        {requiresLocation && (
          <p className="mt-3 rounded-button border border-warning/30 bg-warning/10 px-4 py-3 text-sm font-medium text-ink" role="alert">
            Add your primary location before searching so nearby pharmacies are ranked correctly.
          </p>
        )}
      </div>

      <Card className="shadow-none hover:shadow-none bg-white">
        <CardHeader>
          <CardTitle className="text-base font-semibold">Personal information</CardTitle>
          <p className="text-sm text-ink-muted">Update your personal details here.</p>
        </CardHeader>
        <CardContent>
          <form className="space-y-5" onSubmit={handleSubmit}>
            <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="first-name">First name</Label>
              <Input
                id="first-name"
                autoComplete="given-name"
                value={firstName}
                onChange={(event) => { setFirstName(event.target.value); setForm((previous) => ({ ...previous, full_name: [event.target.value, lastName].filter(Boolean).join(' ') })); }}
                placeholder="First name"
                className="h-11"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="last-name">Last name</Label>
              <Input id="last-name" autoComplete="family-name" value={lastName} onChange={(event) => { setLastName(event.target.value); setForm((previous) => ({ ...previous, full_name: [firstName, event.target.value].filter(Boolean).join(' ') })); }} placeholder="Last name" className="h-11" />
            </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                value={form.email}
                onChange={handleChange('email')}
                placeholder="jane@example.com"
                required
                className="h-11"
              />
              <p className="text-xs text-ink-muted">
                Changing your email will require confirmation via a verification link.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="phone">Phone number</Label>
                <Input
                  id="phone"
                  type="tel"
                  autoComplete="tel"
                  value={form.phone}
                  onChange={handleChange('phone')}
                  placeholder="+2348012345678"
                  className="h-11"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="location">Primary location</Label>
                <Input
                  id="location"
                  value={form.location}
                  onChange={handleChange('location')}
                  placeholder="Lagos, Nigeria"
                  required
                  className="h-11"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-3 pt-2">
              <Button type="submit" disabled={saving} className="h-11 shadow-none">
                {saving ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  'Save changes'
                )}
              </Button>

              {success && (
                <div className="flex w-full items-start gap-2 rounded-button bg-success/10 p-3 text-sm text-success" role="status">
                  <CheckCircle2 className="h-4 w-4" />
                  {success}
                </div>
              )}
              {error && (
                <div className="flex w-full items-start gap-2 rounded-button bg-danger/10 p-3 text-sm text-danger" role="alert">
                  <AlertCircle className="h-4 w-4" />
                  {error}
                </div>
              )}
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
