// ─────────────────────────────────────────────────────────────────────────────
// XPadite i18n foundation.
//
// Scope, deliberately: only locales with a genuinely complete dictionary
// below are listed in SUPPORTED_LOCALES / exposed in Settings. Quality over
// list size — do not add a locale here without filling in every key.
// ─────────────────────────────────────────────────────────────────────────────

export type Locale = 'en-US' | 'en-GB'

export const SUPPORTED_LOCALES: { value: Locale; label: string }[] = [
  { value: 'en-US', label: 'English (US)' },
  { value: 'en-GB', label: 'English (UK)' },
]

const DEFAULT_LOCALE: Locale = 'en-US'

const DICTIONARIES: Record<Locale, Record<string, string>> = {
  'en-US': {
    'settings.language': 'Language',
    'settings.timezone': 'Time Zone',
    'settings.themeColor': 'Theme Color',
    'settings.setToDefault': 'Set to default',
    'settings.automaticTimezone': 'Automatic — Device Time Zone',
    'settings.automaticLanguage': 'Automatic — Device Language',
  },
  'en-GB': {
    'settings.language': 'Language',
    'settings.timezone': 'Time Zone',
    'settings.themeColor': 'Theme Colour',
    'settings.setToDefault': 'Set to default',
    'settings.automaticTimezone': 'Automatic — Device Time Zone',
    'settings.automaticLanguage': 'Automatic — Device Language',
  },
}

export function isSupportedLocale(v: string | null | undefined): v is Locale {
  return v === 'en-US' || v === 'en-GB'
}

// Matches navigator.languages against the supported list. Returns null
// (never a hardcoded guess) when nothing matches, so callers decide their
// own fallback explicitly — see resolveLocale.
export function detectBrowserLocale(): Locale | null {
  try {
    const candidates = navigator.languages && navigator.languages.length > 0
      ? navigator.languages
      : [navigator.language]
    for (const raw of candidates) {
      if (isSupportedLocale(raw)) return raw
      // Same-language regional tag we don't have a dedicated dictionary for
      // (e.g. "en-CA", "en-AU") falls back to the base English dictionary —
      // never guess across languages we have no dictionary for at all.
      if (raw.split('-')[0] === 'en') return 'en-US'
    }
  } catch {
    // navigator unavailable (SSR) — caller's fallback applies
  }
  return null
}

// preference: the user's explicit choice, or null for "Automatic".
export function resolveLocale(preference: string | null): Locale {
  if (isSupportedLocale(preference)) return preference
  return detectBrowserLocale() ?? DEFAULT_LOCALE
}

export function t(locale: Locale, key: string, fallback?: string): string {
  return DICTIONARIES[locale]?.[key] ?? DICTIONARIES[DEFAULT_LOCALE][key] ?? fallback ?? key
}

// Locale-aware long date label — e.g. "September 25, 2026" (en-US) vs
// "25 September 2026" (en-GB). A concrete, visible proof that the language
// preference changes real formatting, not just static strings.
export function formatLongDate(locale: Locale, date: Date, timeZone?: string): string {
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    ...(timeZone ? { timeZone } : {}),
  }).format(date)
}
