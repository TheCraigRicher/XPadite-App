import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { XpaditeApp } from '@/components/xpadite/XpaditeApp'

export default async function AppPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  return <XpaditeApp email={user.email ?? ''} />
}
