import { redirect } from 'next/navigation'
import { getAuthorizedAdmin } from '@/lib/admin/authorization'
import { BroadcastConsole } from '@/app/admin/broadcast/broadcast-console'

export const dynamic = 'force-dynamic'

export default async function AdminBroadcastPage() {
  const viewer = await getAuthorizedAdmin()
  if ('error' in viewer) redirect('/admin')
  return <BroadcastConsole />
}
