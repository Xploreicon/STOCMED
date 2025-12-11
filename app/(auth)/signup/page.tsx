'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { createClient } from '@/lib/supabase/client';

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

  const validateStep1 = () => {
    if (!selectedRole) {
      setErrors({ role: 'Please select a role' });
      return false;
    }
    return true;
  };

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

  const handleStep1Continue = () => {
    if (validateStep1()) {
      setCurrentStep(2);
    }
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
        id: authData.user.id,
        email: formData.email,
        full_name: formData.full_name,
        phone: formData.phone,
        role: selectedRole!,
        location: selectedRole === 'patient' ? formData.location : formData.city,
      } as any);

      if (userError) console.error('Error inserting user:', userError);

      if (selectedRole === 'pharmacy') {
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

      const hasSession = !!authData.session;

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

  return (
    <div className="min-h-screen bg-light-blue-bg flex items-center justify-center p-4">
      <Card className="w-full max-w-[500px]">
        <CardHeader className="space-y-1">
          <CardTitle className="text-xl sm:text-2xl font-bold text-center">Create Account</CardTitle>
          <CardDescription className="text-center">
            {currentStep === 1 ? 'Choose your account type' : 'Fill in your details'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {currentStep === 1 ? (
            <div className="space-y-4">
              {errors.role && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-md text-sm">
                  {errors.role}
                </div>
              )}

              <div className="space-y-3">
                <Label>Select Account Type</Label>

                <div
                  onClick={() => setSelectedRole('patient')}
                  className={`border-2 rounded-lg p-4 cursor-pointer transition-all ${
                    selectedRole === 'patient' ? 'border-primary-blue bg-blue-50' : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className="flex items-start space-x-3">
                    <input type="radio" checked={selectedRole === 'patient'} onChange={() => {}} className="mt-1" />
                    <div>
                      <h3 className="font-semibold text-dark-gray">Patient</h3>
                      <p className="text-sm text-medium-gray">Register as a patient to find and purchase medications</p>
                    </div>
                  </div>
                </div>

                <div
                  onClick={() => setSelectedRole('pharmacy')}
                  className={`border-2 rounded-lg p-4 cursor-pointer transition-all ${
                    selectedRole === 'pharmacy' ? 'border-primary-blue bg-blue-50' : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className="flex items-start space-x-3">
                    <input type="radio" checked={selectedRole === 'pharmacy'} onChange={() => {}} className="mt-1" />
                    <div>
                      <h3 className="font-semibold text-dark-gray">Pharmacy</h3>
                      <p className="text-sm text-medium-gray">Register your pharmacy to manage inventory and sales</p>
                    </div>
                  </div>
                </div>
              </div>

              <Button onClick={handleStep1Continue} className="w-full">Continue</Button>

              <div className="text-center text-sm">
                <span className="text-gray-600">Already have an account? </span>
                <Link href="/login" className="text-primary-blue hover:underline font-medium">Sign In</Link>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {errors.general && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-md text-sm">
                  {errors.general}
                </div>
              )}

              {selectedRole === 'pharmacy' && (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="pharmacy_name">Pharmacy Name</Label>
                    <Input
                      id="pharmacy_name"
                      placeholder="Enter pharmacy name"
                      value={formData.pharmacy_name}
                      onChange={(e) => setFormData({ ...formData, pharmacy_name: e.target.value })}
                      disabled={isLoading}
                      className={errors.pharmacy_name ? 'border-red-500' : ''}
                    />
                    {errors.pharmacy_name && <p className="text-red-500 text-xs">{errors.pharmacy_name}</p>}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="license_number">License Number</Label>
                    <Input
                      id="license_number"
                      placeholder="Enter license number"
                      value={formData.license_number}
                      onChange={(e) => setFormData({ ...formData, license_number: e.target.value })}
                      disabled={isLoading}
                      className={errors.license_number ? 'border-red-500' : ''}
                    />
                    {errors.license_number && <p className="text-red-500 text-xs">{errors.license_number}</p>}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="address">Address</Label>
                    <Input
                      id="address"
                      placeholder="Enter pharmacy address"
                      value={formData.address}
                      onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                      disabled={isLoading}
                      className={errors.address ? 'border-red-500' : ''}
                    />
                    {errors.address && <p className="text-red-500 text-xs">{errors.address}</p>}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="city">City</Label>
                      <Input
                        id="city"
                        placeholder="Enter city"
                        value={formData.city}
                        onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                        disabled={isLoading}
                        className={errors.city ? 'border-red-500' : ''}
                      />
                      {errors.city && <p className="text-red-500 text-xs">{errors.city}</p>}
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="state">State</Label>
                      <select
                        id="state"
                        value={formData.state}
                        onChange={(e) => setFormData({ ...formData, state: e.target.value })}
                        disabled={isLoading}
                        className={`flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ${errors.state ? 'border-red-500' : ''}`}
                      >
                        <option value="">Select state</option>
                        {NIGERIAN_STATES.map((state) => (
                          <option key={state} value={state}>{state}</option>
                        ))}
                      </select>
                      {errors.state && <p className="text-red-500 text-xs">{errors.state}</p>}
                    </div>
                  </div>
                </>
              )}

              <div className="space-y-2">
                <Label htmlFor="full_name">Full Name</Label>
                <Input
                  id="full_name"
                  placeholder="Enter your full name"
                  value={formData.full_name}
                  onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                  disabled={isLoading}
                  className={errors.full_name ? 'border-red-500' : ''}
                />
                {errors.full_name && <p className="text-red-500 text-xs">{errors.full_name}</p>}
              </div>

              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="Enter your email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  disabled={isLoading}
                  className={errors.email ? 'border-red-500' : ''}
                />
                {errors.email && <p className="text-red-500 text-xs">{errors.email}</p>}
              </div>

              <div className="space-y-2">
                <Label htmlFor="phone">Phone Number</Label>
                <Input
                  id="phone"
                  placeholder="+234XXXXXXXXXX"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  disabled={isLoading}
                  className={errors.phone ? 'border-red-500' : ''}
                />
                {errors.phone && <p className="text-red-500 text-xs">{errors.phone}</p>}
              </div>

              {selectedRole === 'patient' && (
                <div className="space-y-2">
                  <Label htmlFor="location">Location</Label>
                  <select
                    id="location"
                    value={formData.location}
                    onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                    disabled={isLoading}
                    className={`flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ${errors.location ? 'border-red-500' : ''}`}
                  >
                    <option value="">Select location</option>
                    {LOCATIONS.map((loc) => (
                      <option key={loc} value={loc}>{loc}</option>
                    ))}
                  </select>
                  {errors.location && <p className="text-red-500 text-xs">{errors.location}</p>}
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="Create a password (min. 8 characters)"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  disabled={isLoading}
                  className={errors.password ? 'border-red-500' : ''}
                />
                {errors.password && <p className="text-red-500 text-xs">{errors.password}</p>}
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirmPassword">Confirm Password</Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  placeholder="Confirm your password"
                  value={formData.confirmPassword}
                  onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                  disabled={isLoading}
                  className={errors.confirmPassword ? 'border-red-500' : ''}
                />
                {errors.confirmPassword && <p className="text-red-500 text-xs">{errors.confirmPassword}</p>}
              </div>

              <div className="space-y-2">
                <div className="flex items-start space-x-2">
                  <Checkbox
                    id="terms"
                    checked={acceptedTerms}
                    onCheckedChange={(checked) => setAcceptedTerms(checked as boolean)}
                    disabled={isLoading}
                  />
                  <Label htmlFor="terms" className="text-sm font-normal leading-tight cursor-pointer">
                    I agree to the <Link href="/terms" className="text-primary-blue hover:underline">Terms and Conditions</Link> and{' '}
                    <Link href="/privacy" className="text-primary-blue hover:underline">Privacy Policy</Link>
                  </Label>
                </div>
                {errors.terms && <p className="text-red-500 text-xs">{errors.terms}</p>}
              </div>

              <div className="flex space-x-2">
                <Button type="button" variant="outline" onClick={() => setCurrentStep(1)} disabled={isLoading} className="w-1/3">
                  Back
                </Button>
                <Button type="submit" disabled={isLoading} className="w-2/3">
                  {isLoading ? 'Creating account...' : 'Create Account'}
                </Button>
              </div>

              <div className="text-center text-sm">
                <span className="text-gray-600">Already have an account? </span>
                <Link href="/login" className="text-primary-blue hover:underline font-medium">Sign In</Link>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
