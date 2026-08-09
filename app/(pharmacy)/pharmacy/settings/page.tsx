'use client';

import { Button } from '@/components/ui/button'

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useUser } from '@/hooks/useUser';
import { createClient } from '@/lib/supabase/client';
import { AlertTriangle, BadgeCheck, Clock3, Crosshair, FileCheck2, Loader2, MapPin, ShieldCheck } from 'lucide-react';
import { PharmacyLogoEditor } from '@/components/pharmacy/PharmacyLogoEditor';
import { SettingsTabStrip } from '@/components/pharmacy/SettingsTabStrip';
import { SpSettingsPanel } from '@/components/pharmacy/SpSettingsPanel';
import { SpAuthorizationModal } from '@/components/pharmacy/SpAuthorizationModal';
import {
  clearCachedSpToken,
  getCachedSpToken,
  isSpAuthorizationRequired,
  spAuthorizationRequiredError,
  withSpAuthorizationHeader,
} from '@/lib/sp-authorization-client';

type VerificationStatus = 'provisional' | 'full' | 'revoked';

function formatDeadline(value: string | null | undefined) {
  if (!value) return 'Deadline unavailable';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Deadline unavailable';
  return new Intl.DateTimeFormat('en-NG', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

export default function PharmacySettings() {
  const router = useRouter();
  const { user, isLoading: authLoading, isPharmacy } = useUser();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'profile' | 'security' | 'account'>('profile');
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [premisesCertificate, setPremisesCertificate] = useState<File | null>(null);
  const [superintendentLicence, setSuperintendentLicence] = useState<File | null>(null);
  const [agreedToStandards, setAgreedToStandards] = useState(false);

  // Profile Form states
  const [pharmacyName, setPharmacyName] = useState('');
  const [licenseNumber, setLicenseNumber] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('Lagos');
  const [phone, setPhone] = useState('');
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [openingTime, setOpeningTime] = useState('08:00');
  const [closingTime, setClosingTime] = useState('21:00');
  const [isLocating, setIsLocating] = useState(false);
  const [settingsAuthorization, setSettingsAuthorization] = useState<null | {
    description: string;
    run: (token: string | null) => Promise<void>;
  }>(null);

  // Account Form states
  const [email, setEmail] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  useEffect(() => {
    const requestedTab = new URLSearchParams(window.location.search).get('tab');
    if (requestedTab === 'profile' || requestedTab === 'security' || requestedTab === 'account') {
      setActiveTab(requestedTab);
    }
  }, []);

  useEffect(() => {
    if (!authLoading && (!user || !isPharmacy)) {
      router.push('/login?redirectTo=/pharmacy/settings');
    }
  }, [user, authLoading, isPharmacy, router]);

  const {
    data: pharmacy,
    isLoading,
    isFetching,
    isError: isPharmacyProfileError,
    error: pharmacyProfileError,
    refetch: refetchPharmacyProfile,
  } = useQuery({
    queryKey: ['pharmacy-profile'],
    queryFn: async () => {
      const response = await fetch('/api/pharmacy/profile');
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error || 'Failed to fetch pharmacy profile');
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
      setLatitude(pharmacy.latitude == null ? '' : String(pharmacy.latitude));
      setLongitude(pharmacy.longitude == null ? '' : String(pharmacy.longitude));
      setIsActive(pharmacy.is_active !== false);
      setOpeningTime(pharmacy.opening_time?.slice(0, 5) || '08:00');
      setClosingTime(pharmacy.closing_time?.slice(0, 5) || '21:00');

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
    mutationFn: async ({ data, token }: { data: any; token: string | null }) => {
      const response = await fetch('/api/pharmacy/profile', {
        method: 'PATCH',
        headers: withSpAuthorizationHeader('pharmacy_settings', token, { 'Content-Type': 'application/json' }),
        body: JSON.stringify(data),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        if (response.status === 403 && body?.code === 'SP_AUTH_REQUIRED') {
          clearCachedSpToken('pharmacy_settings');
          throw spAuthorizationRequiredError(body?.error || 'Superintendent authorization is required.');
        }
        throw new Error(body?.error || 'Failed to update profile');
      }
      return response.json();
    },
    onSuccess: () => {
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
      queryClient.invalidateQueries({ queryKey: ['pharmacy-profile'] });
    },
  });

  const runSettingsAction = async (
    description: string,
    operation: (token: string | null) => Promise<void>,
  ) => {
    try {
      await operation(getCachedSpToken('pharmacy_settings'));
    } catch (error) {
      if (!isSpAuthorizationRequired(error)) throw error;
      clearCachedSpToken('pharmacy_settings');
      setSettingsAuthorization({ description, run: operation });
    }
  };

  const submitVerificationMutation = useMutation({
    mutationFn: async () => {
      if (!premisesCertificate || !superintendentLicence || !agreedToStandards) {
        throw new Error('Attach both required documents and agree to the current standards.');
      }

      const formData = new FormData();
      formData.append('premises_certificate', premisesCertificate);
      formData.append('superintendent_annual_licence', superintendentLicence);
      formData.append('agree_to_standards', 'true');

      const response = await fetch('/api/pharmacy/verification', {
        method: 'POST',
        body: formData,
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.error || 'Could not submit verification requirements.');
      }
      return data;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(['pharmacy-profile'], (current: any) => ({
        ...current,
        ...(data?.pharmacy ?? {}),
      }));
      queryClient.invalidateQueries({ queryKey: ['pharmacy-profile'] });
      setPremisesCertificate(null);
      setSuperintendentLicence(null);
      setAgreedToStandards(false);
    },
  });

  const saveProfile = async (token: string | null) => {
    setIsSaving(true);

    try {
      const parsedLatitude = latitude.trim() === '' ? null : Number(latitude);
      const parsedLongitude = longitude.trim() === '' ? null : Number(longitude);
      if (
        (parsedLatitude === null) !== (parsedLongitude === null)
        || (parsedLatitude !== null && (!Number.isFinite(parsedLatitude) || parsedLatitude < -90 || parsedLatitude > 90))
        || (parsedLongitude !== null && (!Number.isFinite(parsedLongitude) || parsedLongitude < -180 || parsedLongitude > 180))
      ) {
        throw new Error('Enter a valid latitude and longitude together.');
      }
      if (openingTime === closingTime) {
        throw new Error('Opening and closing times must be different.');
      }
      // Re-add prefix +234
      const fullPhone = phone.trim().startsWith('+234')
        ? phone.trim()
        : `+234 ${phone.trim()}`;

      await updateProfileMutation.mutateAsync({ token, data: {
        pharmacy_name: pharmacyName,
        address,
        city,
        state,
        phone: fullPhone,
        latitude: parsedLatitude,
        longitude: parsedLongitude,
        is_active: isActive,
        opening_time: openingTime,
        closing_time: closingTime,
      }});
    } catch (error) {
      if (isSpAuthorizationRequired(error)) throw error;
      console.error('Error saving profile:', error);
      alert(error instanceof Error ? error.message : 'Could not save the pharmacy profile.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    await runSettingsAction('Authorise changes to the pharmacy profile, visibility, location, or hours', saveProfile);
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
      if (!user?.email) throw new Error('Your account email is unavailable. Sign in again and retry.');
      const { error: reauthenticationError } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: currentPassword,
      });
      if (reauthenticationError) throw new Error('Current password is incorrect.');
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

  const useCurrentLocation = () => {
    if (!navigator.geolocation) {
      alert('Location is not available in this browser.');
      return;
    }
    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLatitude(position.coords.latitude.toFixed(6));
        setLongitude(position.coords.longitude.toFixed(6));
        setIsLocating(false);
      },
      () => {
        alert('Could not get this device location. Allow location access or enter the coordinates manually.');
        setIsLocating(false);
      },
      { enableHighAccuracy: true, timeout: 15_000 },
    );
  };

  const handleDeactivate = async () => {
    if (confirm('Are you sure you want to deactivate your pharmacy? Your inventory will be hidden from searches.')) {
      try {
        await runSettingsAction('Authorise deactivating this pharmacy', async (token) => {
          await updateProfileMutation.mutateAsync({ token, data: { is_active: false } });
          alert('Pharmacy has been deactivated.');
        });
      } catch (err) {
        console.error(err);
      }
    }
  };

  if (
    authLoading
    || (!user || !isPharmacy)
    || (!!user && isPharmacy && (isLoading || (!pharmacy?.id && isFetching)))
  ) {
    return (
      <div className="flex-1 flex items-center justify-center min-h-[60vh]">
        <div className="flex items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-ink-muted text-lg">Loading settings...</p>
        </div>
      </div>
    );
  }

  if (isPharmacyProfileError || !pharmacy?.id) {
    return (
      <div className="mx-auto flex min-h-[60vh] max-w-[560px] items-center justify-center px-4">
        <div className="w-full rounded-card border border-danger/25 bg-danger/5 p-5 text-center sm:p-6" role="alert">
          <AlertTriangle className="mx-auto h-8 w-8 text-danger" aria-hidden="true" />
          <h1 className="mt-3 text-[20px] font-semibold text-ink">Settings could not load</h1>
          <p className="mt-2 text-[14px] leading-6 text-ink-muted">
            {pharmacyProfileError instanceof Error
              ? pharmacyProfileError.message
              : 'Your pharmacy profile was not returned. Please try again.'}
          </p>
          <Button
            type="button"
            onClick={() => void refetchPharmacyProfile()}
            className="mt-5 min-h-11"
          >
            Try again
          </Button>
        </div>
      </div>
    );
  }

  const verificationStatus = (pharmacy?.verification_status ?? (
    pharmacy?.is_verified ? 'full' : 'revoked'
  )) as VerificationStatus;
  const isFullyVerified = verificationStatus === 'full' && pharmacy?.is_verified === true;
  const provisionalDeadline = pharmacy?.provisional_expires_at
    ? new Date(pharmacy.provisional_expires_at)
    : null;
  const isProvisionalActive = verificationStatus === 'provisional'
    && provisionalDeadline !== null
    && provisionalDeadline.getTime() > Date.now();
  const requirementsSubmitted = Boolean(pharmacy?.verification_submitted_at);

  return (
    <div className="max-w-[680px] mx-auto py-4">
      <h1 className="text-[24px] font-medium text-ink mb-[28px]">Settings</h1>

      <div className="mb-8">
        <SettingsTabStrip active={activeTab} onSectionChange={setActiveTab} />
      </div>

      {/* Profile Tab Content */}
      {activeTab === 'profile' && (
        <form onSubmit={handleSaveProfile} className="flex flex-col gap-6">
          <PharmacyLogoEditor
            pharmacyId={pharmacy.id}
            pharmacyName={pharmacyName || pharmacy.pharmacy_name || 'Pharmacy'}
            logoUrl={pharmacy.logo_url ?? null}
            onChanged={(logoUrl) => {
              queryClient.setQueryData(['pharmacy-profile'], (current: any) => ({
                ...current,
                logo_url: logoUrl,
              }));
            }}
            authorize={(description, operation) => {
              void runSettingsAction(description, operation);
            }}
          />
          <section
            className={`rounded-card border p-4 sm:p-5 ${
              isFullyVerified
                ? 'border-success/25 bg-success/5'
                : isProvisionalActive
                  ? 'border-warning/30 bg-warning/5'
                  : 'border-danger/25 bg-danger/5'
            }`}
            aria-labelledby="verification-status-heading"
          >
            <div className="flex items-start gap-3">
              {isFullyVerified ? (
                <ShieldCheck className="mt-0.5 h-6 w-6 shrink-0 text-success" aria-hidden="true" />
              ) : isProvisionalActive ? (
                <Clock3 className="mt-0.5 h-6 w-6 shrink-0 text-warning" aria-hidden="true" />
              ) : (
                <AlertTriangle className="mt-0.5 h-6 w-6 shrink-0 text-danger" aria-hidden="true" />
              )}
              <div className="min-w-0 flex-1">
                <h2 id="verification-status-heading" className="text-[15px] font-semibold text-ink">
                  {isFullyVerified
                    ? 'Full pharmacy verification'
                    : isProvisionalActive
                      ? 'Provisional visibility'
                      : 'Pharmacy visibility revoked'}
                </h2>
                <p className="mt-1.5 text-[13px] leading-[1.6] text-ink-muted">
                  {isFullyVerified
                    ? 'Your evidence has been reviewed by StocMed. When reservations are on, OTC holds and digital prescription reservations are eligible.'
                    : isProvisionalActive
                      ? `Your pharmacy remains visible until ${formatDeadline(pharmacy?.provisional_expires_at)}. OTC holds can follow your reservation setting; prescription medicines remain call-only until full review.`
                      : requirementsSubmitted
                        ? 'Your provisional window has ended, so the pharmacy is hidden from patient search while the evidence submitted within the deadline awaits an authorized StocMed decision.'
                        : 'Your provisional window ended before the required evidence was submitted. The pharmacy is hidden from patient search; contact StocMed verification support to resolve the registration.'}
                </p>
                {requirementsSubmitted && !isFullyVerified && (
                  <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-white px-3 py-1.5 text-xs font-semibold text-primary">
                    <FileCheck2 className="h-4 w-4" aria-hidden="true" />
                    Evidence submitted {formatDeadline(pharmacy.verification_submitted_at)} · awaiting review
                  </div>
                )}
              </div>
            </div>
          </section>

          {!isFullyVerified && !requirementsSubmitted && isProvisionalActive && (
            <section className="rounded-card border border-border bg-white p-4 sm:p-5" aria-labelledby="verification-requirements-heading">
              <div className="mb-4">
                <h2 id="verification-requirements-heading" className="text-[15px] font-semibold text-ink">
                  Complete full-verification requirements
                </h2>
                <p className="mt-1.5 text-[13px] leading-[1.6] text-ink-muted">
                  Both documents are stored privately and reviewed by authorized StocMed personnel. Submission does not self-verify the pharmacy.
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="flex min-w-0 flex-col gap-2 text-[13px] font-semibold text-ink">
                  PCN premises certificate
                  <input
                    type="file"
                    accept="image/jpeg,image/png,application/pdf"
                    onChange={(event) => setPremisesCertificate(event.currentTarget.files?.[0] ?? null)}
                    className="min-w-0 rounded-button border border-border bg-surface px-3 py-2 text-xs font-normal text-ink file:mr-2 file:rounded-button file:border-0 file:bg-white file:px-2.5 file:py-1.5 file:text-xs file:font-semibold file:text-primary"
                  />
                </label>
                <label className="flex min-w-0 flex-col gap-2 text-[13px] font-semibold text-ink">
                  Superintendent pharmacist annual licence
                  <input
                    type="file"
                    accept="image/jpeg,image/png,application/pdf"
                    onChange={(event) => setSuperintendentLicence(event.currentTarget.files?.[0] ?? null)}
                    className="min-w-0 rounded-button border border-border bg-surface px-3 py-2 text-xs font-normal text-ink file:mr-2 file:rounded-button file:border-0 file:bg-white file:px-2.5 file:py-1.5 file:text-xs file:font-semibold file:text-primary"
                  />
                </label>
              </div>
              <p className="mt-2 text-xs text-ink-light">JPEG, PNG, or PDF · 5 MB maximum for each file</p>

              <label className="mt-4 flex items-start gap-2.5 text-[13px] leading-[1.55] text-ink-muted">
                <input
                  type="checkbox"
                  checked={agreedToStandards}
                  onChange={(event) => setAgreedToStandards(event.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0"
                  style={{ accentColor: 'var(--primary)' }}
                />
                <span>
                  I am authorized to act for this pharmacy, confirm these documents are current, and agree to the current StocMed PCN pilot standards.
                </span>
              </label>

              <div className="mt-4 flex flex-col items-start gap-3 sm:flex-row sm:items-center">
                <Button
                  type="button"
                  disabled={
                    submitVerificationMutation.isPending
                    || !premisesCertificate
                    || !superintendentLicence
                    || !agreedToStandards
                  }
                  onClick={() => submitVerificationMutation.mutate()}
                  className="h-11 gap-2"
                >
                  {submitVerificationMutation.isPending && (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  )}
                  Submit for full review
                </Button>
                {submitVerificationMutation.error && (
                  <p className="text-[13px] font-medium text-danger" role="alert">
                    {submitVerificationMutation.error instanceof Error
                      ? submitVerificationMutation.error.message
                      : 'Could not submit verification requirements.'}
                  </p>
                )}
              </div>
            </section>
          )}

          <section className="rounded-card border border-border bg-white p-4 sm:p-5" aria-labelledby="visibility-toggle-label">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 id="visibility-toggle-label" className="text-[15px] font-semibold text-ink">Pharmacy visibility</h2>
                <p id="visibility-toggle-description" className="mt-1.5 text-[13px] leading-5 text-ink-muted">
                  Pause patient visibility without deleting inventory or sales history.
                </p>
              </div>
              <button
                data-testid="pharmacy-active"
                type="button"
                role="switch"
                aria-checked={isActive}
                aria-labelledby="visibility-toggle-label"
                aria-describedby="visibility-toggle-description"
                onClick={() => setIsActive((current) => !current)}
                className={`relative inline-flex h-7 w-12 shrink-0 rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${isActive ? 'bg-primary' : 'bg-ink-muted/30'}`}
              >
                <span className="sr-only">{isActive ? 'Pause pharmacy visibility' : 'Resume pharmacy visibility'}</span>
                <span className={`inline-block h-6 w-6 rounded-full bg-white shadow-sm transition-transform ${isActive ? 'translate-x-5' : 'translate-x-0'}`} />
              </button>
            </div>
            <p className={`mt-3 text-[13px] font-medium ${isActive ? 'text-success' : 'text-warning'}`}>
              {isActive ? 'Visible to patients' : 'Paused — hidden from patient search'}
            </p>
          </section>

          <div>
            <label htmlFor="pharmacy-name" className="block text-[14px] font-medium text-ink mb-2">Pharmacy name</label>
            <input
              id="pharmacy-name"
              data-testid="pharmacy-name"
              type="text"
              value={pharmacyName}
              onChange={(e) => setPharmacyName(e.target.value)}
              required
              className="w-full h-12 border border-border rounded-button px-4 text-[15px] text-ink bg-white focus:outline-none focus:border-primary"
            />
          </div>

          <div>
            <label htmlFor="license-number" className="block text-[14px] font-medium text-ink mb-2">PCN premises number</label>
            <div className="flex items-center gap-2.5">
              <input
                id="license-number"
                type="text"
                value={licenseNumber}
                disabled
                className="flex-1 h-12 border border-border rounded-button px-4 text-[15px] text-ink bg-[var(--surface)] cursor-not-allowed focus:outline-none"
              />
              <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-button px-3.5 py-2 text-[13px] font-medium ${
                isFullyVerified
                  ? 'bg-[var(--success-tint)] text-[var(--success)]'
                  : isProvisionalActive
                    ? 'bg-warning/10 text-warning'
                    : 'bg-danger/10 text-danger'
              }`}>
                {isFullyVerified ? (
                  <BadgeCheck className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
                ) : isProvisionalActive ? (
                  <Clock3 className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                )}
                {isFullyVerified ? 'Full' : isProvisionalActive ? 'Provisional' : 'Revoked'}
              </span>
            </div>
          </div>

          <div>
            <label htmlFor="pharmacy-address" className="block text-[14px] font-medium text-ink mb-2">Street address</label>
            <input
              id="pharmacy-address"
              data-testid="pharmacy-address"
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              required
              className="w-full h-12 border border-border rounded-button px-4 text-[15px] text-ink bg-white focus:outline-none focus:border-primary"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="pharmacy-city" className="block text-[14px] font-medium text-ink mb-2">City</label>
              <input
                id="pharmacy-city"
                data-testid="pharmacy-city"
                type="text"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                required
                className="w-full h-12 border border-border rounded-button px-4 text-[15px] text-ink bg-white focus:outline-none focus:border-primary"
              />
            </div>
            <div>
              <label htmlFor="pharmacy-state" className="block text-[14px] font-medium text-ink mb-2">State</label>
              <select
                id="pharmacy-state"
                data-testid="pharmacy-state"
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
            <label htmlFor="pharmacy-phone" className="block text-[14px] font-medium text-ink mb-2">Phone number</label>
            <div className="flex gap-2">
              <div className="w-[72px] h-12 border border-border rounded-button flex items-center justify-center text-[15px] font-medium text-ink-muted bg-[var(--surface)] flex-shrink-0">
                +234
              </div>
              <input
                id="pharmacy-phone"
                data-testid="pharmacy-phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
                className="flex-1 h-12 border border-border rounded-button px-4 text-[15px] text-ink bg-white focus:outline-none focus:border-primary min-w-0"
              />
            </div>
          </div>

          <section className="rounded-card border border-border bg-white p-4 sm:p-5" aria-labelledby="pharmacy-location-heading">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 id="pharmacy-location-heading" className="flex items-center gap-2 text-[15px] font-semibold text-ink">
                  <MapPin className="h-4 w-4 text-primary" />
                  Pharmacy map location
                </h2>
                <p className="mt-1.5 text-[13px] leading-5 text-ink-muted">
                  Patient distance ranking uses this exact point. Stand at the pharmacy entrance for the best result.
                </p>
              </div>
              <Button type="button" variant="outline" disabled={isLocating} onClick={useCurrentLocation} className="h-10 gap-2">
                {isLocating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Crosshair className="h-4 w-4" />}
                Use this device
              </Button>
            </div>
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <label className="text-[14px] font-medium text-ink">
                Latitude
                <input data-testid="pharmacy-latitude" type="number" min="-90" max="90" step="0.000001" value={latitude} onChange={(event) => setLatitude(event.target.value)} placeholder="6.524400" className="mt-2 h-12 w-full rounded-button border border-border px-4 text-[15px] outline-none focus:border-primary" />
              </label>
              <label className="text-[14px] font-medium text-ink">
                Longitude
                <input data-testid="pharmacy-longitude" type="number" min="-180" max="180" step="0.000001" value={longitude} onChange={(event) => setLongitude(event.target.value)} placeholder="3.379200" className="mt-2 h-12 w-full rounded-button border border-border px-4 text-[15px] outline-none focus:border-primary" />
              </label>
            </div>
          </section>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="opening-time" className="block text-[14px] font-medium text-ink mb-2">Opening time</label>
              <input
                id="opening-time"
                data-testid="opening-time"
                type="time"
                value={openingTime}
                onChange={(e) => setOpeningTime(e.target.value)}
                className="w-full h-12 border border-border rounded-button px-4 text-[15px] text-ink bg-white focus:outline-none focus:border-primary"
              />
            </div>
            <div>
              <label htmlFor="closing-time" className="block text-[14px] font-medium text-ink mb-2">Closing time</label>
              <input
                id="closing-time"
                data-testid="closing-time"
                type="time"
                value={closingTime}
                onChange={(e) => setClosingTime(e.target.value)}
                className="w-full h-12 border border-border rounded-button px-4 text-[15px] text-ink bg-white focus:outline-none focus:border-primary"
              />
            </div>
          </div>

          <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:items-center sm:justify-end">
            <Button
              type="button"
              onClick={() => {
                if (pharmacy) {
                  setPharmacyName(pharmacy.pharmacy_name || '');
                  setAddress(pharmacy.address || '');
                  setCity(pharmacy.city || '');
                  setState(pharmacy.state || 'Lagos');
                  const rawPhone = pharmacy.phone || '';
                  setPhone(rawPhone.replace('+234', '').trim());
                  setLatitude(pharmacy.latitude == null ? '' : String(pharmacy.latitude));
                  setLongitude(pharmacy.longitude == null ? '' : String(pharmacy.longitude));
                  setIsActive(pharmacy.is_active !== false);
                  setOpeningTime(pharmacy.opening_time?.slice(0, 5) || '08:00');
                  setClosingTime(pharmacy.closing_time?.slice(0, 5) || '21:00');
                }
              }}
              className="h-12 w-full items-center border border-border bg-white px-6 text-[15px] font-medium text-ink-muted hover:bg-surface sm:w-auto"
            >
              Discard changes
            </Button>
            <Button
              data-testid="save-pharmacy-profile"
              type="submit"
              disabled={isSaving}
              className="h-12 w-full items-center px-6 text-[15px] font-medium sm:w-auto"
            >
              {isSaving ? 'Saving...' : 'Save changes'}
            </Button>
          </div>

          {saveSuccess && (
            <p className="text-right text-success text-[14px] font-medium">
              Profile updated successfully
            </p>
          )}
        </form>
      )}

      {activeTab === 'security' && <SpSettingsPanel />}

      {/* Account Tab Content */}
      {activeTab === 'account' && (
        <div className="flex flex-col gap-6">
          <form onSubmit={handleChangePassword} className="flex flex-col gap-6">
            <div>
              <label htmlFor="account-email" className="block text-[14px] font-medium text-ink mb-2">Email address</label>
              <input
                id="account-email"
                type="email"
                value={email}
                disabled
                className="w-full h-12 border border-border rounded-button px-4 text-[15px] text-ink bg-[var(--surface)] cursor-not-allowed focus:outline-none"
              />
            </div>

            <div>
              <label htmlFor="current-password" className="block text-[14px] font-medium text-ink mb-2">Current password</label>
              <input
                id="current-password"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
                placeholder="Enter current password"
                className="w-full h-12 border border-border rounded-button px-4 text-[15px] text-ink bg-white focus:outline-none focus:border-primary"
              />
            </div>

            <div>
              <label htmlFor="new-password" className="block text-[14px] font-medium text-ink mb-2">New password</label>
              <input
                id="new-password"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                placeholder="At least 8 characters"
                className="w-full h-12 border border-border rounded-button px-4 text-[15px] text-ink bg-white focus:outline-none focus:border-primary"
              />
            </div>

            <div>
              <label htmlFor="confirm-password" className="block text-[14px] font-medium text-ink mb-2">Confirm new password</label>
              <input
                id="confirm-password"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                placeholder="Type the new password again"
                className="w-full h-12 border border-border rounded-button px-4 text-[15px] text-ink bg-white focus:outline-none focus:border-primary"
              />
            </div>

            <div className="flex justify-end pt-2">
              <Button
                type="submit"
                disabled={isSaving}
                className="h-12 flex items-center px-6 bg-primary text-white font-medium text-[15px] rounded-button hover:bg-[var(--primary-hover)] transition-colors disabled:opacity-60"
              >
                {isSaving ? 'Updating...' : 'Update password'}
              </Button>
            </div>
          </form>

          {/* Danger Zone */}
          <div className="mt-6 pt-6 border-t border-border">
            <h3 className="text-[16px] font-medium text-[var(--danger)] mb-2">Danger zone</h3>
            <p className="text-[14px] text-ink-muted leading-[1.55]">
              Deactivating your pharmacy removes it from patient search results. Your data is kept for 90 days in case you reactivate.
            </p>
            <div className="mt-4">
              <Button
                type="button"
                onClick={handleDeactivate}
                className="h-11 flex items-center px-5 bg-white text-[var(--danger)] border-[1.5px] border-[var(--danger)] font-medium text-[14px] rounded-button hover:bg-[var(--danger-tint)] transition-colors"
              >
                Deactivate pharmacy
              </Button>
            </div>
          </div>
        </div>
      )}
      <SpAuthorizationModal
        open={settingsAuthorization !== null}
        action="pharmacy_settings"
        description={settingsAuthorization?.description ?? 'Authorise changing pharmacy settings'}
        onAuthorized={async (token) => {
          const request = settingsAuthorization;
          if (request) await request.run(token);
          setSettingsAuthorization(null);
        }}
        onClose={() => setSettingsAuthorization(null)}
      />
    </div>
  );
}
