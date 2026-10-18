import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { pendingPlanFromMetadata, planQuery } from '@/lib/billing/intent'
import { XpaditeApp } from '@/components/xpadite/XpaditeApp'

export default async function AppPage({ searchParams }: { searchParams: Promise<{ plan?: string | string[] }> }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  // Signed up from a Website pricing card but arrived without ?plan (e.g. verified the email on another device,
  // then signed in normally): resume the purchase the account was created for. Expired/invalid values are ignored.
  const sp = await searchParams
  if (sp.plan === undefined) {
    const pending = pendingPlanFromMetadata(user.user_metadata)
    if (pending) redirect(`/app${planQuery(pending)}`)
  }

  return <XpaditeApp email={user.email ?? ''} />
}
