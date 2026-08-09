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
  | 'missed-task'   // reserved for future AI Coach / task scheduling integration

export interface XpaditeNotification {
  id: string
  title: string
  message: string
  timestamp: number
  read: boolean
  category: NotificationCategory
  tags?: string[]   // supplementary badges e.g. 'Daily', 'Weekly', 'AI Coach'
}

type FilterMode = 'all' | 'unread' | 'read' | 'reminders'

// ── Persistence ───────────────────────────────────────────────────────────────

const LS_KEY = 'xp9-notifications'

function loadNotifications(): XpaditeNotification[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(LS_KEY)
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

function saveNotifications(items: XpaditeNotification[]) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(items)) } catch {}
}

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
  onMarkRead,
}: {
  notification: XpaditeNotification
  isDark: boolean
  onMarkRead: () => void
}) {
  const [hovered, setHovered] = useState(false)
  const meta = CATEGORY_META[notification.category]
  const isUnread = !notification.read

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
          background: `${meta.color}15`,
          border: `0.5px solid ${meta.color}30`,
          marginTop: 1,
          opacity: isUnread ? 1 : 0.55,
          transition: 'opacity 150ms',
        }}
      >
        {meta.icon}
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
          {isUnread && (
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: '50%',
                background: meta.color,
                flexShrink: 0,
                marginTop: 4,
              }}
            />
          )}
        </div>

        {/* Type + supplementary tags */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 5, flexWrap: 'wrap' as const }}>
          <TagBadge label={CATEGORY_LABELS[notification.category]} color={meta.color} />
          {(notification.tags ?? []).map(tag => (
            <TagBadge key={tag} label={tag} color={meta.color} soft />
          ))}
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

// ── Main modal ────────────────────────────────────────────────────────────────

interface NotificationsModalProps {
  onClose: () => void
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

export function NotificationsModal({ onClose }: NotificationsModalProps) {
  const { isDark, reminders } = useApp()
  // stored = manually-persisted notifications + reminder notifications whose read state was saved
  const [stored, setStored] = useState<XpaditeNotification[]>(loadNotifications)
  const [filter, setFilter] = useState<FilterMode>('all')
  const [bellAnimating, setBellAnimating] = useState(false)
  const [popKey, setPopKey] = useState(0)
  const [hoveredFilter, setHoveredFilter] = useState<FilterMode | null>(null)
  const prevUnreadRef = useRef(-1)

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

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
  const notifications = useMemo((): XpaditeNotification[] => {
    const storedIds = new Set(stored.map(n => n.id))
    const reminderOnly = reminderNotifs.filter(n => !storedIds.has(n.id))
    return [...stored, ...reminderOnly].sort((a, b) => b.timestamp - a.timestamp)
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

  const empty = EMPTY_MESSAGES[filter]

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center p-0 sm:p-4"
      style={{ background: 'rgba(0,0,0,0.55)' }}
      onClick={onClose}
    >
      <style>{`
        @keyframes xp-badge-pop {
          0%   { transform: scale(1);    }
          40%  { transform: scale(1.20); }
          100% { transform: scale(1);    }
        }
      `}</style>
      <div
        className="w-full sm:max-w-[560px] sm:rounded-2xl rounded-t-2xl overflow-hidden"
        style={{
          background: 'var(--xp-card)',
          border: '0.5px solid var(--xp-bdr2)',
          boxShadow: '0 24px 64px rgba(0,0,0,0.32)',
          height: '86vh',
          maxHeight: '86vh',
          display: 'flex',
          flexDirection: 'column',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div
          className="flex items-center justify-between px-5 py-3.5 flex-shrink-0"
          style={{
            background: 'linear-gradient(135deg, #3b0f8a 0%, #4c1d95 100%)',
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
        <div style={{ flex: 1, overflowY: 'auto' }}>
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
                    onMarkRead={() => markRead(n.id)}
                  />
                ))}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
