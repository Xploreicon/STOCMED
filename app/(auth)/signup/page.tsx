'use client';

import { Button } from '@/components/ui/button'
import { Building2, UserRound } from 'lucide-react'

import { useState, useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { Logo } from '@/components/brand/Logo';
import {
  isPcnNumberFormatValid,
  normalizePcnNumber,
  PCN_NUMBER_FORMAT_HELP,
} from '@/lib/validation/pcn';

export const dynamic = 'force-dynamic'

type Step = 1 | 2;
type Role = 'patient' | 'pharmacy';

const NIGERIAN_STATES = [
  'Abia', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa', 'Benue', 'Borno',
  'Cross River', 'Delta', 'Ebonyi', 'Edo', 'Ekiti', 'Enugu', 'FCT', 'Gombe', 'Imo',
  'Jigawa', 'Kaduna', 'Kano', 'Katsina', 'Kebbi', 'Kogi', 'Kwara', 'Lagos', 'Nasarawa',
  'Niger', 'Ogun', 'Ondo', 'Osun', 'Oyo', 'Plateau', 'Rivers', 'Sokoto', 'Taraba',
  'Yobe', 'Zamfara'
];

const LOCATIONS = ['Lagos', 'Abuja', 'Port Harcourt', 'Ibadan', 'Other'];

export default function Signup() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [currentStep, setCurrentStep] = useState<Step>(1);
  const [selectedRole, setSelectedRole] = useState<Role | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const submitInFlight = useRef(false);

  const [formData, setFormData] = useState({
    email: '',
    password: '',
    confirmPassword: '',
    full_name: '',
    phone: '',
    location: '',
    pharmacy_name: '',
    license_number: '',
    address: '',
    city: '',
    state: '',
  });

  useEffect(() => {
    const roleParam = searchParams.get('role');
    if (roleParam === 'patient' || roleParam === 'pharmacy') {
      setSelectedRole(roleParam as Role);
      setCurrentStep(2);
    }
  }, [searchParams]);

  const validateForm = () => {
    const newErrors: Record<string, string> = {};

    if (!formData.full_name.trim()) newErrors.full_name = 'Full name is required';
    if (!formData.email) {
      newErrors.email = 'Email is required';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      newErrors.email = 'Please enter a valid email address';
    }
    if (!formData.phone) {
      newErrors.phone = 'Phone number is required';
    } else if (!/^\+234\d{10}$/.test(formData.phone)) {
      newErrors.phone = 'Phone must be in format +234XXXXXXXXXX';
    }
    if (!formData.password) {
      newErrors.password = 'Password is required';
    } else if (formData.password.length < 8) {
      newErrors.password = 'Password must be at least 8 characters';
    }
    if (formData.password !== formData.confirmPassword) {
      newErrors.confirmPassword = 'Passwords do not match';
    }
    if (!acceptedTerms) {
      newErrors.terms = 'You must confirm before continuing';
    }

    if (selectedRole === 'patient' && !formData.location) {
      newErrors.location = 'Location is required';
    }

    if (selectedRole === 'pharmacy') {
      if (!formData.pharmacy_name.trim()) newErrors.pharmacy_name = 'Pharmacy name is required';
      if (!formData.license_number.trim()) {
        newErrors.license_number = 'PCN premises number is required';
      } else if (!isPcnNumberFormatValid(formData.license_number)) {
        newErrors.license_number = 'Enter the PCN premises number exactly as shown on the record';
      }
      if (!formData.address.trim()) newErrors.address = 'Address is required';
      if (!formData.city.trim()) newErrors.city = 'City is required';
      if (!formData.state) newErrors.state = 'State is required';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const selectRole = (role: Role) => {
    setSelectedRole(role);
    setCurrentStep(2);
    setErrors({});
  };

  const goBack = () => {
    setCurrentStep(1);
    setSelectedRole(null);
    setErrors({});
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (submitInFlight.current || !validateForm()) return;

    submitInFlight.current = true;
    setIsLoading(true);

    try {
      const supabase = createClient();
      const normalizedPcnNumber = normalizePcnNumber(formData.license_number);

      const { data: authData, error: authError } = await supabase.auth.signUp({
        email: formData.email,
        password: formData.password,
        options: {
          data: {
            role: selectedRole,
            full_name: formData.full_name,
            phone: formData.phone,
            pharmacy_profile:
              selectedRole === 'pharmacy'
                ? {
                    pharmacy_name: formData.pharmacy_name,
                    license_number: normalizedPcnNumber,
                    address: formData.address,
                    city: formData.city,
                    state: formData.state,
                    phone: formData.phone,
                  }
                : null,
          },
        },
      });

      if (authError) {
        setErrors({ general: authError.message });
        return;
      }

      if (!authData.user) {
        setErrors({ general: 'Failed to create account' });
        return;
      }

      const { error: userError } = await supabase.from('users').insert({
        user_id: authData.user.id,
        email: formData.email,
        full_name: formData.full_name,
        phone: formData.phone,
        role: selectedRole!,
        location: selectedRole === 'patient' ? formData.location : formData.city,
      } as any);

      if (userError) console.error('Error inserting user:', userError);

      const hasSession = !!authData.session;

      if (selectedRole === 'pharmacy' && hasSession) {
        const {
          data: pharmacyRecord,
          error: pharmacyError,
        } = await (supabase.rpc as any)('register_provisional_pharmacy', {
          p_pharmacy_name: formData.pharmacy_name.trim(),
          p_license_number: normalizedPcnNumber,
          p_address: formData.address.trim(),
          p_city: formData.city.trim(),
          p_state: formData.state,
          p_phone: formData.phone,
        });

        const insertedPharmacy = (Array.isArray(pharmacyRecord)
          ? pharmacyRecord[0]
          : pharmacyRecord) as { id: string } | null;

        if (pharmacyError || !insertedPharmacy) {
          console.error('Error inserting pharmacy:', pharmacyError);
          setErrors({
            general:
              'We could not finish setting up your pharmacy. Please verify your email and try again.',
          });
          return;
        }

        const { error: metadataError } = await supabase.auth.updateUser({
          data: {
            pharmacy_id: insertedPharmacy.id,
            pharmacy_profile: null,
          },
        });

        if (metadataError) {
          console.error('Failed to store pharmacy_id in auth metadata', metadataError);
        }
      }

      if (!hasSession) {
        router.push('/login?verifyEmail=1');
        return;
      }

      router.push(selectedRole === 'pharmacy' ? '/pharmacy/dashboard' : '/dashboard');
      router.refresh();
    } catch (error) {
      setErrors({
        general: error instanceof Error ? error.message : 'Registration failed. Please try again.',
      });
    } finally {
      submitInFlight.current = false;
      setIsLoading(false);
    }
  };

  const inputCls =
    'w-full h-12 border border-border rounded-button px-4 text-[15px] text-ink bg-white outline-none focus:border-primary focus:ring-2 focus:ring-primary/15 disabled:opacity-60';
  const labelCls = 'block text-[14px] font-medium text-ink mb-2';
  const errCls = (f: string) => (errors[f] ? 'border-danger focus:border-danger focus:ring-danger/15' : '');

  return (
    <div className="w-full min-h-screen bg-white text-ink">
      {/* Top bar */}
      <div className="border-b border-border px-6 py-4">
        <div className="mx-auto max-w-[1200px] flex items-center justify-between">
          <Logo size={32} wordSize={18} href="/" />
          <span className="text-[14px] text-ink-muted">
            Already have an account? <Link href="/login" className="text-primary font-medium">Log in</Link>
          </span>
        </div>
      </div>

      {/* STEP 1: role select */}
      {currentStep === 1 && (
        <div className="mx-auto max-w-[760px] px-6 pt-16 pb-24">
          <div className="text-center mb-12">
            <h1 className="font-display font-medium text-[36px] leading-[1.2] text-ink">Create your account</h1>
            <p className="text-[16px] text-ink-muted mt-3">Choose how you&apos;ll use StocMed</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <Button
              onClick={() => selectRole('patient')}
              variant="outline"
              className="h-auto items-start justify-start whitespace-normal text-left cursor-pointer border-[1.5px] border-border rounded-card p-8 flex flex-col gap-2 hover:border-primary/50 transition-colors"
            >
              <div className="w-12 h-12 rounded-full bg-primary/10 text-primary flex items-center justify-center mb-2">
                <UserRound className="h-6 w-6" strokeWidth={2} aria-hidden="true" />
              </div>
              <h3 className="text-[19px] font-medium text-ink">I&apos;m a patient</h3>
              <p className="text-[14px] leading-[1.55] text-ink-muted">Search for medication and find nearby pharmacies with stock.</p>
              <span className="mt-4 text-[14px] font-medium text-primary">Continue as patient →</span>
            </Button>
            <Button
              onClick={() => selectRole('pharmacy')}
              variant="outline"
              className="h-auto items-start justify-start whitespace-normal text-left cursor-pointer border-[1.5px] border-border rounded-card p-8 flex flex-col gap-2 hover:border-primary/50 transition-colors"
            >
              <div className="w-12 h-12 rounded-full bg-primary/10 text-primary flex items-center justify-center mb-2">
                <Building2 className="h-6 w-6" strokeWidth={2} aria-hidden="true" />
              </div>
              <h3 className="text-[19px] font-medium text-ink">I&apos;m a pharmacy</h3>
              <p className="text-[14px] leading-[1.55] text-ink-muted">List and manage your inventory so patients can find you.</p>
              <span className="mt-4 text-[14px] font-medium text-primary">Continue as pharmacy →</span>
            </Button>
          </div>
        </div>
      )}

      {/* STEP 2: form */}
      {currentStep === 2 && (
        <div className={`mx-auto px-6 pt-14 pb-24 ${selectedRole === 'pharmacy' ? 'max-w-[640px]' : 'max-w-[520px]'}`}>
          <Button onClick={goBack} className="inline-flex items-center gap-1.5 text-[14px] font-medium text-ink-muted mb-6 hover:text-ink">← Back</Button>
          <h1 className="font-display font-medium text-[30px] text-ink">
            {selectedRole === 'pharmacy' ? 'Register your pharmacy' : 'Create your patient account'}
          </h1>
          <p className="text-[15px] text-ink-muted mt-2 mb-8">
            {selectedRole === 'pharmacy'
              ? 'List your inventory and get discovered by patients searching nearby.'
              : 'Find medication and reserve it at nearby pharmacies.'}
          </p>

          <form onSubmit={handleSubmit} className="flex flex-col gap-5">
            {errors.general && (
              <div className="rounded-button border border-danger/20 bg-danger/5 px-4 py-3 text-sm text-danger font-medium">
                {errors.general}
              </div>
            )}

            <div>
              <label htmlFor="full_name" className={labelCls}>Full name</label>
              <input id="full_name" placeholder="Ada Nwosu" value={formData.full_name}
                onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                disabled={isLoading} className={`${inputCls} ${errCls('full_name')}`} />
              {errors.full_name && <p className="text-xs text-danger mt-1.5">{errors.full_name}</p>}
            </div>

            {selectedRole === 'pharmacy' && (
              <>
                <div>
                  <label htmlFor="pharmacy_name" className={labelCls}>Pharmacy name</label>
                  <input id="pharmacy_name" placeholder="MedPlus Pharmacy" value={formData.pharmacy_name}
                    onChange={(e) => setFormData({ ...formData, pharmacy_name: e.target.value })}
                    disabled={isLoading} className={`${inputCls} ${errCls('pharmacy_name')}`} />
                  {errors.pharmacy_name && <p className="text-xs text-danger mt-1.5">{errors.pharmacy_name}</p>}
                </div>
                <div>
                  <label htmlFor="license_number" className={labelCls}>PCN premises number</label>
                  <input id="license_number" placeholder="0023841" value={formData.license_number}
                    maxLength={32}
                    autoCapitalize="characters"
                    onChange={(e) => setFormData({ ...formData, license_number: e.target.value.toUpperCase() })}
                    onBlur={() => setFormData((current) => ({
                      ...current,
                      license_number: normalizePcnNumber(current.license_number),
                    }))}
                    disabled={isLoading} className={`${inputCls} ${errCls('license_number')}`} />
                  <p className="text-[13px] text-ink-light mt-1.5">
                    {PCN_NUMBER_FORMAT_HELP} Passing this check does not mean the pharmacy is PCN-verified.
                  </p>
                  {errors.license_number && <p className="text-xs text-danger mt-1.5">{errors.license_number}</p>}
                </div>
                <div>
                  <label htmlFor="address" className={labelCls}>Street address</label>
                  <input id="address" placeholder="14 Allen Avenue" value={formData.address}
                    onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                    disabled={isLoading} className={`${inputCls} ${errCls('address')}`} />
                  {errors.address && <p className="text-xs text-danger mt-1.5">{errors.address}</p>}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="city" className={labelCls}>City</label>
                    <input id="city" placeholder="Ikeja" value={formData.city}
                      onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                      disabled={isLoading} className={`${inputCls} ${errCls('city')}`} />
                    {errors.city && <p className="text-xs text-danger mt-1.5">{errors.city}</p>}
                  </div>
                  <div>
                    <label htmlFor="state" className={labelCls}>State</label>
                    <select id="state" value={formData.state}
                      onChange={(e) => setFormData({ ...formData, state: e.target.value })}
                      disabled={isLoading} className={`${inputCls} ${errCls('state')}`}>
                      <option value="">Select state</option>
                      {NIGERIAN_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                    {errors.state && <p className="text-xs text-danger mt-1.5">{errors.state}</p>}
                  </div>
                </div>
              </>
            )}

            <div>
              <label htmlFor="email" className={labelCls}>{selectedRole === 'pharmacy' ? 'Work email' : 'Email address'}</label>
              <input id="email" type="email" placeholder="you@email.com" value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                disabled={isLoading} className={`${inputCls} ${errCls('email')}`} />
              {errors.email && <p className="text-xs text-danger mt-1.5">{errors.email}</p>}
            </div>

            <div>
              <label htmlFor="phone" className={labelCls}>Phone number</label>
              <input id="phone" placeholder="+234XXXXXXXXXX" value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                disabled={isLoading} className={`${inputCls} ${errCls('phone')}`} />
              {errors.phone && <p className="text-xs text-danger mt-1.5">{errors.phone}</p>}
            </div>

            {selectedRole === 'patient' && (
              <div>
                <label htmlFor="location" className={labelCls}>Location</label>
                <select id="location" value={formData.location}
                  onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                  disabled={isLoading} className={`${inputCls} ${errCls('location')}`}>
                  <option value="">Select location</option>
                  {LOCATIONS.map((loc) => <option key={loc} value={loc}>{loc}</option>)}
                </select>
                <p className="text-[13px] text-ink-light mt-1.5">Used to show pharmacies nearest to you</p>
                {errors.location && <p className="text-xs text-danger mt-1.5">{errors.location}</p>}
              </div>
            )}

            <div>
              <label htmlFor="password" className={labelCls}>Password</label>
              <input id="password" type="password" placeholder="At least 8 characters" value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                disabled={isLoading} className={`${inputCls} ${errCls('password')}`} />
              {errors.password && <p className="text-xs text-danger mt-1.5">{errors.password}</p>}
            </div>

            <div>
              <label htmlFor="confirmPassword" className={labelCls}>Confirm password</label>
              <input id="confirmPassword" type="password" placeholder="Re-enter your password" value={formData.confirmPassword}
                onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                disabled={isLoading} className={`${inputCls} ${errCls('confirmPassword')}`} />
              {errors.confirmPassword && <p className="text-xs text-danger mt-1.5">{errors.confirmPassword}</p>}
            </div>

            <label className="flex items-start gap-2.5 text-[14px] text-ink-muted cursor-pointer">
              <input type="checkbox" checked={acceptedTerms}
                onChange={(e) => setAcceptedTerms(e.target.checked)}
                disabled={isLoading} className="mt-0.5 w-4 h-4 flex-shrink-0" style={{ accentColor: 'var(--primary)' }} />
              <span>
                {selectedRole === 'pharmacy' ? (
                  <>
                    I confirm I&apos;m authorized to register this pharmacy and agree to StocMed&apos;s{' '}
                    <Link href="/terms" target="_blank" className="text-primary underline hover:text-primary-hover font-medium">Terms of Service</Link>{' '}
                    and{' '}
                    <Link href="/privacy" target="_blank" className="text-primary underline hover:text-primary-hover font-medium">Privacy Policy</Link>.
                  </>
                ) : (
                  <>
                    I agree to StocMed&apos;s{' '}
                    <Link href="/terms" target="_blank" className="text-primary underline hover:text-primary-hover font-medium">Terms of Service</Link>{' '}
                    and consent to data processing under the{' '}
                    <Link href="/privacy" target="_blank" className="text-primary underline hover:text-primary-hover font-medium">Privacy Policy</Link>.
                  </>
                )}
              </span>
            </label>
            {errors.terms && <p className="text-xs text-danger -mt-2">{errors.terms}</p>}

            <Button type="submit" disabled={isLoading}
              className="h-12 w-full bg-primary text-white text-[16px] font-medium rounded-button mt-2 hover:bg-[var(--primary-hover)] disabled:opacity-60">
              {isLoading ? 'Creating account…' : selectedRole === 'pharmacy' ? 'Register pharmacy' : 'Create account'}
            </Button>

            {selectedRole === 'pharmacy' && (
              <p className="text-[13px] text-ink-light text-center">
                After email confirmation, your pharmacy receives provisional search visibility for 30 days.
                Upload the premises certificate and superintendent pharmacist licence in Settings before the deadline.
              </p>
            )}
          </form>
        </div>
      )}
    </div>
  );
}
