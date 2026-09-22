// ── Meetings mock data (Phase 1 — front-end only) ───────────────────────────
// This file is the seam Phase 2 will replace with real Supabase/API reads.
// Every consumer of this data (MeetingsModal) only depends on `XpaditeMeeting`
// and `MOCK_MEETINGS`, so swapping the source later should not require
// touching the UI.

export type MeetingProviderId = 'google' | 'microsoft'
export type MeetingPlatform = 'google-meet' | 'zoom' | 'teams'

export interface XpaditeMeeting {
  id: string
  /** Which connected XPadite integration this event came from. */
  provider: MeetingProviderId
  /** Id of the source calendar event (mock — stands in for the real external id). */
  externalEventId: string
  /** Human-readable calendar the event lives in. Distinct from the account provider
   *  so a future account can expose more than one calendar under one provider. */
  calendarSource: string
  title: string
  /** Epoch ms */
  startAt: number
  /** Epoch ms */
  endAt: number
  /** Video-call link, or null for meetings with no call (e.g. in person). */
  meetingUrl: string | null
  /** The video platform the link opens in. Independent of `calendarSource`. */
  meetingProvider: MeetingPlatform | null
  isCancelled: boolean
  /** XPadite-owned notes — never written back to the external calendar. */
  notes: string
  addedToTaskManager: boolean
  linkedTaskId: string | null
}

function dayAt(dayOffset: number, hour: number, minute = 0): number {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + dayOffset)
  d.setHours(hour, minute, 0, 0)
  return d.getTime()
}

function plusMinutes(startAt: number, minutes: number): number {
  return startAt + minutes * 60_000
}

let seq = 0
function meeting(input: {
  provider: MeetingProviderId
  calendarSource: string
  title: string
  startAt: number
  endAt: number
  meetingUrl: string | null
  meetingProvider: MeetingPlatform | null
  isCancelled?: boolean
  notes?: string
  addedToTaskManager?: boolean
  linkedTaskId?: string | null
}): XpaditeMeeting {
  seq += 1
  return {
    id: `mock-meeting-${seq}`,
    externalEventId: `mock-ext-${seq}`,
    isCancelled: false,
    notes: '',
    addedToTaskManager: false,
    linkedTaskId: null,
    ...input,
  }
}

export const MOCK_MEETINGS: XpaditeMeeting[] = [
  // ── Today ──────────────────────────────────────────────────────────────
  meeting({
    provider: 'google', calendarSource: 'Google Calendar', title: 'Product Team Standup',
    startAt: dayAt(0, 10, 0), endAt: plusMinutes(dayAt(0, 10, 0), 30),
    meetingUrl: 'https://meet.google.com/xyz-abc-def', meetingProvider: 'google-meet',
  }),
  meeting({
    provider: 'google', calendarSource: 'Google Calendar', title: 'Client Review',
    startAt: dayAt(0, 14, 30), endAt: plusMinutes(dayAt(0, 14, 30), 60),
    meetingUrl: 'https://zoom.us/j/1234567890', meetingProvider: 'zoom',
  }),
  meeting({
    provider: 'microsoft', calendarSource: 'Outlook Calendar', title: 'Marketing Sync',
    startAt: dayAt(0, 16, 0), endAt: plusMinutes(dayAt(0, 16, 0), 30),
    meetingUrl: 'https://teams.microsoft.com/l/meetup-join/mock-marketing', meetingProvider: 'teams',
  }),

  // ── Next 3 weeks (upcoming + monthly density) ─────────────────────────
  meeting({
    provider: 'google', calendarSource: 'Google Calendar', title: 'Project Planning',
    startAt: dayAt(1, 9, 0), endAt: plusMinutes(dayAt(1, 9, 0), 60),
    meetingUrl: 'https://meet.google.com/plan-ahead-01', meetingProvider: 'google-meet',
  }),
  meeting({
    provider: 'google', calendarSource: 'Google Calendar', title: 'Design Review',
    startAt: dayAt(1, 13, 0), endAt: plusMinutes(dayAt(1, 13, 0), 60),
    meetingUrl: 'https://zoom.us/j/9988776655', meetingProvider: 'zoom',
  }),
  meeting({
    provider: 'microsoft', calendarSource: 'Outlook Calendar', title: 'Product Demo',
    startAt: dayAt(2, 11, 0), endAt: plusMinutes(dayAt(2, 11, 0), 60),
    meetingUrl: 'https://teams.microsoft.com/l/meetup-join/mock-demo', meetingProvider: 'teams',
  }),
  meeting({
    provider: 'google', calendarSource: 'Google Calendar', title: 'Weekly Design Sync',
    startAt: dayAt(3, 15, 0), endAt: plusMinutes(dayAt(3, 15, 0), 45),
    meetingUrl: 'https://meet.google.com/design-sync-03', meetingProvider: 'google-meet',
  }),
  meeting({
    provider: 'google', calendarSource: 'Google Calendar', title: 'Founder Check-In',
    startAt: dayAt(4, 9, 30), endAt: plusMinutes(dayAt(4, 9, 30), 30),
    meetingUrl: null, meetingProvider: null,
  }),
  meeting({
    provider: 'microsoft', calendarSource: 'Outlook Calendar', title: 'Quarterly Budget Review',
    startAt: dayAt(5, 10, 0), endAt: plusMinutes(dayAt(5, 10, 0), 90),
    meetingUrl: 'https://teams.microsoft.com/l/meetup-join/mock-budget', meetingProvider: 'teams',
    isCancelled: true,
  }),
  meeting({
    provider: 'google', calendarSource: 'Google Calendar', title: 'Marketing Review',
    startAt: dayAt(6, 14, 0), endAt: plusMinutes(dayAt(6, 14, 0), 60),
    meetingUrl: 'https://meet.google.com/mkt-review-06', meetingProvider: 'google-meet',
  }),
  meeting({
    provider: 'google', calendarSource: 'Google Calendar', title: 'Client Review',
    startAt: dayAt(9, 13, 0), endAt: plusMinutes(dayAt(9, 13, 0), 60),
    meetingUrl: 'https://zoom.us/j/1122334455', meetingProvider: 'zoom',
  }),
  meeting({
    provider: 'microsoft', calendarSource: 'Outlook Calendar', title: 'Marketing Sync',
    startAt: dayAt(11, 16, 0), endAt: plusMinutes(dayAt(11, 16, 0), 30),
    meetingUrl: 'https://teams.microsoft.com/l/meetup-join/mock-mkt2', meetingProvider: 'teams',
  }),
  meeting({
    provider: 'google', calendarSource: 'Google Calendar', title: 'Product Team Standup',
    startAt: dayAt(14, 10, 0), endAt: plusMinutes(dayAt(14, 10, 0), 30),
    meetingUrl: 'https://meet.google.com/standup-14', meetingProvider: 'google-meet',
  }),
  meeting({
    provider: 'google', calendarSource: 'Google Calendar', title: 'Weekly Design Sync',
    startAt: dayAt(17, 15, 0), endAt: plusMinutes(dayAt(17, 15, 0), 45),
    meetingUrl: 'https://meet.google.com/design-sync-17', meetingProvider: 'google-meet',
  }),
  meeting({
    provider: 'microsoft', calendarSource: 'Outlook Calendar', title: 'Founder Check-In',
    startAt: dayAt(20, 9, 0), endAt: plusMinutes(dayAt(20, 9, 0), 30),
    meetingUrl: null, meetingProvider: null,
  }),
  meeting({
    provider: 'google', calendarSource: 'Google Calendar', title: 'Client Review',
    startAt: dayAt(26, 13, 0), endAt: plusMinutes(dayAt(26, 13, 0), 60),
    meetingUrl: 'https://zoom.us/j/6677889900', meetingProvider: 'zoom',
  }),

  // ── Past ───────────────────────────────────────────────────────────────
  meeting({
    provider: 'google', calendarSource: 'Google Calendar', title: 'Product Team Standup',
    startAt: dayAt(-1, 10, 0), endAt: plusMinutes(dayAt(-1, 10, 0), 30),
    meetingUrl: 'https://meet.google.com/standup-y1', meetingProvider: 'google-meet',
    addedToTaskManager: true, linkedTaskId: 'mock-task-past-1',
    notes: 'Discussed sprint velocity — action item: revisit estimates on Thursday.',
  }),
  meeting({
    provider: 'microsoft', calendarSource: 'Outlook Calendar', title: 'Client Review',
    startAt: dayAt(-2, 14, 0), endAt: plusMinutes(dayAt(-2, 14, 0), 60),
    meetingUrl: 'https://teams.microsoft.com/l/meetup-join/mock-client-past', meetingProvider: 'teams',
  }),
  meeting({
    provider: 'google', calendarSource: 'Google Calendar', title: 'Weekly Design Sync',
    startAt: dayAt(-4, 15, 0), endAt: plusMinutes(dayAt(-4, 15, 0), 45),
    meetingUrl: 'https://meet.google.com/design-sync-past', meetingProvider: 'google-meet',
  }),
  meeting({
    provider: 'google', calendarSource: 'Google Calendar', title: 'Marketing Review',
    startAt: dayAt(-7, 11, 0), endAt: plusMinutes(dayAt(-7, 11, 0), 60),
    meetingUrl: 'https://zoom.us/j/5566778899', meetingProvider: 'zoom',
  }),
  meeting({
    provider: 'microsoft', calendarSource: 'Outlook Calendar', title: 'Founder Check-In',
    startAt: dayAt(-9, 9, 30), endAt: plusMinutes(dayAt(-9, 9, 30), 30),
    meetingUrl: null, meetingProvider: null,
  }),
  meeting({
    provider: 'google', calendarSource: 'Google Calendar', title: 'Product Demo',
    startAt: dayAt(-12, 13, 0), endAt: plusMinutes(dayAt(-12, 13, 0), 60),
    meetingUrl: 'https://meet.google.com/demo-past-12', meetingProvider: 'google-meet',
  }),
  meeting({
    provider: 'google', calendarSource: 'Google Calendar', title: 'Quarterly Budget Review',
    startAt: dayAt(-18, 10, 0), endAt: plusMinutes(dayAt(-18, 10, 0), 90),
    meetingUrl: 'https://zoom.us/j/2233445566', meetingProvider: 'zoom',
  }),
  meeting({
    provider: 'microsoft', calendarSource: 'Outlook Calendar', title: 'Client Review',
    startAt: dayAt(-25, 14, 0), endAt: plusMinutes(dayAt(-25, 14, 0), 60),
    meetingUrl: 'https://teams.microsoft.com/l/meetup-join/mock-client-old', meetingProvider: 'teams',
    isCancelled: true,
  }),
  meeting({
    provider: 'google', calendarSource: 'Google Calendar', title: 'Founder Check-In',
    startAt: dayAt(-33, 9, 0), endAt: plusMinutes(dayAt(-33, 9, 0), 30),
    meetingUrl: null, meetingProvider: null,
  }),
]
