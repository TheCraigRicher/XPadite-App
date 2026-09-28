// Single source of truth for Help & Feedback contact info — reused by the
// modal (mailto link) and the submission API route (never hardcode this
// elsewhere).
export const SUPPORT_EMAIL = 'support@xpadite.com'

// Shown in support requests as diagnostic context. Bump alongside releases.
export const APP_VERSION = '0.1.0'

// 'help' is kept for backward compatibility with historical records only —
// the UI no longer offers a way to submit one (see HelpFeedbackModal.tsx).
export type SupportRequestType = 'help' | 'problem' | 'feedback'

export const PROBLEM_CATEGORIES = [
  'Bug',
  'UI Issue',
  'Sync Issue',
  'Account / Billing',
  'Performance Issue',
  'Other',
] as const

export const FEEDBACK_CATEGORIES = [
  'Feature Request',
  'Improvement',
  'UX Feedback',
  'General Feedback',
  'Compliment',
  'Other',
] as const

// The XPadite public reviews page (external website, built separately).
// Leave empty until that page exists — Rate Us stays disabled rather than
// linking to a guessed/dead URL.
export const XPADITE_REVIEW_URL = ''
