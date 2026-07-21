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
}

export interface DayData {
  productive: boolean
  hyper: boolean
  notes: string
  tasks: Task[]
  journal: string
  milestone?: boolean
  goal?: boolean
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
}
