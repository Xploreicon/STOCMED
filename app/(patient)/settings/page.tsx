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
        <Loader2 className="h-8 w-8 animate-spin text-primary-blue" />
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-3xl font-semibold text-gray-900">Settings</h1>
        <p className="mt-1 text-sm text-gray-600">
          Manage account security, notifications, and account visibility.
        </p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-start gap-3">
          <ShieldCheck className="mt-1 h-5 w-5 text-primary-blue" />
          <div>
            <CardTitle>Change password</CardTitle>
            <p className="mt-1 text-sm text-gray-500">
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
              <p className="text-sm text-red-600">{passwordError}</p>
            )}
            {passwordMessage && (
              <p className="text-sm text-emerald-600">{passwordMessage}</p>
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

      <Card>
        <CardHeader className="flex flex-row items-start gap-3">
          <Bell className="mt-1 h-5 w-5 text-amber-500" />
          <div>
            <CardTitle>Notifications</CardTitle>
            <p className="mt-1 text-sm text-gray-500">
              Choose how you would like to receive updates. (Coming soon)
            </p>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-start gap-3">
            <Checkbox id="notify-email" disabled className="mt-1" />
            <div>
              <Label htmlFor="notify-email">Email alerts</Label>
              <p className="text-sm text-gray-500">
                Get notified when pharmacies restock medications you follow.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <Checkbox id="notify-sms" disabled className="mt-1" />
            <div>
              <Label htmlFor="notify-sms">SMS reminders</Label>
              <p className="text-sm text-gray-500">
                Receive SMS updates for reserved or expiring medications.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-start gap-3">
          <Trash2 className="mt-1 h-5 w-5 text-red-500" />
          <div>
            <CardTitle>Delete account</CardTitle>
            <p className="mt-1 text-sm text-gray-500">
              Permanently remove your account and data. This feature is coming soon.
            </p>
          </div>
        </CardHeader>
        <CardContent>
          <Button variant="destructive" disabled>
            Delete my account (coming soon)
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
