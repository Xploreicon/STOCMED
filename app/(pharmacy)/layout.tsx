import { MainLayout } from '@/components/layout/MainLayout';
import { PharmacyFeaturesProvider } from '@/components/providers/PharmacyFeaturesProvider';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic'

export default async function PharmacyLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: pharmacy } = user
    ? await (supabase as any)
        .from('pharmacies')
        .select('pharmacy_name, logo_url')
        .eq('user_id', user.id)
        .maybeSingle()
    : { data: null };
  const initialPharmacyProfile = pharmacy ? {
    pharmacy_name: pharmacy.pharmacy_name,
    logo_url: pharmacy.logo_url,
  } : null;

  return (
    <PharmacyFeaturesProvider>
      <MainLayout role="pharmacy" initialPharmacyProfile={initialPharmacyProfile}>
        {children}
      </MainLayout>
    </PharmacyFeaturesProvider>
  );
}
