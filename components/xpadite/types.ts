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
