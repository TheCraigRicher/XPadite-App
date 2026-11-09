// ── Synced-calendar meeting TYPES (read-only events from a future Google / Outlook integration) ──
// There is NO built-in or sample data here any more: until a real calendar integration exists the list is empty and My Schedule shows
// only the user's own saved events. MeetingsModal depends on `XpaditeMeeting` only, so a real source can be plugged in later.

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
