'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

// Load display name: localStorage profile first (highest priority), then
// Supabase auth metadata / profiles table as a fallback.
export function useDisplayFirstName(): string {
  const [firstName, setFirstName] = useState('')

  useEffect(() => {
    try {
      const raw = localStorage.getItem('xp9-profile')
      if (raw) {
        const p = JSON.parse(raw) as { firstName?: string; displayName?: string }
        const name = (p.firstName || p.displayName || '').trim()
        if (name) { setFirstName(name.split(/\s+/)[0]); return }
      }
    } catch {}

    const supabase = createClient()
    supabase.auth.getUser().then(async ({ data }) => {
      const meta = data.user?.user_metadata as Record<string, string> | undefined
      let full = (meta?.full_name ?? meta?.name ?? meta?.display_name ?? '').trim()
      if (!full && data.user?.id) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('full_name')
          .eq('id', data.user.id)
          .single()
        full = ((profile as { full_name?: string } | null)?.full_name ?? '').trim()
      }
      if (full) setFirstName(full.split(/\s+/)[0])
    }).catch(() => {})
  }, [])

  return firstName
}
