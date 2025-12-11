'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useUser } from '@/hooks/useUser';
import { createClient } from '@/lib/supabase/client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Store,
  User,
  Lock,
  Loader2,
  Save,
  CheckCircle
} from 'lucide-react';

export default function PharmacySettings() {
  const router = useRouter();
  const { user, isLoading: authLoading, isPharmacy } = useUser();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'profile' | 'account'>('profile');
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Form states
  const [pharmacyName, setPharmacyName] = useState('');
  const [licenseNumber, setLicenseNumber] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [phone, setPhone] = useState('');
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoUploadError, setLogoUploadError] = useState<string | null>(null);
  const [removeLogo, setRemoveLogo] = useState(false);
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);
  const [isActive, setIsActive] = useState(true);

  // Account settings
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

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
      setState(pharmacy.state || '');
      setPhone(pharmacy.phone || '');
      setLatitude(pharmacy.latitude?.toString() || '');
      setLongitude(pharmacy.longitude?.toString() || '');
      setLogoUrl(pharmacy.logo_url || null);
      setLogoPreview(pharmacy.logo_url || null);
      setLogoFile(null);
      setRemoveLogo(false);
      setLogoUploadError(null);
      setIsActive(pharmacy.is_active ?? true);
    }
  }, [pharmacy]);

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
    onSuccess: (updatedPharmacy) => {
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
      setLogoUrl(updatedPharmacy.logo_url || null);
      setLogoPreview(updatedPharmacy.logo_url || null);
      setLogoFile(null);
      setRemoveLogo(false);
      setIsActive(updatedPharmacy.is_active ?? true);
      queryClient.invalidateQueries({ queryKey: ['pharmacy-profile'] });
    },
  });

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);

    try {
      let nextLogoUrl = logoUrl;

      if (logoFile) {
        setIsUploadingLogo(true);
        const supabase = createClient();
        const fileExt = logoFile.name.split('.').pop()?.toLowerCase() || 'png';
        const uniqueName =
          (typeof crypto !== 'undefined' && 'randomUUID' in crypto
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`) +
          `.${fileExt}`;
        const filePath = `pharmacies/${uniqueName}`;

        const { error: uploadError } = await supabase.storage
          .from('pharmacy-assets')
          .upload(filePath, logoFile, {
            cacheControl: '3600',
            upsert: false,
            contentType: logoFile.type,
          });

        if (uploadError) {
          setLogoUploadError(uploadError.message);
          throw uploadError;
        }

        const {
          data: { publicUrl },
        } = supabase.storage.from('pharmacy-assets').getPublicUrl(filePath);

        nextLogoUrl = publicUrl;
      } else if (removeLogo) {
        nextLogoUrl = null;
      }

      setLogoUploadError(null);

      await updateProfileMutation.mutateAsync({
        pharmacy_name: pharmacyName,
        license_number: licenseNumber,
        address,
        city,
        state,
        phone,
        latitude: latitude ? parseFloat(latitude) : null,
        longitude: longitude ? parseFloat(longitude) : null,
        logo_url: nextLogoUrl,
        is_active: isActive,
      });
    } catch (error) {
      console.error('Error saving profile:', error);
    } finally {
      setIsUploadingLogo(false);
      setIsSaving(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();

    if (newPassword !== confirmPassword) {
      alert('New passwords do not match');
      return;
    }

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
      setConfirmPassword('');
    } catch (error: any) {
      console.error('Error changing password:', error);
      alert(error.message || 'Failed to change password');
    } finally {
      setIsSaving(false);
    }
  };

  const handleLogoChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    if (!file.type.startsWith('image/')) {
      setLogoUploadError('Please select a valid image file (PNG, JPG, or SVG).');
      return;
    }

    if (file.size > 1024 * 1024) {
      setLogoUploadError('Image size must be 1MB or less.');
      return;
    }

    setLogoUploadError(null);
    setLogoFile(file);
    setLogoPreview(URL.createObjectURL(file));
    setRemoveLogo(false);
  };

  const handleRemoveLogo = () => {
    setLogoFile(null);
    setLogoPreview(null);
    setRemoveLogo(true);
    setLogoUploadError(null);
  };

  if (authLoading || isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="flex items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-primary-blue" />
          <p className="text-gray-600 text-lg">Loading settings...</p>
        </div>
      </div>
    );
  }

  const isProfileSubmitting =
    isSaving || updateProfileMutation.isPending || isUploadingLogo;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Settings</h1>
          <p className="text-gray-600 mt-2">
            Manage your pharmacy profile and account settings
          </p>
        </div>

        {/* Tabs */}
        <div className="flex gap-4 mb-6 border-b border-gray-200">
          <button
            onClick={() => setActiveTab('profile')}
            className={`pb-3 px-4 font-medium transition-colors ${
              activeTab === 'profile'
                ? 'text-primary-blue border-b-2 border-primary-blue'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <Store className="h-4 w-4 inline mr-2" />
            Pharmacy Profile
          </button>
          <button
            onClick={() => setActiveTab('account')}
            className={`pb-3 px-4 font-medium transition-colors ${
              activeTab === 'account'
                ? 'text-primary-blue border-b-2 border-primary-blue'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <Lock className="h-4 w-4 inline mr-2" />
            Account Security
          </button>
        </div>

        {/* Pharmacy Profile Tab */}
        {activeTab === 'profile' && (
          <Card className="p-6">
            <form onSubmit={handleSaveProfile}>
              <div className="space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                  <div className="h-20 w-20 rounded-full overflow-hidden bg-gray-100 border border-dashed border-gray-200 flex items-center justify-center">
                    {logoPreview ? (
                      <img
                        src={logoPreview}
                        alt="Pharmacy logo preview"
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <span className="text-xs text-gray-500">Logo</span>
                    )}
                  </div>
                  <div className="space-y-2">
                    <label className="inline-flex">
                      <span className="px-4 py-2 border border-gray-300 rounded-md text-sm text-gray-700 hover:border-primary-blue transition-colors cursor-pointer">
                        {logoPreview ? 'Change logo' : 'Upload logo'}
                      </span>
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/svg+xml"
                        className="hidden"
                        onChange={handleLogoChange}
                      />
                    </label>
                    {logoPreview && (
                      <button
                        type="button"
                        onClick={handleRemoveLogo}
                        className="text-sm text-red-600 hover:underline"
                      >
                        Remove logo
                      </button>
                    )}
                    <p className="text-xs text-gray-500">
                      PNG, JPG, or SVG. Maximum size 1MB.
                    </p>
                    {logoUploadError && (
                      <p className="text-xs text-red-600">{logoUploadError}</p>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Pharmacy Name *
                    </label>
                    <Input
                      value={pharmacyName}
                      onChange={(e) => setPharmacyName(e.target.value)}
                      required
                      placeholder="Enter pharmacy name"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      License Number *
                    </label>
                    <Input
                      value={licenseNumber}
                      onChange={(e) => setLicenseNumber(e.target.value)}
                      required
                      placeholder="Enter license number"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Address *
                  </label>
                  <Input
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    required
                    placeholder="Enter street address"
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      City *
                    </label>
                    <Input
                      value={city}
                      onChange={(e) => setCity(e.target.value)}
                      required
                      placeholder="Enter city"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      State *
                    </label>
                    <Input
                      value={state}
                      onChange={(e) => setState(e.target.value)}
                      required
                      placeholder="Enter state"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Phone Number *
                  </label>
                  <Input
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    required
                    type="tel"
                    placeholder="Enter phone number"
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Inventory Visibility
                    </label>
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-6 p-4 border border-gray-200 rounded-lg bg-white">
                      <div>
                        <p className="text-sm font-semibold text-gray-900">
                          {isActive ? 'Currently accepting orders' : 'Temporarily unavailable'}
                        </p>
                        <p className="text-xs text-gray-600 mt-1">
                          {isActive
                            ? 'Your inventory will be visible to patients searching for medications.'
                            : 'Your pharmacy will be hidden from patient searches and AI recommendations until you reactivate.'}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setIsActive((prev) => !prev)}
                        className={`relative inline-flex h-8 w-16 shrink-0 cursor-pointer rounded-full transition-colors ${
                          isActive ? 'bg-green-500' : 'bg-gray-300'
                        }`}
                        aria-label="Toggle pharmacy visibility"
                      >
                        <span
                          className={`pointer-events-none absolute left-1 top-1 h-6 w-6 rounded-full bg-white transition-transform ${
                            isActive ? 'translate-x-8' : 'translate-x-0'
                          }`}
                        />
                      </button>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Latitude (Optional)
                    </label>
                    <Input
                      value={latitude}
                      onChange={(e) => setLatitude(e.target.value)}
                      type="number"
                      step="any"
                      placeholder="e.g., 6.5244"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Longitude (Optional)
                    </label>
                    <Input
                      value={longitude}
                      onChange={(e) => setLongitude(e.target.value)}
                      type="number"
                      step="any"
                      placeholder="e.g., 3.3792"
                    />
                  </div>
                </div>

                <div className="flex items-center gap-4 pt-4">
                  <Button
                    type="submit"
                    disabled={isProfileSubmitting}
                    className="min-w-[140px]"
                  >
                    {isProfileSubmitting ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      <>
                        <Save className="h-4 w-4 mr-2" />
                        Save Changes
                      </>
                    )}
                  </Button>

                  {saveSuccess && (
                    <span className="inline-flex items-center gap-2 text-green-600 text-sm font-medium">
                      <CheckCircle className="h-4 w-4" />
                      Changes saved successfully
                    </span>
                  )}
                </div>
              </div>
            </form>
          </Card>
        )}

        {/* Account Security Tab */}
        {activeTab === 'account' && (
          <Card className="p-6">
            <form onSubmit={handleChangePassword}>
              <div className="space-y-6">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">
                    Change Password
                  </h3>
                  <p className="text-sm text-gray-600 mb-6">
                    Update your password to keep your account secure
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Current Password
                  </label>
                  <Input
                    type="password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    required
                    placeholder="Enter current password"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    New Password
                  </label>
                  <Input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    required
                    minLength={6}
                    placeholder="Enter new password"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Must be at least 6 characters
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Confirm New Password
                  </label>
                  <Input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                    minLength={6}
                    placeholder="Confirm new password"
                  />
                </div>

                <div className="pt-4">
                  <Button type="submit" disabled={isSaving}>
                    {isSaving ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Updating...
                      </>
                    ) : (
                      <>
                        <Lock className="h-4 w-4 mr-2" />
                        Update Password
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </form>
          </Card>
        )}
      </div>
    </div>
  );
}
