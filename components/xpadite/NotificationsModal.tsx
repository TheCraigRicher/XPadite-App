'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import { useApp } from './AppContext'
import type { Reminder } from './types'

// ── Types ─────────────────────────────────────────────────────────────────────

type NotificationCategory =
  | 'reminder'
  | 'ai-coach'
  | 'task'
  | 'achievement'
  | 'milestone'
  | 'productivity'
  | 'general'
  | 'missed-task'

export interface NotificationAction {
  label: string
  actionType: string
  payload?: Record<string, unknown>
}

export interface XpaditeNotification {
  id: string
  title: string
  message: string
  timestamp: number
  read: boolean
  category: NotificationCategory
  tags?: string[]
  // Action buttons rendered inline (e.g. missing-time reminder)
  actions?: NotificationAction[]
  // Lifecycle for stateful notifications (missing-time reminder)
  lifecycle?: 'active' | 'snoozed' | 'dismissed' | 'resolved'
  snoozeUntil?: number | null
  snoozeCount?: number
  targetDateKey?: string
}

type FilterMode = 'all' | 'unread' | 'read' | 'reminders'

// ── Persistence ───────────────────────────────────────────────────────────────

const LS_KEY = 'xp9-notifications'

export function loadStoredNotifications(): XpaditeNotification[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(LS_KEY)
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

export function saveStoredNotifications(items: XpaditeNotification[]): void {
  try { localStorage.setItem(LS_KEY, JSON.stringify(items)) } catch {}
}

// Internal aliases kept for backwards compat within this file
const loadNotifications = loadStoredNotifications
const saveNotifications = saveStoredNotifications

// ── Category metadata ─────────────────────────────────────────────────────────

const CATEGORY_META: Record<NotificationCategory, { icon: string; color: string }> = {
  reminder:      { icon: '🔔', color: '#7c3aed' },
  'ai-coach':    { icon: '🤖', color: '#2563eb' },
  task:          { icon: '✓',  color: '#16a34a' },
  achievement:   { icon: '🏆', color: '#d97706' },
  milestone:     { icon: '🎯', color: '#db2777' },
  productivity:  { icon: '📊', color: '#0891b2' },
  general:       { icon: '📌', color: '#64748b' },
  'missed-task': { icon: '⚠',  color: '#dc2626' },
}

const CATEGORY_LABELS: Record<NotificationCategory, string> = {
  reminder:      'Reminder',
  'ai-coach':    'AI Coach',
  task:          'Task',
  achievement:   'Achievement',
  milestone:     'Milestone',
  productivity:  'Productivity',
  general:       'System',
  'missed-task': 'Missed Task',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtTime(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60_000)    return 'Just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  const d = new Date(ts)
  return (
    d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
    ' · ' +
    d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  )
}

function fmtReminderTime(t: string): string {
  const [h, m] = t.split(':').map(Number)
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`
}

function buildReminderMessage(r: Reminder): string {
  const parts: string[] = [`Scheduled ${fmtReminderTime(r.reminderTime)}`]
  if (r.emailEnabled && r.lastSentAt) parts.push('Email sent')
  return parts.join(' · ')
}

function buildReminderTags(r: Reminder): string[] {
  const label: Record<string, string> = {
    daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', yearly: 'Yearly',
  }
  return label[r.repeatFrequency] ? [label[r.repeatFrequency]] : []
}

function reminderToNotification(r: Reminder, read: boolean): XpaditeNotification {
  return {
    id: `r-${r.id}`,
    title: r.taskText || 'Reminder',
    message: buildReminderMessage(r),
    timestamp: r.localFiredAt ?? (r.lastSentAt ?? 0),
    read,
    category: 'reminder',
    tags: buildReminderTags(r),
  }
}

function getGroupKey(ts: number): string {
  const todayStart = new Date(new Date().setHours(0, 0, 0, 0)).getTime()
  if (ts >= todayStart)                       return 'Today'
  if (ts >= todayStart - 86_400_000)          return 'Yesterday'
  if (ts >= todayStart - 6 * 86_400_000)      return 'Earlier This Week'
  return new Date(ts).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

// ── Small icons ───────────────────────────────────────────────────────────────

function DotsIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true">
      <circle cx="12" cy="5" r="1.9" />
      <circle cx="12" cy="12" r="1.9" />
      <circle cx="12" cy="19" r="1.9" />
    </svg>
  )
}

// ── Tag badge ─────────────────────────────────────────────────────────────────

function TagBadge({
  label,
  color,
  soft = false,
}: {
  label: string
  color: string
  soft?: boolean
}) {
  return (
    <span
      style={{
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: '0.06em',
        color,
        background: soft ? `${color}10` : `${color}16`,
        border: `0.5px solid ${soft ? `${color}22` : `${color}30`}`,
        borderRadius: 4,
        padding: '2px 5px',
        textTransform: 'uppercase' as const,
        lineHeight: 1.4,
        display: 'inline-block',
        flexShrink: 0,
      }}
    >
      {label}
    </span>
  )
}

// ── Notification item ─────────────────────────────────────────────────────────

function NotificationItem({
  notification,
  isDark,
  linkedReminder,
  menuOpen,
  onMarkRead,
  onAction,
  onMenuToggle,
}: {
  notification: XpaditeNotification
  isDark: boolean
  linkedReminder?: Reminder
  menuOpen: boolean
  onMarkRead: () => void
  onAction?: (actionType: string, notification: XpaditeNotification) => void
  onMenuToggle: (rect: DOMRect) => void
}) {
  const [hovered, setHovered] = useState(false)
  const meta = CATEGORY_META[notification.category]
  const isUnread = !notification.read
  const notificationsMuted = !!linkedReminder && linkedReminder.notificationsEnabled === false

  const bg = isUnread
    ? hovered
      ? isDark ? 'rgba(124,58,237,0.16)' : 'rgba(124,58,237,0.10)'
      : isDark ? 'rgba(124,58,237,0.07)' : 'rgba(124,58,237,0.04)'
    : hovered
      ? isDark ? 'rgba(124,58,237,0.07)' : 'rgba(124,58,237,0.04)'
      : 'transparent'

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={isUnread ? onMarkRead : undefined}
      style={{
        display: 'flex',
        gap: 12,
        padding: '12px 16px',
        cursor: isUnread ? 'pointer' : 'default',
        background: bg,
        borderBottom: '0.5px solid var(--xp-bdr)',
        transition: 'background 150ms, transform 150ms',
        transform: hovered && isUnread ? 'translateX(2px)' : 'translateX(0)',
      }}
    >
      {/* Category icon */}
      <div
        style={{
          width: 34,
          height: 34,
          borderRadius: '50%',
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 15,
          background: notificationsMuted ? 'rgba(100,116,139,0.14)' : `${meta.color}15`,
          border: `0.5px solid ${notificationsMuted ? 'rgba(100,116,139,0.30)' : `${meta.color}30`}`,
          marginTop: 1,
          opacity: isUnread ? 1 : 0.55,
          transition: 'opacity 150ms',
        }}
      >
        {notificationsMuted ? '🔕' : meta.icon}
      </div>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Title + unread dot */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 6 }}>
          <p
            className="text-[13px] leading-snug"
            style={{
              color: 'var(--xp-txt)',
              fontWeight: isUnread ? 600 : 500,
              opacity: isUnread ? 1 : 0.68,
            }}
          >
            {notification.title}
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, marginTop: 2 }}>
            {isUnread && (
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: '50%',
                  background: meta.color,
                  flexShrink: 0,
                }}
              />
            )}
            <button
              data-xp-menu-trigger
              onClick={e => { e.stopPropagation(); onMenuToggle(e.currentTarget.getBoundingClientRect()) }}
              aria-label="Notification actions"
              aria-expanded={menuOpen}
              style={{
                width: 22,
                height: 22,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 6,
                flexShrink: 0,
                color: menuOpen ? 'var(--xp-txt)' : 'var(--xp-txt3)',
                background: menuOpen ? 'var(--xp-bg3)' : 'transparent',
              }}
            >
              <DotsIcon />
            </button>
          </div>
        </div>

        {/* Type + supplementary tags */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 5, flexWrap: 'wrap' as const }}>
          <TagBadge label={CATEGORY_LABELS[notification.category]} color={meta.color} />
          {(notification.tags ?? []).map(tag => (
            <TagBadge key={tag} label={tag} color={meta.color} soft />
          ))}
          {notificationsMuted && <TagBadge label="Notifications Off" color="#64748b" soft />}
        </div>

        {/* Message */}
        {notification.message && (
          <p
            className="text-[11.5px] mt-2 leading-relaxed"
            style={{ color: 'var(--xp-txt3)', opacity: isUnread ? 0.9 : 0.58 }}
          >
            {notification.message}
          </p>
        )}

        {/* Timestamp */}
        <p className="text-[10.5px] mt-1.5" style={{ color: 'var(--xp-txt3)', opacity: 0.5 }}>
          {fmtTime(notification.timestamp)}
        </p>

        {/* Action buttons — for stateful notifications like missing-time reminders */}
        {notification.actions && notification.actions.length > 0 && (
          <div style={{ display: 'flex', gap: 5, marginTop: 9, flexWrap: 'wrap' as const }}>
            {notification.actions.map(action => (
              <button
                key={action.actionType}
                onClick={e => {
                  e.stopPropagation()
                  onAction?.(action.actionType, notification)
                }}
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  letterSpacing: '0.02em',
                  padding: '3px 9px 4px',
                  borderRadius: 6,
                  border: `0.5px solid ${action.actionType === 'add-time' ? meta.color : `${meta.color}35`}`,
                  background: action.actionType === 'add-time'
                    ? meta.color
                    : isDark ? `${meta.color}18` : `${meta.color}0d`,
                  color: action.actionType === 'add-time' ? '#fff' : meta.color,
                  cursor: 'pointer',
                  transition: 'opacity 120ms',
                  lineHeight: 1.4,
                }}
                onMouseEnter={e => { e.currentTarget.style.opacity = '0.72' }}
                onMouseLeave={e => { e.currentTarget.style.opacity = '1' }}
              >
                {action.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Group header ──────────────────────────────────────────────────────────────

function GroupHeader({ label }: { label: string }) {
  return (
    <div
      style={{
        padding: '10px 16px 4px',
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: '0.08em',
        textTransform: 'uppercase' as const,
        color: 'var(--xp-txt3)',
        opacity: 0.5,
      }}
    >
      {label}
    </div>
  )
}

// ── Reminder actions menu (fixed-positioned so it escapes the scroll clip) ─────

const MENU_WIDTH = 190

function ReminderActionsMenu({
  anchorRect,
  canMarkRead,
  isReminder,
  muted,
  onViewDetails,
  onMarkRead,
  onToggleNotifications,
  onDeleteFromHistory,
}: {
  anchorRect: DOMRect
  canMarkRead: boolean
  isReminder: boolean
  muted: boolean
  onViewDetails: () => void
  onMarkRead: () => void
  onToggleNotifications: () => void
  onDeleteFromHistory: () => void
}) {
  const estHeight = 40 + (canMarkRead ? 34 : 0) + (isReminder ? 34 : 0) + 34 + 8
  const spaceBelow = window.innerHeight - anchorRect.bottom
  const openUpward = spaceBelow < estHeight + 12 && anchorRect.top > estHeight
  const top = openUpward ? anchorRect.top - estHeight - 6 : anchorRect.bottom + 6
  const left = Math.min(Math.max(8, anchorRect.right - MENU_WIDTH), window.innerWidth - MENU_WIDTH - 8)

  const itemStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 9,
    width: '100%', textAlign: 'left', padding: '8px 12px',
    fontSize: 12.5, fontWeight: 500, color: 'var(--xp-txt)',
    borderRadius: 8,
  }

  return (
    <div
      className="xp-notif-menu"
      onClick={e => e.stopPropagation()}
      style={{
        position: 'fixed', top, left, width: MENU_WIDTH, zIndex: 85,
        background: 'var(--xp-card)', border: '0.5px solid var(--xp-bdr2)', borderRadius: 12,
        boxShadow: '0 16px 40px rgba(0,0,0,0.24)', padding: 4, overflow: 'hidden',
      }}
    >
      <button style={itemStyle} className="xp-notif-menu-item" onClick={onViewDetails}>
        <span aria-hidden="true">👁</span> View details
      </button>
      {canMarkRead && (
        <button style={itemStyle} className="xp-notif-menu-item" onClick={onMarkRead}>
          <span aria-hidden="true">✓</span> Mark as read
        </button>
      )}
      {isReminder && (
        <button style={{ ...itemStyle, color: muted ? '#16a34a' : '#dc2626' }} className="xp-notif-menu-item" onClick={onToggleNotifications}>
          <span aria-hidden="true">{muted ? '🔔' : '🔕'}</span> {muted ? 'Turn on reminder' : 'Turn off reminder'}
        </button>
      )}
      <button style={{ ...itemStyle, color: '#dc2626' }} className="xp-notif-menu-item" onClick={onDeleteFromHistory}>
        <span aria-hidden="true">🗑</span> Delete from history
      </button>
    </div>
  )
}

// ── Turn-off confirmation dialog ────────────────────────────────────────────────

function TurnOffReminderDialog({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => void }) {
  return (
    <div
      className="fixed inset-0 z-[95] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.55)' }}
      onClick={e => { e.stopPropagation(); onCancel() }}
    >
      <div
        className="w-full max-w-[360px] rounded-2xl p-6 text-center relative"
        style={{ background: 'var(--xp-card)', border: '0.5px solid var(--xp-bdr2)', boxShadow: '0 24px 64px rgba(0,0,0,0.32)' }}
        onClick={e => e.stopPropagation()}
      >
        <button
          onClick={onCancel}
          aria-label="Close"
          className="absolute top-3 right-3 w-7 h-7 rounded-full flex items-center justify-center transition-opacity hover:opacity-75"
          style={{ background: 'var(--xp-bg3)', color: 'var(--xp-txt2)' }}
        >
          ✕
        </button>
        <div
          className="mx-auto mb-4 flex items-center justify-center"
          style={{ width: 56, height: 56, borderRadius: '50%', background: 'rgba(220,38,38,0.12)', fontSize: 24 }}
        >
          🔕
        </div>
        <h3 className="text-[15px] font-semibold mb-2" style={{ color: 'var(--xp-txt)' }}>
          Turn off this reminder?
        </h3>
        <p className="text-[12.5px] leading-relaxed mb-5" style={{ color: 'var(--xp-txt3)' }}>
          You&apos;ll stop receiving notifications for this reminder. The reminder will remain saved and you can turn notifications back on anytime.
        </p>
        <div className="flex items-center gap-2.5">
          <button
            onClick={onCancel}
            className="flex-1 text-[12.5px] font-semibold transition-opacity hover:opacity-80"
            style={{ padding: '10px 0', borderRadius: 10, background: 'var(--xp-bg3)', color: 'var(--xp-txt)', border: '0.5px solid var(--xp-bdr2)' }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 text-[12.5px] font-semibold text-white transition-opacity hover:opacity-90"
            style={{ padding: '10px 0', borderRadius: 10, background: '#dc2626' }}
          >
            Turn Off
          </button>
        </div>
      </div>
    </div>
  )
}

// ── View-details dialog ──────────────────────────────────────────────────────

function NotificationDetailDialog({ notification, onClose }: { notification: XpaditeNotification; onClose: () => void }) {
  const meta = CATEGORY_META[notification.category]
  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.55)' }}
      onClick={e => { e.stopPropagation(); onClose() }}
    >
      <div
        className="w-full max-w-[400px] rounded-2xl p-5"
        style={{ background: 'var(--xp-card)', border: '0.5px solid var(--xp-bdr2)', boxShadow: '0 24px 64px rgba(0,0,0,0.32)' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <span
              className="flex items-center justify-center flex-shrink-0"
              style={{ width: 34, height: 34, borderRadius: '50%', background: `${meta.color}15`, border: `0.5px solid ${meta.color}30`, fontSize: 15 }}
            >
              {meta.icon}
            </span>
            <h3 className="text-[14px] font-semibold leading-snug" style={{ color: 'var(--xp-txt)' }}>
              {notification.title}
            </h3>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 transition-opacity hover:opacity-75"
            style={{ background: 'var(--xp-bg3)', color: 'var(--xp-txt2)' }}
          >
            ✕
          </button>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap mb-3">
          <TagBadge label={CATEGORY_LABELS[notification.category]} color={meta.color} />
          {(notification.tags ?? []).map(tag => <TagBadge key={tag} label={tag} color={meta.color} soft />)}
        </div>
        {notification.message && (
          <p className="text-[12.5px] leading-relaxed mb-3" style={{ color: 'var(--xp-txt2)' }}>
            {notification.message}
          </p>
        )}
        <p className="text-[11px]" style={{ color: 'var(--xp-txt3)' }}>{fmtTime(notification.timestamp)}</p>
      </div>
    </div>
  )
}

// ── Main modal ────────────────────────────────────────────────────────────────

interface NotificationsModalProps {
  onClose: () => void
  onAction?: (actionType: string, notification: XpaditeNotification) => void
}

const FILTERS: { key: FilterMode; label: string }[] = [
  { key: 'all',       label: 'All'       },
  { key: 'unread',    label: 'Unread'    },
  { key: 'read',      label: 'Read'      },
  { key: 'reminders', label: 'Reminders' },
]

const EMPTY_MESSAGES: Record<FilterMode, { heading: string; body: string }> = {
  all:       { heading: 'No notifications yet',          body: 'Notifications from reminders, AI Coach, milestones, and achievements will appear here.' },
  unread:    { heading: 'No unread notifications',       body: "You're all caught up!"                                                                   },
  read:      { heading: 'No read notifications yet',     body: 'Notifications you have marked as read will appear here.'                                  },
  reminders: { heading: 'No reminder notifications yet', body: 'Reminders that have fired will appear here.'                                              },
}

export function NotificationsModal({ onClose, onAction }: NotificationsModalProps) {
  const { isDark, reminders, setReminderNotificationsEnabled } = useApp()
  const [stored, setStored] = useState<XpaditeNotification[]>(loadNotifications)
  const [filter, setFilter] = useState<FilterMode>('all')
  const [bellAnimating, setBellAnimating] = useState(false)
  const [popKey, setPopKey] = useState(0)
  const [hoveredFilter, setHoveredFilter] = useState<FilterMode | null>(null)
  const prevUnreadRef = useRef(-1)

  // Per-notification ⋮ menu, view-details dialog, and turn-off confirmation
  const [menuFor, setMenuFor] = useState<{ id: string; rect: DOMRect } | null>(null)
  const [detailNotif, setDetailNotif] = useState<XpaditeNotification | null>(null)
  const [confirmOffReminder, setConfirmOffReminder] = useState<Reminder | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // Escape closes the topmost open layer first, not the whole modal
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      if (confirmOffReminder) { setConfirmOffReminder(null); return }
      if (detailNotif) { setDetailNotif(null); return }
      if (menuFor) { setMenuFor(null); return }
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, confirmOffReminder, detailNotif, menuFor])

  // Outside click closes the ⋮ menu (trigger buttons manage their own toggle)
  useEffect(() => {
    if (!menuFor) return
    function onDown(e: MouseEvent) {
      const target = e.target as HTMLElement
      if (target.closest('.xp-notif-menu')) return
      if (target.closest('[data-xp-menu-trigger]')) return
      setMenuFor(null)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [menuFor])

  // Scrolling the list or resizing the window would strand the fixed menu — close it
  useEffect(() => {
    if (!menuFor) return
    const list = listRef.current
    function close() { setMenuFor(null) }
    list?.addEventListener('scroll', close)
    window.addEventListener('resize', close)
    return () => { list?.removeEventListener('scroll', close); window.removeEventListener('resize', close) }
  }, [menuFor])

  // Bell rings once when modal opens
  useEffect(() => {
    const t = setTimeout(() => setBellAnimating(true), 120)
    return () => clearTimeout(t)
  }, [])

  // Read-state map so derived reminder notifications reflect previously-saved read state
  const readMap = useMemo(() => {
    const m = new Map<string, boolean>()
    stored.forEach(n => m.set(n.id, n.read))
    return m
  }, [stored])

  // Derive fired reminder notifications from AppContext (localStorage-primary store)
  const reminderNotifs = useMemo((): XpaditeNotification[] =>
    reminders
      .filter(r => r.localFiredAt != null || r.lastSentAt != null)
      .map(r => reminderToNotification(r, readMap.get(`r-${r.id}`) ?? false)),
  [reminders, readMap])

  // Full merged list: stored entries + reminder-derived entries not already in stored
  // Dismissed and resolved notifications are hidden from the list
  const notifications = useMemo((): XpaditeNotification[] => {
    const storedIds = new Set(stored.map(n => n.id))
    const reminderOnly = reminderNotifs.filter(n => !storedIds.has(n.id))
    return [...stored, ...reminderOnly]
      .filter(n => n.lifecycle !== 'dismissed' && n.lifecycle !== 'resolved')
      .sort((a, b) => b.timestamp - a.timestamp)
  }, [stored, reminderNotifs])

  const unreadCount = useMemo(() => notifications.filter(n => !n.read).length, [notifications])

  // Badge pops whenever unread count changes after initial mount
  useEffect(() => {
    if (prevUnreadRef.current !== -1 && prevUnreadRef.current !== unreadCount) {
      setPopKey(k => k + 1)
    }
    prevUnreadRef.current = unreadCount
  }, [unreadCount])

  const visible = useMemo(() => {
    switch (filter) {
      case 'unread':    return notifications.filter(n => !n.read)
      case 'read':      return notifications.filter(n => n.read)
      case 'reminders': return notifications.filter(n => n.category === 'reminder')
      default:          return notifications
    }
  }, [notifications, filter])

  // Chronologically grouped for display
  const grouped = useMemo(() => {
    const groups: { key: string; items: XpaditeNotification[] }[] = []
    let lastKey = ''
    for (const n of visible) {
      const key = getGroupKey(n.timestamp)
      if (key !== lastKey) {
        groups.push({ key, items: [n] })
        lastKey = key
      } else {
        groups[groups.length - 1].items.push(n)
      }
    }
    return groups
  }, [visible])

  function markRead(id: string) {
    const target = notifications.find(n => n.id === id)
    if (!target) return
    const updated = { ...target, read: true }
    setStored(prev => {
      const alreadyStored = prev.find(n => n.id === id)
      const next = alreadyStored
        ? prev.map(n => n.id === id ? { ...n, read: true } : n)
        : [...prev, updated]
      saveNotifications(next)
      return next
    })
  }

  function markAllRead() {
    const snapshot = notifications
    setStored(prev => {
      const prevMap = new Map(prev.map(n => [n.id, n]))
      snapshot.forEach(n => { if (!n.read) prevMap.set(n.id, { ...n, read: true }) })
      const next = [...prevMap.values()]
      saveNotifications(next)
      return next
    })
  }

  // Handle action buttons on stateful notifications (e.g. missing-time reminder)
  function handleAction(actionType: string, notif: XpaditeNotification) {
    if (actionType === 'dismiss') {
      setStored(prev => {
        const alreadyStored = prev.find(n => n.id === notif.id)
        const next = alreadyStored
          ? prev.map(n => n.id === notif.id ? { ...n, lifecycle: 'dismissed' as const, read: true } : n)
          : [...prev, { ...notif, lifecycle: 'dismissed' as const, read: true }]
        saveNotifications(next)
        return next
      })
      return
    }
    if (actionType === 'snooze-tomorrow') {
      const d = new Date()
      d.setDate(d.getDate() + 1)
      d.setHours(10, 0, 0, 0)
      const snoozeUntil = d.getTime()
      setStored(prev => {
        const alreadyStored = prev.find(n => n.id === notif.id)
        const next = alreadyStored
          ? prev.map(n => n.id === notif.id ? {
              ...n,
              lifecycle: 'snoozed' as const,
              snoozeUntil,
              snoozeCount: (n.snoozeCount ?? 0) + 1,
              read: true,
            } : n)
          : [...prev, { ...notif, lifecycle: 'snoozed' as const, snoozeUntil, snoozeCount: 1, read: true }]
        saveNotifications(next)
        return next
      })
      return
    }
    // 'add-time' and any unknown types propagate to parent
    onAction?.(actionType, notif)
  }

  function reminderFor(notif: XpaditeNotification): Reminder | undefined {
    if (notif.category !== 'reminder') return undefined
    return reminders.find(r => `r-${r.id}` === notif.id)
  }

  function handleMenuToggle(id: string, rect: DOMRect) {
    setMenuFor(prev => prev?.id === id ? null : { id, rect })
  }

  function handleToggleNotifications(notif: XpaditeNotification) {
    const reminder = reminderFor(notif)
    if (!reminder) return
    setMenuFor(null)
    if (reminder.notificationsEnabled === false) {
      // Turning back on is low-risk — no confirmation needed
      setReminderNotificationsEnabled(reminder.id, true)
    } else {
      setConfirmOffReminder(reminder)
    }
  }

  function confirmTurnOff() {
    if (confirmOffReminder) setReminderNotificationsEnabled(confirmOffReminder.id, false)
    setConfirmOffReminder(null)
  }

  const empty = EMPTY_MESSAGES[filter]
  const menuNotif = menuFor ? notifications.find(n => n.id === menuFor.id) : undefined
  const menuReminder = menuNotif ? reminderFor(menuNotif) : undefined

  return (
    <div
      className="fixed inset-x-0 top-0 bottom-14 sm:inset-0 z-[70] flex items-stretch sm:items-center justify-center p-0 sm:p-4"
      style={{ background: 'rgba(0,0,0,0.55)' }}
      onClick={onClose}
    >
      <style>{`
        @keyframes xp-badge-pop {
          0%   { transform: scale(1);    }
          40%  { transform: scale(1.20); }
          100% { transform: scale(1);    }
        }
        .xp-notif-menu-item:hover { background: var(--xp-bg3); }
        .xp-notif-menu-item:active { background: var(--xp-bdr); }
        @keyframes xpNotifHdrFlow {
          0%   { background-position: 0% 50% }
          50%  { background-position: 100% 50% }
          100% { background-position: 0% 50% }
        }
        .xp-notif-hdr {
          background: linear-gradient(135deg, #5b21b6 0%, #6d28d9 22%, #7c3aed 46%, #8b5cf6 65%, #7c3aed 82%, #6d28d9 100%);
          background-size: 320% 320%;
          animation: xpNotifHdrFlow 14s ease infinite;
        }
      `}</style>
      <div
        className="w-full sm:max-w-[560px] sm:rounded-2xl rounded-none max-sm:border-0! overflow-hidden h-full max-h-full sm:h-[86vh] sm:max-h-[86vh]"
        style={{
          background: 'var(--xp-card)',
          border: '0.5px solid var(--xp-bdr2)',
          boxShadow: '0 24px 64px rgba(0,0,0,0.32)',
          display: 'flex',
          flexDirection: 'column',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div
          className="xp-notif-hdr flex items-center justify-between px-5 py-3.5 flex-shrink-0"
          style={{
            borderBottom: '1px solid rgba(255,255,255,0.08)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {/* Bell icon circle — rings on open, again on hover */}
            <div
              onMouseEnter={() => { if (!bellAnimating) setBellAnimating(true) }}
              style={{
                width: 38,
                height: 38,
                borderRadius: '50%',
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 17,
                background: 'rgba(255,255,255,0.14)',
                border: '0.5px solid rgba(255,255,255,0.28)',
                cursor: 'default',
              }}
            >
              <span
                className={bellAnimating ? 'xp-bell-ring' : ''}
                onAnimationEnd={() => setBellAnimating(false)}
              >
                🔔
              </span>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold" style={{ color: '#ffffff' }}>
                  Notifications
                </h2>
                {unreadCount > 0 && (
                  <span
                    key={popKey}
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      color: '#4c1d95',
                      background: 'rgba(255,255,255,0.92)',
                      borderRadius: 9,
                      minWidth: 18,
                      height: 18,
                      padding: '0 5px',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      animation: popKey > 0 ? 'xp-badge-pop 200ms ease-out both' : 'none',
                    }}
                  >
                    {unreadCount}
                  </span>
                )}
              </div>
              <p className="text-[11px] mt-0.5" style={{ color: 'rgba(255,255,255,0.60)' }}>
                Your notification history
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center transition-opacity hover:opacity-75"
            style={{
              background: 'rgba(255,255,255,0.14)',
              color: 'rgba(255,255,255,0.88)',
              border: '0.5px solid rgba(255,255,255,0.25)',
            }}
          >
            ✕
          </button>
        </div>

        {/* ── Filter bar ── */}
        <div
          className="flex items-center justify-between px-4 py-2.5 flex-shrink-0"
          style={{ borderBottom: '0.5px solid var(--xp-bdr)' }}
        >
          <div
            style={{
              display: 'flex',
              gap: 2,
              padding: 3,
              borderRadius: 8,
              background: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)',
            }}
          >
            {FILTERS.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setFilter(key)}
                onMouseEnter={() => setHoveredFilter(key)}
                onMouseLeave={() => setHoveredFilter(null)}
                style={{
                  position: 'relative' as const,
                  padding: '4px 11px 6px',
                  borderRadius: 6,
                  fontSize: 11,
                  fontWeight: filter === key ? 600 : 500,
                  background: filter === key
                    ? isDark ? 'rgba(124,58,237,0.28)' : 'rgba(124,58,237,0.12)'
                    : 'transparent',
                  color: filter === key ? '#7c3aed' : 'var(--xp-txt3)',
                  border: 'none',
                  cursor: 'pointer',
                  transition: 'background 150ms, color 150ms',
                  whiteSpace: 'nowrap' as const,
                }}
              >
                {label}
                {/* Hover underline — only on inactive tabs */}
                {filter !== key && (
                  <span
                    style={{
                      position: 'absolute' as const,
                      bottom: 2,
                      left: '50%',
                      height: 1.5,
                      width: '65%',
                      background: '#7c3aed',
                      borderRadius: 1,
                      transform: `translateX(-50%) scaleX(${hoveredFilter === key ? 1 : 0})`,
                      transition: 'transform 180ms ease',
                      transformOrigin: 'center',
                      display: 'block',
                      opacity: 0.65,
                    }}
                  />
                )}
              </button>
            ))}
          </div>

          {unreadCount > 0 && (
            <button
              onClick={markAllRead}
              style={{
                fontSize: 11,
                color: '#7c3aed',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                fontWeight: 500,
                flexShrink: 0,
                marginLeft: 8,
              }}
            >
              Mark all read
            </button>
          )}
        </div>

        {/* ── Notification list or empty state ── */}
        <div ref={listRef} style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
          {visible.length === 0 ? (
            <div className="flex flex-col items-center justify-center px-8 py-14 text-center">
              <div
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: '50%',
                  background: isDark ? 'rgba(124,58,237,0.08)' : 'rgba(124,58,237,0.06)',
                  border: '1px solid rgba(124,58,237,0.15)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 22,
                  marginBottom: 14,
                }}
              >
                🔔
              </div>
              <p className="text-sm font-semibold mb-1.5" style={{ color: 'var(--xp-txt)' }}>
                {empty.heading}
              </p>
              <p className="text-[12px] leading-relaxed" style={{ color: 'var(--xp-txt3)' }}>
                {empty.body}
              </p>
            </div>
          ) : (
            grouped.map(({ key, items }) => (
              <div key={key}>
                <GroupHeader label={key} />
                {items.map(n => (
                  <NotificationItem
                    key={n.id}
                    notification={n}
                    isDark={isDark}
                    linkedReminder={reminderFor(n)}
                    menuOpen={menuFor?.id === n.id}
                    onMarkRead={() => markRead(n.id)}
                    onAction={handleAction}
                    onMenuToggle={rect => handleMenuToggle(n.id, rect)}
                  />
                ))}
              </div>
            ))
          )}
        </div>
      </div>

      {menuFor && menuNotif && (
        <ReminderActionsMenu
          anchorRect={menuFor.rect}
          canMarkRead={!menuNotif.read}
          isReminder={!!menuReminder}
          muted={menuReminder?.notificationsEnabled === false}
          onViewDetails={() => { setDetailNotif(menuNotif); setMenuFor(null) }}
          onMarkRead={() => { markRead(menuNotif.id); setMenuFor(null) }}
          onToggleNotifications={() => handleToggleNotifications(menuNotif)}
          onDeleteFromHistory={() => { handleAction('dismiss', menuNotif); setMenuFor(null) }}
        />
      )}

      {detailNotif && (
        <NotificationDetailDialog notification={detailNotif} onClose={() => setDetailNotif(null)} />
      )}

      {confirmOffReminder && (
        <TurnOffReminderDialog onCancel={() => setConfirmOffReminder(null)} onConfirm={confirmTurnOff} />
      )}
    </div>
  )
}
