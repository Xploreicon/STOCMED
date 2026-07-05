'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useUser } from '@/hooks/useUser';
import { createClient } from '@/lib/supabase/client';
import { Loader2 } from 'lucide-react';

export default function PharmacySettings() {
  const router = useRouter();
  const { user, isLoading: authLoading, isPharmacy } = useUser();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'profile' | 'account'>('profile');
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Profile Form states
  const [pharmacyName, setPharmacyName] = useState('');
  const [licenseNumber, setLicenseNumber] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('Lagos');
  const [phone, setPhone] = useState('');
  const [openingTime, setOpeningTime] = useState('8:00 AM');
  const [closingTime, setClosingTime] = useState('9:00 PM');

  // Account Form states
  const [email, setEmail] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');

  useEffect(() => {
    if (!authLoading && (!user || !isPharmacy)) {
      router.push('/login?redirectTo=/pharmacy/settings');
    }
  }, [user, authLoading, isPharmacy, router]);

  const { data: pharmacy, isLoading } = useQuery({
    queryKey: ['pharmacy-profile'],
    queryFn: async () => {
      const response = await fetch('/api/pharmacy/profile');
      if (!response.ok) {
        throw new Error('Failed to fetch pharmacy profile');
      }
      return response.json();
    },
    enabled: !!user && isPharmacy,
  });

  useEffect(() => {
    if (pharmacy) {
      setPharmacyName(pharmacy.pharmacy_name || '');
      setLicenseNumber(pharmacy.license_number || '');
      setAddress(pharmacy.address || '');
      setCity(pharmacy.city || '');
      setState(pharmacy.state || 'Lagos');

      // Handle phone format
      const rawPhone = pharmacy.phone || '';
      if (rawPhone.startsWith('+234')) {
        setPhone(rawPhone.replace('+234', '').trim());
      } else {
        setPhone(rawPhone);
      }
    }
  }, [pharmacy]);

  useEffect(() => {
    if (user?.email) {
      setEmail(user.email);
    }
  }, [user]);

  const updateProfileMutation = useMutation({
    mutationFn: async (data: any) => {
      const response = await fetch('/api/pharmacy/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!response.ok) {
        throw new Error('Failed to update profile');
      }
      return response.json();
    },
    onSuccess: () => {
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
      queryClient.invalidateQueries({ queryKey: ['pharmacy-profile'] });
    },
  });

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);

    try {
      // Re-add prefix +234
      const fullPhone = phone.trim().startsWith('+234')
        ? phone.trim()
        : `+234 ${phone.trim()}`;

      await updateProfileMutation.mutateAsync({
        pharmacy_name: pharmacyName,
        address,
        city,
        state,
        phone: fullPhone,
      });
    } catch (error) {
      console.error('Error saving profile:', error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();

    if (newPassword.length < 6) {
      alert('Password must be at least 6 characters');
      return;
    }

    setIsSaving(true);

    try {
      const supabase = createClient();
      const { error } = await supabase.auth.updateUser({
        password: newPassword,
      });

      if (error) {
        throw error;
      }

      alert('Password updated successfully');
      setCurrentPassword('');
      setNewPassword('');
    } catch (error: any) {
      console.error('Error changing password:', error);
      alert(error.message || 'Failed to change password');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeactivate = async () => {
    if (confirm('Are you sure you want to deactivate your pharmacy? Your inventory will be hidden from searches.')) {
      try {
        await updateProfileMutation.mutateAsync({
          is_active: false,
        });
        alert('Pharmacy has been deactivated.');
      } catch (err) {
        console.error(err);
      }
    }
  };

  if (authLoading || isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center min-h-[60vh]">
        <div className="flex items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-ink-muted text-lg">Loading settings...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-[680px] mx-auto py-4">
      <h1 className="text-[24px] font-medium text-ink mb-[28px]">Settings</h1>

      {/* Tabs */}
      <div className="flex gap-0 border-b border-border mb-8">
        <button
          onClick={() => setActiveTab('profile')}
          className={`pb-3 px-5 text-[15px] font-medium transition-colors border-b-2 ${
            activeTab === 'profile'
              ? 'text-primary border-primary font-medium'
              : 'text-ink-muted border-transparent hover:text-ink'
          }`}
        >
          Pharmacy profile
        </button>
        <button
          onClick={() => setActiveTab('account')}
          className={`pb-3 px-5 text-[15px] font-medium transition-colors border-b-2 ${
            activeTab === 'account'
              ? 'text-primary border-primary font-medium'
              : 'text-ink-muted border-transparent hover:text-ink'
          }`}
        >
          Account
        </button>
      </div>

      {/* Profile Tab Content */}
      {activeTab === 'profile' && (
        <form onSubmit={handleSaveProfile} className="flex flex-col gap-6">
          <div>
            <label className="block text-[14px] font-medium text-ink mb-2">Pharmacy name</label>
            <input
              type="text"
              value={pharmacyName}
              onChange={(e) => setPharmacyName(e.target.value)}
              required
              className="w-full h-12 border border-border rounded-button px-4 text-[15px] text-ink bg-white focus:outline-none focus:border-primary"
            />
          </div>

          <div>
            <label className="block text-[14px] font-medium text-ink mb-2">PCN license number</label>
            <div className="flex items-center gap-2.5">
              <input
                type="text"
                value={licenseNumber}
                disabled
                className="flex-1 h-12 border border-border rounded-button px-4 text-[15px] text-ink bg-[#F0F7FF] cursor-not-allowed focus:outline-none"
              />
              <span className="text-[13px] font-medium text-[#639922] bg-[#F2F7EA] px-3.5 py-2 rounded-button whitespace-nowrap">
                ✓ Verified
              </span>
            </div>
          </div>

          <div>
            <label className="block text-[14px] font-medium text-ink mb-2">Street address</label>
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              required
              className="w-full h-12 border border-border rounded-button px-4 text-[15px] text-ink bg-white focus:outline-none focus:border-primary"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[14px] font-medium text-ink mb-2">City</label>
              <input
                type="text"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                required
                className="w-full h-12 border border-border rounded-button px-4 text-[15px] text-ink bg-white focus:outline-none focus:border-primary"
              />
            </div>
            <div>
              <label className="block text-[14px] font-medium text-ink mb-2">State</label>
              <select
                value={state}
                onChange={(e) => setState(e.target.value)}
                className="w-full h-12 border border-border rounded-button px-3 text-[15px] text-ink bg-white focus:outline-none focus:border-primary"
              >
                <option value="Lagos">Lagos</option>
                <option value="Abuja (FCT)">Abuja (FCT)</option>
                <option value="Rivers">Rivers</option>
                <option value="Oyo">Oyo</option>
                <option value="Kano">Kano</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-[14px] font-medium text-ink mb-2">Phone number</label>
            <div className="flex gap-2">
              <div className="w-[72px] h-12 border border-border rounded-button flex items-center justify-center text-[15px] font-medium text-ink-muted bg-[#F0F7FF] flex-shrink-0">
                +234
              </div>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
                className="flex-1 h-12 border border-border rounded-button px-4 text-[15px] text-ink bg-white focus:outline-none focus:border-primary min-w-0"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[14px] font-medium text-ink mb-2">Opening time</label>
              <input
                type="text"
                value={openingTime}
                onChange={(e) => setOpeningTime(e.target.value)}
                className="w-full h-12 border border-border rounded-button px-4 text-[15px] text-ink bg-white focus:outline-none focus:border-primary"
              />
            </div>
            <div>
              <label className="block text-[14px] font-medium text-ink mb-2">Closing time</label>
              <input
                type="text"
                value={closingTime}
                onChange={(e) => setClosingTime(e.target.value)}
                className="w-full h-12 border border-border rounded-button px-4 text-[15px] text-ink bg-white focus:outline-none focus:border-primary"
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => {
                if (pharmacy) {
                  setPharmacyName(pharmacy.pharmacy_name || '');
                  setAddress(pharmacy.address || '');
                  setCity(pharmacy.city || '');
                  setState(pharmacy.state || 'Lagos');
                  const rawPhone = pharmacy.phone || '';
                  setPhone(rawPhone.replace('+234', '').trim());
                }
              }}
              className="h-12 flex items-center px-6 bg-white text-ink-muted border border-border font-medium text-[15px] rounded-button hover:bg-surface transition-colors"
            >
              Discard changes
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="h-12 flex items-center px-6 bg-primary text-white font-medium text-[15px] rounded-button hover:bg-[#0052A3] transition-colors disabled:opacity-60"
            >
              {isSaving ? 'Saving...' : 'Save changes'}
            </button>
          </div>

          {saveSuccess && (
            <p className="text-right text-success text-[14px] font-medium">
              Profile updated successfully
            </p>
          )}
        </form>
      )}

      {/* Account Tab Content */}
      {activeTab === 'account' && (
        <div className="flex flex-col gap-6">
          <form onSubmit={handleChangePassword} className="flex flex-col gap-6">
            <div>
              <label className="block text-[14px] font-medium text-ink mb-2">Email address</label>
              <input
                type="email"
                value={email}
                disabled
                className="w-full h-12 border border-border rounded-button px-4 text-[15px] text-ink bg-[#F0F7FF] cursor-not-allowed focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-[14px] font-medium text-ink mb-2">Current password</label>
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
                placeholder="Enter current password"
                className="w-full h-12 border border-border rounded-button px-4 text-[15px] text-ink bg-white focus:outline-none focus:border-primary"
              />
            </div>

            <div>
              <label className="block text-[14px] font-medium text-ink mb-2">New password</label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                placeholder="At least 8 characters"
                className="w-full h-12 border border-border rounded-button px-4 text-[15px] text-ink bg-white focus:outline-none focus:border-primary"
              />
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="submit"
                disabled={isSaving}
                className="h-12 flex items-center px-6 bg-primary text-white font-medium text-[15px] rounded-button hover:bg-[#0052A3] transition-colors disabled:opacity-60"
              >
                {isSaving ? 'Updating...' : 'Update password'}
              </button>
            </div>
          </form>

          {/* Danger Zone */}
          <div className="mt-6 pt-6 border-t border-border">
            <h3 className="text-[16px] font-medium text-[#E24B4A] mb-2">Danger zone</h3>
            <p className="text-[14px] text-ink-muted leading-[1.55]">
              Deactivating your pharmacy removes it from patient search results. Your data is kept for 90 days in case you reactivate.
            </p>
            <div className="mt-4">
              <button
                type="button"
                onClick={handleDeactivate}
                className="h-11 flex items-center px-5 bg-white text-[#E24B4A] border-[1.5px] border-[#E24B4A] font-medium text-[14px] rounded-button hover:bg-[#FBEDEC] transition-colors"
              >
                Deactivate pharmacy
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
