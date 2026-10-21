'use client'

import { useSyncExternalStore, type ReactNode } from 'react'
import { analyticsConfigured } from '@/lib/analytics/client'
import { getConsentSnapshot, getServerConsentSnapshot, saveConsent, subscribeConsent } from '@/lib/analytics/consent'

// Settings row where the user can turn optional usage analytics on or off at any time. The choice is saved in this
// browser at once and, when signed in, reconciled with the server copy by AnalyticsProvider (so the server stops too).
// Renders nothing when analytics is not configured. Styling comes from the Settings card it sits in.
export function AnalyticsPreferenceRow({
  icon, cardBg, cardBorder, titleColor, subtitleColor, isDark,
}: {
  icon: ReactNode
  cardBg: string
  cardBorder: string
  titleColor: string
  subtitleColor: string
  isDark: boolean
}) {
  const consent = useSyncExternalStore(subscribeConsent, getConsentSnapshot, getServerConsentSnapshot)
  if (!analyticsConfigured) return null
  const on = Boolean(consent?.analytics)
  return (
    <div style={{ background: cardBg, border: `1px solid ${cardBorder}`, borderRadius: 18, overflow: 'hidden', flexShrink: 0, marginTop: 2 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '16px 20px' }}>
        {icon}
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 14, fontWeight: 700, color: titleColor, lineHeight: 1.3 }}>Usage Analytics</p>
          <p style={{ fontSize: 11.5, color: subtitleColor, marginTop: 2 }}>
            Optional, anonymous statistics about which features are used. Never your tasks, notes or journal.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label="Usage analytics"
          onClick={() => saveConsent(!on)}
          style={{
            flexShrink: 0, width: 46, height: 26, borderRadius: 13, border: 0, padding: 3, cursor: 'pointer',
            background: on ? '#7c3aed' : isDark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.18)',
            display: 'flex', justifyContent: on ? 'flex-end' : 'flex-start', transition: 'background 150ms',
          }}
        >
          <span style={{ width: 20, height: 20, borderRadius: 10, background: '#fff', display: 'block' }} />
        </button>
      </div>
    </div>
  )
}
