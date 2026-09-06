import { redirect } from 'next/navigation'
import { getAuthorizedAdmin } from '@/lib/admin/authorization'
import CatalogueReviewClient from './catalogue-review-client'

export const dynamic = 'force-dynamic'

export default async function CatalogueReviewPage() {
  const access = await getAuthorizedAdmin()
  if ('error' in access) {
    redirect(access.status === 401
      ? '/login?redirectTo=/admin/catalogue-review'
      : '/dashboard')
  }

  return <CatalogueReviewClient />
}
