'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { Logo } from '@/components/brand/Logo';

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
      newErrors.terms = 'You must accept the terms and conditions';
    }

    if (selectedRole === 'patient' && !formData.location) {
      newErrors.location = 'Location is required';
    }

    if (selectedRole === 'pharmacy') {
      if (!formData.pharmacy_name.trim()) newErrors.pharmacy_name = 'Pharmacy name is required';
      if (!formData.license_number.trim()) newErrors.license_number = 'License number is required';
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

    if (!validateForm()) return;

    setIsLoading(true);

    try {
      const supabase = createClient();

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
                    license_number: formData.license_number,
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
        } = await supabase
          .from('pharmacies')
          .insert({
            user_id: authData.user.id,
            pharmacy_name: formData.pharmacy_name,
            license_number: formData.license_number,
            address: formData.address,
            city: formData.city,
            state: formData.state,
            phone: formData.phone,
          } as any)
          .select('id')
          .single();

        const insertedPharmacy = pharmacyRecord as { id: string } | null;

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
            <button
              onClick={() => selectRole('patient')}
              className="text-left cursor-pointer border-[1.5px] border-border rounded-card p-8 flex flex-col gap-2 hover:border-primary/50 transition-colors"
            >
              <div className="w-12 h-12 rounded-card bg-surface flex items-center justify-center text-[22px] mb-2">🧑</div>
              <h3 className="text-[19px] font-medium text-ink">I&apos;m a patient</h3>
              <p className="text-[14px] leading-[1.55] text-ink-muted">Search for medication and find nearby pharmacies with stock.</p>
              <span className="mt-4 text-[14px] font-medium text-primary">Continue as patient →</span>
            </button>
            <button
              onClick={() => selectRole('pharmacy')}
              className="text-left cursor-pointer border-[1.5px] border-border rounded-card p-8 flex flex-col gap-2 hover:border-primary/50 transition-colors"
            >
              <div className="w-12 h-12 rounded-card bg-surface flex items-center justify-center text-[22px] mb-2">🏥</div>
              <h3 className="text-[19px] font-medium text-ink">I&apos;m a pharmacy</h3>
              <p className="text-[14px] leading-[1.55] text-ink-muted">List and manage your inventory so patients can find you.</p>
              <span className="mt-4 text-[14px] font-medium text-primary">Continue as pharmacy →</span>
            </button>
          </div>
        </div>
      )}

      {/* STEP 2: form */}
      {currentStep === 2 && (
        <div className={`mx-auto px-6 pt-14 pb-24 ${selectedRole === 'pharmacy' ? 'max-w-[640px]' : 'max-w-[520px]'}`}>
          <button onClick={goBack} className="inline-flex items-center gap-1.5 text-[14px] font-medium text-ink-muted mb-6 hover:text-ink">← Back</button>
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
                  <label htmlFor="license_number" className={labelCls}>PCN license number</label>
                  <input id="license_number" placeholder="PCN/PREM/000000" value={formData.license_number}
                    onChange={(e) => setFormData({ ...formData, license_number: e.target.value })}
                    disabled={isLoading} className={`${inputCls} ${errCls('license_number')}`} />
                  <p className="text-[13px] text-ink-light mt-1.5">We verify every pharmacy against the Pharmacists Council of Nigeria register</p>
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
                disabled={isLoading} className="mt-0.5 w-4 h-4 flex-shrink-0" style={{ accentColor: '#0066CC' }} />
              <span>
                {selectedRole === 'pharmacy'
                  ? "I confirm I'm authorized to register this pharmacy and agree to the "
                  : "I agree to StocMed's "}
                <Link href="/terms" className="text-primary font-medium">Terms of Service</Link>
                {' '}and <Link href="/privacy" className="text-primary font-medium">Privacy Policy</Link>
              </span>
            </label>
            {errors.terms && <p className="text-xs text-danger -mt-2">{errors.terms}</p>}

            <button type="submit" disabled={isLoading}
              className="h-12 w-full bg-primary text-white text-[16px] font-medium rounded-button mt-2 hover:bg-[#0052A3] disabled:opacity-60">
              {isLoading ? 'Creating account…' : selectedRole === 'pharmacy' ? 'Register pharmacy' : 'Create account'}
            </button>

            {selectedRole === 'pharmacy' && (
              <p className="text-[13px] text-ink-light text-center">
                Your account will be active once your PCN license is verified, usually within 1 business day.
              </p>
            )}
          </form>
        </div>
      )}
    </div>
  );
}
