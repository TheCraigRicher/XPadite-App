export interface Task {
  id: string
  text: string
  done: boolean
  journal: string
  timerStart: number | null
  timerEnd: number | null
  actId: string
  milestone?: boolean
}

export interface DayData {
  productive: boolean
  hyper: boolean
  notes: string
  tasks: Task[]
  journal: string
  milestone?: boolean
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
}

export interface ActiveSession {
  id: string
  actId: string
  actName: string
  actColor: string
  startTs: number
  dateKey: string
}
