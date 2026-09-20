// Keys that contain meaningful user-generated XPadite data.
// This list intentionally excludes ephemeral UI state (task clipboard, stats-collapsed, etc.).
const BACKUP_KEYS = [
  'xp9d',           // CalendarData — tasks, journal, productive flags, goals, milestones
  'xp9s',           // WorkSession[] — activity timer sessions
  'xp9a',           // Activity[] — activity definitions
  'xp9r',           // Reminder[] — reminders
  'xp9-profile',    // ProfileData — display name, avatar path
  'xp9-journal',    // string — legacy global quick-notes scratch pad
  'xp9g',           // GalleryItem[] — gallery screenshots and photos
  'xp9-aic',        // AI Coach conversation and draft plan state
  'xp9-notifications', // XpaditeNotification[] — in-app notification log
  'xp-progress-color',     // string — progress ring hex color
  'xp-theme',              // string — 'true'/'false' for dark/light theme
  'xp9-active-session',    // ActiveSession — in-progress clock-in (null when idle)
  'xp9-active-task-timer', // ActiveTaskTimer — in-progress task timer (null when idle)
] as const

export interface LocalDataSnapshot {
  exportedAt: string        // ISO timestamp
  origin: string            // the browser origin this was captured from
  version: 1
  keys: Record<string, unknown>
}

export function exportLocalData(): void {
  const snapshot: LocalDataSnapshot = {
    exportedAt: new Date().toISOString(),
    origin: typeof window !== 'undefined' ? window.location.origin : 'unknown',
    version: 1,
    keys: {},
  }

  for (const key of BACKUP_KEYS) {
    try {
      const raw = localStorage.getItem(key)
      if (raw !== null) {
        try {
          snapshot.keys[key] = JSON.parse(raw)
        } catch {
          snapshot.keys[key] = raw  // store as raw string if not valid JSON
        }
      }
    } catch {
      // localStorage may be unavailable in some contexts
    }
  }

  const json = JSON.stringify(snapshot, null, 2)
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  const date = new Date().toISOString().split('T')[0]
  a.href = url
  a.download = `xpadite-backup-${date}.json`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
