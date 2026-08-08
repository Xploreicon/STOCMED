'use client';

import { Button } from '@/components/ui/button'

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useUser } from '@/hooks/useUser';
import { createClient } from '@/lib/supabase/client';
import { AlertTriangle, BadgeCheck, Clock3, FileCheck2, Loader2, ShieldCheck } from 'lucide-react';

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
  const [activeTab, setActiveTab] = useState<'profile' | 'account'>('profile');
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

  const updateReservationsMutation = useMutation({
    mutationFn: async (reservationsEnabled: boolean) => {
      const response = await fetch('/api/pharmacy/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reservations_enabled: reservationsEnabled }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.error || 'Failed to update reservation settings');
      }
      return data;
    },
    onSuccess: (updatedPharmacy, reservationsEnabled) => {
      queryClient.setQueryData(['pharmacy-profile'], (current: any) => ({
        ...current,
        ...updatedPharmacy,
        reservations_enabled: updatedPharmacy?.reservations_enabled ?? reservationsEnabled,
      }));
      queryClient.invalidateQueries({ queryKey: ['pharmacy-profile'] });
      queryClient.invalidateQueries({ queryKey: ['pharmacy-reservations-summary'] });
    },
  });

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

      {/* Tabs */}
      <nav
        aria-label="Pharmacy settings sections"
        className="mb-8 overflow-x-auto rounded-button border border-border bg-surface p-1"
      >
        <div className="flex min-w-max items-center gap-1">
          <button
            type="button"
            onClick={() => setActiveTab('profile')}
            aria-current={activeTab === 'profile' ? 'page' : undefined}
            className={`inline-flex min-h-11 items-center justify-center rounded-button px-4 text-[14px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${
              activeTab === 'profile'
                ? 'bg-primary text-white shadow-sm'
                : 'text-ink-muted hover:bg-white hover:text-ink'
            }`}
          >
            Pharmacy profile
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('account')}
            aria-current={activeTab === 'account' ? 'page' : undefined}
            className={`inline-flex min-h-11 items-center justify-center rounded-button px-4 text-[14px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${
              activeTab === 'account'
                ? 'bg-primary text-white shadow-sm'
                : 'text-ink-muted hover:bg-white hover:text-ink'
            }`}
          >
            Account
          </button>
        </div>
      </nav>

      {/* Profile Tab Content */}
      {activeTab === 'profile' && (
        <form onSubmit={handleSaveProfile} className="flex flex-col gap-6">
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

          <section className="rounded-card border border-border bg-surface p-4 sm:p-5" aria-labelledby="reservations-toggle-label">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h2 id="reservations-toggle-label" className="text-[15px] font-semibold text-ink">
                  Accept reservations (hold stock for patients)
                </h2>
                <p id="reservations-toggle-description" className="mt-2 text-[14px] leading-[1.55] text-ink-muted">
                  When ON, patients can reserve eligible stock for pickup. Provisional pharmacies remain call-only for prescription medicines; OTC holds are unaffected. You must monitor the queue so holds don&apos;t expire.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={pharmacy?.reservations_enabled === true}
                aria-labelledby="reservations-toggle-label"
                aria-describedby="reservations-toggle-description"
                disabled={updateReservationsMutation.isPending}
                onClick={() => {
                  updateReservationsMutation.reset();
                  updateReservationsMutation.mutate(!(pharmacy?.reservations_enabled === true));
                }}
                className={`relative mt-0.5 inline-flex h-7 w-12 flex-shrink-0 rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-60 ${
                  pharmacy?.reservations_enabled === true ? 'bg-primary' : 'bg-ink-muted/30'
                }`}
              >
                <span className="sr-only">
                  {pharmacy?.reservations_enabled === true ? 'Turn reservations off' : 'Turn reservations on'}
                </span>
                <span
                  aria-hidden="true"
                  className={`pointer-events-none inline-block h-6 w-6 rounded-full bg-white shadow-sm transition-transform ${
                    pharmacy?.reservations_enabled === true ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
            <div className="mt-3 flex items-center gap-2 text-[13px] font-medium">
              <span className={pharmacy?.reservations_enabled === true ? 'text-success' : 'text-ink-muted'}>
                Reservations are {pharmacy?.reservations_enabled === true ? 'ON' : 'OFF'}
              </span>
              {updateReservationsMutation.isPending && (
                <span className="inline-flex items-center gap-1.5 text-ink-muted" role="status">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  Saving…
                </span>
              )}
            </div>
            {updateReservationsMutation.error && (
              <p className="mt-2 text-[13px] font-medium text-danger" role="alert">
                {updateReservationsMutation.error instanceof Error
                  ? updateReservationsMutation.error.message
                  : 'Failed to update reservation settings'}
              </p>
            )}
          </section>

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
            <label className="block text-[14px] font-medium text-ink mb-2">PCN premises number</label>
            <div className="flex items-center gap-2.5">
              <input
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
              <div className="w-[72px] h-12 border border-border rounded-button flex items-center justify-center text-[15px] font-medium text-ink-muted bg-[var(--surface)] flex-shrink-0">
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
                }
              }}
              className="h-12 flex items-center px-6 bg-white text-ink-muted border border-border font-medium text-[15px] rounded-button hover:bg-surface transition-colors"
            >
              Discard changes
            </Button>
            <Button
              type="submit"
              disabled={isSaving}
              className="h-12 flex items-center px-6 bg-primary text-white font-medium text-[15px] rounded-button hover:bg-[var(--primary-hover)] transition-colors disabled:opacity-60"
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
                className="w-full h-12 border border-border rounded-button px-4 text-[15px] text-ink bg-[var(--surface)] cursor-not-allowed focus:outline-none"
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
    </div>
  );
}
