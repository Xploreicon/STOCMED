import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Select } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useToast } from '@/components/ui/toast'

// Nigerian states
const NIGERIAN_STATES = [
  'Abia', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa', 'Benue',
  'Borno', 'Cross River', 'Delta', 'Ebonyi', 'Edo', 'Ekiti', 'Enugu',
  'FCT', 'Gombe', 'Imo', 'Jigawa', 'Kaduna', 'Kano', 'Katsina', 'Kebbi',
  'Kogi', 'Kwara', 'Lagos', 'Nasarawa', 'Niger', 'Ogun', 'Ondo', 'Osun',
  'Oyo', 'Plateau', 'Rivers', 'Sokoto', 'Taraba', 'Yobe', 'Zamfara'
]

export default function Settings() {
  const { addToast } = useToast()

  // Pharmacy Profile state
  const [pharmacyProfile, setPharmacyProfile] = useState({
    name: 'MedCare Pharmacy',
    licenseNumber: 'PCN-12345-NG',
    address: '123 Main Street, Victoria Island',
    city: 'Lagos',
    state: 'Lagos',
    phone: '+234 801 234 5678',
    operatingHours: '8:00 AM - 8:00 PM'
  })

  // Account state
  const [accountInfo, setAccountInfo] = useState({
    fullName: 'Dr. John Doe',
    email: 'john.doe@medcare.com',
    phone: '+234 801 234 5678',
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  })

  const handlePharmacyProfileChange = (field: string, value: string) => {
    setPharmacyProfile(prev => ({ ...prev, [field]: value }))
  }

  const handleAccountInfoChange = (field: string, value: string) => {
    setAccountInfo(prev => ({ ...prev, [field]: value }))
  }

  const handleSavePharmacyProfile = (e: React.FormEvent) => {
    e.preventDefault()
    // Simulate API call
    setTimeout(() => {
      addToast('Pharmacy profile updated successfully!', 'success')
    }, 500)
  }

  const handleUpdateAccount = (e: React.FormEvent) => {
    e.preventDefault()

    // Validate password fields if user is trying to change password
    if (accountInfo.currentPassword || accountInfo.newPassword || accountInfo.confirmPassword) {
      if (!accountInfo.currentPassword) {
        addToast('Please enter your current password', 'error')
        return
      }
      if (!accountInfo.newPassword) {
        addToast('Please enter a new password', 'error')
        return
      }
      if (accountInfo.newPassword !== accountInfo.confirmPassword) {
        addToast('New passwords do not match', 'error')
        return
      }
      if (accountInfo.newPassword.length < 8) {
        addToast('Password must be at least 8 characters', 'error')
        return
      }
    }

    // Simulate API call
    setTimeout(() => {
      addToast('Account updated successfully!', 'success')
      // Clear password fields
      setAccountInfo(prev => ({
        ...prev,
        currentPassword: '',
        newPassword: '',
        confirmPassword: ''
      }))
    }, 500)
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Settings</h1>
          <p className="mt-2 text-gray-600">Manage your pharmacy and account settings</p>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="pharmacy">
          <TabsList className="mb-6">
            <TabsTrigger value="pharmacy">Pharmacy Profile</TabsTrigger>
            <TabsTrigger value="account">Account</TabsTrigger>
          </TabsList>

          {/* Pharmacy Profile Tab */}
          <TabsContent value="pharmacy">
            <Card>
              <CardHeader>
                <CardTitle>Pharmacy Profile</CardTitle>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSavePharmacyProfile} className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Pharmacy Name */}
                    <div className="space-y-2">
                      <Label htmlFor="pharmacy-name">Pharmacy Name</Label>
                      <Input
                        id="pharmacy-name"
                        value={pharmacyProfile.name}
                        onChange={(e) => handlePharmacyProfileChange('name', e.target.value)}
                        required
                      />
                    </div>

                    {/* License Number */}
                    <div className="space-y-2">
                      <Label htmlFor="license-number">License Number</Label>
                      <Input
                        id="license-number"
                        value={pharmacyProfile.licenseNumber}
                        onChange={(e) => handlePharmacyProfileChange('licenseNumber', e.target.value)}
                        required
                      />
                    </div>
                  </div>

                  {/* Address */}
                  <div className="space-y-2">
                    <Label htmlFor="address">Address</Label>
                    <Textarea
                      id="address"
                      value={pharmacyProfile.address}
                      onChange={(e) => handlePharmacyProfileChange('address', e.target.value)}
                      rows={3}
                      required
                    />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* City */}
                    <div className="space-y-2">
                      <Label htmlFor="city">City</Label>
                      <Input
                        id="city"
                        value={pharmacyProfile.city}
                        onChange={(e) => handlePharmacyProfileChange('city', e.target.value)}
                        required
                      />
                    </div>

                    {/* State */}
                    <div className="space-y-2">
                      <Label htmlFor="state">State</Label>
                      <Select
                        id="state"
                        value={pharmacyProfile.state}
                        onChange={(e) => handlePharmacyProfileChange('state', e.target.value)}
                        required
                      >
                        <option value="">Select State</option>
                        {NIGERIAN_STATES.map((state) => (
                          <option key={state} value={state}>
                            {state}
                          </option>
                        ))}
                      </Select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Phone */}
                    <div className="space-y-2">
                      <Label htmlFor="phone">Phone</Label>
                      <Input
                        id="phone"
                        type="tel"
                        value={pharmacyProfile.phone}
                        onChange={(e) => handlePharmacyProfileChange('phone', e.target.value)}
                        required
                      />
                    </div>

                    {/* Operating Hours */}
                    <div className="space-y-2">
                      <Label htmlFor="operating-hours">Operating Hours</Label>
                      <Input
                        id="operating-hours"
                        value={pharmacyProfile.operatingHours}
                        onChange={(e) => handlePharmacyProfileChange('operatingHours', e.target.value)}
                        placeholder="e.g., 8:00 AM - 8:00 PM"
                        required
                      />
                    </div>
                  </div>

                  <div className="flex justify-end">
                    <Button type="submit">Save Changes</Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Account Tab */}
          <TabsContent value="account">
            <Card>
              <CardHeader>
                <CardTitle>Account Settings</CardTitle>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleUpdateAccount} className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Full Name */}
                    <div className="space-y-2">
                      <Label htmlFor="full-name">Full Name</Label>
                      <Input
                        id="full-name"
                        value={accountInfo.fullName}
                        onChange={(e) => handleAccountInfoChange('fullName', e.target.value)}
                        required
                      />
                    </div>

                    {/* Email */}
                    <div className="space-y-2">
                      <Label htmlFor="email">Email</Label>
                      <Input
                        id="email"
                        type="email"
                        value={accountInfo.email}
                        disabled
                        className="bg-gray-100"
                      />
                    </div>
                  </div>

                  {/* Phone */}
                  <div className="space-y-2">
                    <Label htmlFor="account-phone">Phone</Label>
                    <Input
                      id="account-phone"
                      type="tel"
                      value={accountInfo.phone}
                      onChange={(e) => handleAccountInfoChange('phone', e.target.value)}
                      required
                    />
                  </div>

                  {/* Change Password Section */}
                  <div className="border-t pt-6 mt-6">
                    <h3 className="text-lg font-semibold text-gray-900 mb-4">Change Password</h3>
                    <div className="space-y-4">
                      {/* Current Password */}
                      <div className="space-y-2">
                        <Label htmlFor="current-password">Current Password</Label>
                        <Input
                          id="current-password"
                          type="password"
                          value={accountInfo.currentPassword}
                          onChange={(e) => handleAccountInfoChange('currentPassword', e.target.value)}
                          placeholder="Enter current password"
                        />
                      </div>

                      {/* New Password */}
                      <div className="space-y-2">
                        <Label htmlFor="new-password">New Password</Label>
                        <Input
                          id="new-password"
                          type="password"
                          value={accountInfo.newPassword}
                          onChange={(e) => handleAccountInfoChange('newPassword', e.target.value)}
                          placeholder="Enter new password"
                        />
                      </div>

                      {/* Confirm Password */}
                      <div className="space-y-2">
                        <Label htmlFor="confirm-password">Confirm Password</Label>
                        <Input
                          id="confirm-password"
                          type="password"
                          value={accountInfo.confirmPassword}
                          onChange={(e) => handleAccountInfoChange('confirmPassword', e.target.value)}
                          placeholder="Confirm new password"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="flex justify-end">
                    <Button type="submit">Update Account</Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
