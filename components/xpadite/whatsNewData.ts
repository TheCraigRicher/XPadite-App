// ─── What's New / Coming Soon content (shared announcements — NOT user data; no database, no API) ──────────────────────────────
// To publish a release: add the entry at the TOP of WHATS_NEW_ENTRIES (newest first) and bump WHATS_NEW_LAST_UPDATED.
// Entries are numbered automatically from their position, so nothing ever needs renumbering.
// To announce something upcoming: add it to COMING_SOON_ENTRIES; when it ships, move it into WHATS_NEW_ENTRIES.

export interface WhatsNewEntry { id: string; title: string; description: string }

export interface ComingSoonEntry extends WhatsNewEntry {
  /** 'table' = the spreadsheet / file-import glyph; anything else is shown as-is (e.g. an emoji). */
  icon: string
  /** Optional small status line in purple under the description (no dates, no promises). */
  note?: string
}

/** ISO date (YYYY-MM-DD) of the newest entry below. */
export const WHATS_NEW_LAST_UPDATED = '2026-11-27'

/** "2026-11-27" → "Nov 27, 2026" (fixed, locale- and timezone-independent). */
export function formatLastUpdated(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return iso
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${months[Number(m[2]) - 1] ?? m[2]} ${Number(m[3])}, ${m[1]}`
}

export const WHATS_NEW_ENTRIES: WhatsNewEntry[] = [
  { id: 'deadline-reminders', title: 'Task Manager — Deadline Reminders', description: 'A redesigned deadline reminder panel now lets you confirm whether you met your deadlines using Yes or No. You can also temporarily hide the panel whenever needed.' },
  { id: 'schedule-categories', title: 'My Schedule — Expanded Categories', description: 'Organize your schedule with separate Assignment and Test categories, along with new Urgent / Priority, Appointment and Work categories for students, professionals and everyday use.' },
  { id: 'schedule-copy-paste', title: 'My Schedule — Copy & Paste', description: 'Effortlessly copy and paste scheduled events into available time slots across days, weeks and months without having to recreate them manually.' },
  { id: 'planner-read-aloud', title: 'Planner / Journal — Read Aloud', description: 'Listen to individual sections or your entire daily Planner / Journal using the new Read Aloud feature. Review your notes, plans and study materials without having to read them on screen.' },
  { id: 'schedule-persistent-alarms', title: 'My Schedule — Persistent Alarms', description: 'Choose between standard reminders and persistent alarms that ring for up to five minutes while XPadite is open.' },
  { id: 'planner-indent-outdent', title: 'Planner / Journal — Indent & Outdent', description: 'Better organize your thoughts, notes and actionable plans with improved indentation controls for paragraphs, headings and lists.' },
  { id: 'planner-section-colors', title: 'Planner / Journal — Additional Section Colors', description: 'Personalize and visually organize your workspace with additional pastel section colors, including Teal and Rosewood.' },
  { id: 'planner-editable-timestamps', title: 'Planner / Journal — Editable Timestamps', description: 'View and manually edit section creation timestamps without having them automatically change whenever you edit your content.' },
  { id: 'deadline-sync', title: 'Task Manager & My Schedule — Deadline Sync', description: 'Synchronize task due dates with My Schedule and track whether your deadlines were completed early, on time or late.' },
]

export const COMING_SOON_ENTRIES: ComingSoonEntry[] = [
  {
    id: 'schedule-import', title: 'My Schedule — Schedule Import & Sync', icon: 'table',
    description: 'Import your existing schedules from CSV files, Excel spreadsheets and other compatible file formats directly into My Schedule, seamlessly integrating them with your XPadite schedule without having to enter every event manually.',
    note: 'Currently planned for an upcoming release',
  },
  { id: 'xpadite-v2', title: 'XPadite V2', icon: '🚀', description: 'More powerful XPadite features and improvements are coming in V2.' },
  { id: 'mobile-apps', title: 'iOS & Android Apps', icon: '📱', description: 'Native XPadite apps for iOS and Android are coming in the future.' },
]
