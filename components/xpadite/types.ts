export interface TaskSession {
  id: string
  startTs: number
  endTs: number | null
  note: string
  tags: string[]
}

export interface Task {
  id: string
  text: string
  done: boolean
  journal: string
  timerStart: number | null
  timerEnd: number | null
  actId: string
  milestone?: boolean
  sessions: TaskSession[]
  noteDone?: boolean
  linkedSessionId?: string  // set when auto-created by Clock In; matches the WorkSession id
  aiPlanId?: string          // set when created by AI Coach
  attachments?: TaskAttachment[]
  parentTaskId?: string      // set for sub-tasks; references a top-level task's id
  taskColor?: string         // user-chosen highlight color key (e.g. 'yellow', 'blue')
  isPriority?: boolean       // user-marked as urgent/important
}

export interface DayData {
  productive: boolean
  hyper: boolean
  notes: string
  tasks: Task[]
  journal: string
  milestone?: boolean
  goal?: boolean
  attachments?: TaskAttachment[]
}

export type CalendarData = Record<string, DayData>

export interface WorkSession {
  id: string
  actId: string
  actName: string
  actColor: string
  startTs: number
  endTs: number | null
  dateKey: string
}

export interface Activity {
  id: string
  name: string
  color: string
  emoji?: string
  countsTowardProductivity?: boolean  // undefined/true = productive; false = non-productive (Meal, Break)
}

export interface ActiveSession {
  id: string
  actId: string
  actName: string
  actColor: string
  startTs: number
  dateKey: string
}

export interface ActiveTaskTimer {
  taskId: string
  dateKey: string
  sessionId: string
  startTs: number
  taskText: string
  taskIndex: number
}

export type RepeatFrequency = 'once' | 'daily' | 'weekly' | 'monthly' | 'yearly'

// ── AI Coach types ─────────────────────────────────────────────────────────────

// ─── Journal block system ─────────────────────────────────────────────────────

export interface JournalBlock {
  id: string
  type: 'text' | 'section' | 'image' | 'drawing'
  content?: string      // Tiptap JSON for text/section blocks
  src?: string          // data URL for image/drawing blocks
  thumbnail?: string    // small preview for image/drawing blocks
  sectionColor?: string // 'blue' | 'green' | 'peach' | 'pink' | 'lavender'
  name?: string         // display label for image/drawing
  width?: number        // layout width percent (15–100), default 100
  height?: number       // explicit height in px; undefined = auto (natural image height)
  collapsed?: boolean   // section body hidden (presentational only); undefined/false = expanded
  createdAt: number
  updatedAt: number
}

export interface JournalTimerSession {
  startTs: number  // Unix ms
  endTs: number    // Unix ms
}

export interface JournalDoc {
  v: 1
  title?: string
  blocks: JournalBlock[]
  timerSessions?: JournalTimerSession[]
}

export interface TaskAttachment {
  id: string
  name: string
  mimeType: string
  size: number
  url: string           // base64 data URI — persists across page refreshes
  thumbnail: string | null  // base64 JPEG for image previews
  addedAt: number       // Unix ms
  source: 'upload' | 'camera' | 'drawing'
}

export interface AIMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
}

export interface DraftTask {
  clientId: string
  title: string
  date: string          // YYYY-MM-DD
  startTime: string | null   // HH:mm
  endTime: string | null     // HH:mm
  estimatedMinutes: number
  activityId: string | null  // existing activity id (null = new)
  activityName: string
  reminderRecommended: boolean
  reminderEnabled: boolean   // user toggle
  priority: 'low' | 'medium' | 'high'
  notes: string | null
  attachments?: TaskAttachment[]
  aiPlanId: string
  done: boolean
}

export interface AIDraftPlan {
  id: string
  createdAt: number
  goal: {
    title: string
    description: string
    targetDate: string | null
    timelineType: 'fixed' | 'flexible'
    seriousness: string
    successDefinition: string
  }
  activitySuggestion: {
    suggestedName: string
    existingActivityId: string | null
    suggestedColor: string | null
    emoji: string | null
  }
  phases: Array<{ id: string; title: string; startDate: string; endDate: string; description?: string }>
  milestones: Array<{ id: string; title: string; date: string; description?: string }>
  tasks: DraftTask[]
  dateRange: { start: string; end: string }
  warnings: string[]
  assumptions: string[]
}

export type AIPlanState =
  | 'idle'
  | 'conversation'
  | 'ready_to_generate'
  | 'generating'
  | 'draft_ready'
  | 'editing'
  | 'validating'
  | 'saving'
  | 'saved'
  | 'failed'

// ─────────────────────────────────────────────────────────────────────────────

export interface Reminder {
  id: string
  taskId: string
  dateKey: string
  taskText: string
  reminderTime: string               // "HH:MM" 24-hour local time
  repeatFrequency: RepeatFrequency
  soundEnabled: boolean
  browserNotificationEnabled: boolean
  emailEnabled: boolean
  emailAddress: string
  isActive: boolean                  // true = user wants this reminder; never set false by local firing
  nextRunAt: number                  // Unix ms
  lastSentAt: number | null
  localFiredAt: number | null        // local-only, never synced to Supabase; set when in-app/sound/browser alert fires
  timezone?: string                  // IANA timezone captured at save time, e.g. "America/Vancouver"
  notificationsEnabled: boolean      // false = user muted future delivery; reminder itself stays intact
}
