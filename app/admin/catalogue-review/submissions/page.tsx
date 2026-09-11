import { redirect } from 'next/navigation'
import { getAuthorizedAdmin } from '@/lib/admin/authorization'
import CatalogueSubmissionsClient from './submissions-client'

export const dynamic = 'force-dynamic'

export default async function CatalogueSubmissionsPage() {
  const access = await getAuthorizedAdmin()
  if ('error' in access) {
    redirect(access.status === 401
      ? '/login?redirectTo=/admin/catalogue-review/submissions'
      : '/dashboard')
  }
  return <CatalogueSubmissionsClient />
}
