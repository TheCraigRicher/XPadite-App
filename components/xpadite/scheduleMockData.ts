// ── My Schedule — SAMPLE events (frontend V1 only) ──────────────────────────
// These are demonstration events for the weekly scheduler. They are NOT meeting records: they never touch
// MOCK_MEETINGS / Supabase / the Task Manager, and anything a user adds, edits or deletes against them lives in
// component state only (lost when the modal closes). A later phase replaces this seam with a real events store.

import type { ScheduleEvent } from './scheduleLogic'
import { addDays, startOfWeek } from './scheduleLogic'

function at(base: Date, dayOffset: number, hour: number, minute = 0): number {
  const d = addDays(base, dayOffset)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), hour, minute).getTime()
}

/** Sample events laid out around the week containing `today` (Sun = offset 0), plus a few the following week. */
export function buildSampleScheduleEvents(today: Date): ScheduleEvent[] {
  const w = startOfWeek(today)
  let n = 0
  const ev = (e: Omit<ScheduleEvent, 'id'>): ScheduleEvent => ({ id: `sample-sched-${++n}`, recurrence: 'none', ...e })
  return [
    ev({ title: 'Lecture – React Native', category: 'lecture', startAt: at(w, 0, 7), endAt: at(w, 0, 8, 30), location: 'Room 204, Tech Building', notes: 'Bring laptop. Chapter 6 reading.', reminderMins: 15, recurrence: 'weekly' }),
    ev({ title: 'Study Session', category: 'study', startAt: at(w, 1, 8, 30), endAt: at(w, 1, 10), location: 'Library, 2nd floor', reminderMins: 10 }),
    ev({ title: 'Team Meeting', category: 'meeting', startAt: at(w, 1, 14), endAt: at(w, 1, 15), meetingUrl: 'https://meet.google.com/abc-defg-hij', notes: 'Sprint review and planning.', reminderMins: 15, recurrence: 'weekly' }),
    ev({ title: 'Meeting – Prof. Chelsy', category: 'meeting', startAt: at(w, 2, 11), endAt: at(w, 2, 11, 45), location: 'Office 310' }),
    ev({ title: 'Lecture – JavaScript', category: 'lecture', startAt: at(w, 3, 8), endAt: at(w, 3, 9, 30), location: 'Room 118', recurrence: 'weekly' }),
    ev({ title: 'Project Work', category: 'assignment', startAt: at(w, 3, 17), endAt: at(w, 3, 18, 30), notes: 'Finish the assignment write-up.', reminderMins: 60 }),
    ev({ title: 'Presentation', category: 'meeting', startAt: at(w, 5, 8), endAt: at(w, 5, 9), meetingUrl: 'https://zoom.us/j/1234567890', notes: 'Email slides to the professor beforehand.', reminderMins: 30 }),
    ev({ title: 'Python Test', category: 'assignment', startAt: at(w, 5, 9, 30), endAt: at(w, 5, 11, 30), location: 'Exam Hall B', reminderMins: 1440 }),
    ev({ title: 'Lunch', category: 'personal', startAt: at(w, 5, 12), endAt: at(w, 5, 13), location: 'Campus Café' }),
    ev({ title: 'Lecture – Databases', category: 'lecture', startAt: at(w, 5, 9), endAt: at(w, 5, 10), location: 'Room 118' }),
    ev({ title: 'Weekend Hangout', category: 'personal', startAt: at(w, 6, 17), endAt: at(w, 6, 19), location: 'Downtown', notes: 'Dinner with friends.' }),
    ev({ title: 'Gym', category: 'other', startAt: at(w, 2, 6), endAt: at(w, 2, 7), location: 'Rec Centre', reminderMins: 10, recurrence: 'daily' }),
    ev({ title: 'Late Night Study', category: 'study', startAt: at(w, 4, 22), endAt: at(w, 5, 0, 30), notes: 'Runs past midnight — shows on both days.' }),
    ev({ title: 'Lecture – Algorithms', category: 'lecture', startAt: at(w, 7, 9), endAt: at(w, 7, 10, 15), location: 'Room 204', recurrence: 'weekly' }),
    ev({ title: 'Assignment Due', category: 'assignment', startAt: at(w, 9, 23), endAt: at(w, 9, 23, 45), notes: 'Submit through the course portal.', reminderMins: 60 }),
  ]
}
