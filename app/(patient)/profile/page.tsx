'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
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
  const supabase = createClient();

  const [form, setForm] = useState<ProfileForm>({
    full_name: '',
    email: '',
    phone: '',
    location: '',
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    const loadProfile = async () => {
      try {
        const {
          data: { user },
          error: authError,
        } = await supabase.auth.getUser();

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
          .eq('user_id', user.id)
          .maybeSingle();

        if (profileError) {
          throw profileError;
        }

        const metadataFullName = (user.user_metadata?.full_name as string | undefined) ?? undefined;
        const metadataPhone = (user.user_metadata?.phone as string | undefined) ?? undefined;
        const metadataLocation = (user.user_metadata?.location as string | undefined) ?? undefined;

        const safeProfile = (profileRow ?? {}) as Partial<ProfileRow>;

        setForm({
          full_name: metadataFullName ?? safeProfile.full_name ?? '',
          email: safeProfile.email ?? user.email ?? '',
          phone: metadataPhone ?? safeProfile.phone ?? '',
          location: metadataLocation ?? safeProfile.location ?? '',
        });
        setLoading(false);
      } catch (loadError) {
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
  }, [router, supabase]);

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
      const {
        data: { user },
        error: fetchError,
      } = await supabase.auth.getUser();

      if (fetchError) throw fetchError;
      if (!user) {
        router.push('/login?redirectTo=/profile');
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

      const { error: updateError } = await supabase.auth.updateUser(updatePayload);

      if (updateError) {
        throw updateError;
      }

      await (supabase.from('users') as any)
        .update({
          full_name: form.full_name,
          email: form.email,
          phone: form.phone,
          location: form.location,
        })
        .eq('user_id', user.id);

      router.refresh();

      setSuccess(
        emailChanged
          ? 'Profile updated. Please verify the confirmation email sent to your new address.'
          : 'Profile updated successfully.'
      );
    } catch (updateError) {
      console.error('Profile update failed:', updateError);
      setError('Unable to update profile at the moment. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary-blue" />
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-3xl font-semibold text-gray-900">Profile</h1>
        <p className="mt-1 text-sm text-gray-600">
          Update your personal information to get more tailored pharmacy recommendations.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Personal details</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="space-y-5" onSubmit={handleSubmit}>
            <div className="space-y-2">
              <Label htmlFor="full_name">Full name</Label>
              <Input
                id="full_name"
                value={form.full_name}
                onChange={handleChange('full_name')}
                placeholder="Jane Doe"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={form.email}
                onChange={handleChange('email')}
                placeholder="jane@example.com"
                required
              />
              <p className="text-xs text-gray-500">
                Changing your email will require confirmation via a verification link.
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="phone">Phone number</Label>
                <Input
                  id="phone"
                  value={form.phone}
                  onChange={handleChange('phone')}
                  placeholder="+2348012345678"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="location">Primary location</Label>
                <Input
                  id="location"
                  value={form.location}
                  onChange={handleChange('location')}
                  placeholder="Lagos, Nigeria"
                />
              </div>
            </div>

          <div className="flex items-center gap-3 pt-2">
              <Button type="submit" disabled={saving}>
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
                <div className="flex items-center gap-1 text-sm text-emerald-600">
                  <CheckCircle2 className="h-4 w-4" />
                  {success}
                </div>
              )}
              {error && (
                <div className="flex items-center gap-1 text-sm text-red-600">
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
