// Single source of truth for Help & Feedback contact info — reused by the
// modal (mailto link) and the submission API route (never hardcode this
// elsewhere).
export const SUPPORT_EMAIL = 'support@xpadite.com'

// Shown in support requests as diagnostic context. Bump alongside releases.
export const APP_VERSION = '0.1.0'

export type SupportRequestType = 'help' | 'problem' | 'feedback'

export const PROBLEM_CATEGORIES = [
  'Bug',
  'UI Issue',
  'Sync Issue',
  'Account Issue',
  'Performance Issue',
  'Other',
] as const

export const FEEDBACK_CATEGORIES = [
  'Feature Request',
  'Improvement',
  'UX Feedback',
  'General Feedback',
  'Other',
] as const
