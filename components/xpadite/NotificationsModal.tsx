'use client'

import { useState, useEffect, useMemo } from 'react'
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

export interface XpaditeNotification {
  id: string
  title: string
  message: string
  timestamp: number
  read: boolean
  category: NotificationCategory
}

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
  reminder:     { icon: '🔔', color: '#7c3aed' },
  'ai-coach':   { icon: '🤖', color: '#2563eb' },
  task:         { icon: '✓',  color: '#16a34a' },
  achievement:  { icon: '🏆', color: '#d97706' },
  milestone:    { icon: '🎯', color: '#db2777' },
  productivity: { icon: '📊', color: '#0891b2' },
  general:      { icon: '📌', color: '#64748b' },
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtTime(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60_000)    return 'Just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  const d = new Date(ts)
  return (
    d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
    ' at ' +
    d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  )
}

function fmtReminderTime(t: string): string {
  const [h, m] = t.split(':').map(Number)
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`
}

function buildReminderMessage(r: Reminder): string {
  const parts: string[] = [`Set for ${fmtReminderTime(r.reminderTime)}`]
  const repeatLabel: Record<string, string> = {
    daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', yearly: 'Yearly',
  }
  if (repeatLabel[r.repeatFrequency]) parts.push(repeatLabel[r.repeatFrequency])
  if (r.emailEnabled && r.lastSentAt) parts.push('Email sent')
  return parts.join(' · ')
}

function reminderToNotification(r: Reminder, read: boolean): XpaditeNotification {
  return {
    id: `r-${r.id}`,
    title: r.taskText || 'Reminder',
    message: buildReminderMessage(r),
    timestamp: r.localFiredAt ?? r.lastSentAt!,
    read,
    category: 'reminder',
  }
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
  const meta = CATEGORY_META[notification.category]

  return (
    <div
      onClick={!notification.read ? onMarkRead : undefined}
      style={{
        display: 'flex',
        gap: 12,
        padding: '12px 16px',
        cursor: notification.read ? 'default' : 'pointer',
        background: !notification.read
          ? isDark ? 'rgba(124,58,237,0.06)' : 'rgba(124,58,237,0.03)'
          : 'transparent',
        borderBottom: '0.5px solid var(--xp-bdr)',
        transition: 'background 150ms',
      }}
    >
      {/* Category icon */}
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: '50%',
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 16,
          background: `${meta.color}18`,
          border: `0.5px solid ${meta.color}38`,
        }}
      >
        {meta.icon}
      </div>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 6 }}>
          <p className="text-[13px] font-semibold leading-snug" style={{ color: 'var(--xp-txt)' }}>
            {notification.title}
          </p>
          {!notification.read && (
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
        <p className="text-[12px] mt-0.5 leading-relaxed" style={{ color: 'var(--xp-txt3)' }}>
          {notification.message}
        </p>
        <p className="text-[10.5px] mt-1.5" style={{ color: 'var(--xp-txt3)', opacity: 0.65 }}>
          {fmtTime(notification.timestamp)}
        </p>
      </div>
    </div>
  )
}

// ── Main modal ────────────────────────────────────────────────────────────────

interface NotificationsModalProps {
  onClose: () => void
}

export function NotificationsModal({ onClose }: NotificationsModalProps) {
  const { isDark, reminders } = useApp()
  // stored = manually-persisted notifications + reminder notifications whose read state was saved
  const [stored, setStored] = useState<XpaditeNotification[]>(loadNotifications)
  const [filter, setFilter] = useState<'all' | 'unread'>('all')

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

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

  // Full list: stored entries + reminder-derived entries not already represented in stored
  const notifications = useMemo((): XpaditeNotification[] => {
    const storedIds = new Set(stored.map(n => n.id))
    const reminderOnly = reminderNotifs.filter(n => !storedIds.has(n.id))
    return [...stored, ...reminderOnly].sort((a, b) => b.timestamp - a.timestamp)
  }, [stored, reminderNotifs])

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
    // Snapshot current notifications (includes derived) and mark all read
    const snapshot = notifications
    setStored(prev => {
      const prevMap = new Map(prev.map(n => [n.id, n]))
      snapshot.forEach(n => { if (!n.read) prevMap.set(n.id, { ...n, read: true }) })
      const next = [...prevMap.values()]
      saveNotifications(next)
      return next
    })
  }

  const visible = filter === 'unread' ? notifications.filter(n => !n.read) : notifications
  const unreadCount = notifications.filter(n => !n.read).length

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center p-0 sm:p-4"
      style={{ background: 'rgba(0,0,0,0.55)' }}
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-[420px] sm:rounded-2xl rounded-t-2xl overflow-hidden"
        style={{
          background: 'var(--xp-card)',
          border: '0.5px solid var(--xp-bdr2)',
          boxShadow: '0 24px 64px rgba(0,0,0,0.30)',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4 flex-shrink-0"
          style={{
            background: isDark
              ? 'linear-gradient(135deg, #0a0a1a 0%, #1a0a30 100%)'
              : 'linear-gradient(135deg, #f3f0ff 0%, #ede9fe 100%)',
            borderBottom: '0.5px solid var(--xp-bdr)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div>
              <div className="flex items-center gap-1.5">
                <h2 className="text-sm font-semibold" style={{ color: 'var(--xp-txt)' }}>Notifications</h2>
                {unreadCount > 0 && (
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      color: 'white',
                      background: '#7c3aed',
                      borderRadius: 9,
                      minWidth: 18,
                      height: 18,
                      padding: '0 4px',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {unreadCount}
                  </span>
                )}
              </div>
              <p className="text-[11px] mt-0.5" style={{ color: 'var(--xp-txt3)' }}>Your notification history</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center hover:opacity-70 transition-opacity"
            style={{ background: 'rgba(124,58,237,0.12)', color: '#7c3aed' }}
          >
            ✕
          </button>
        </div>

        {/* Filter bar */}
        {notifications.length > 0 && (
          <div
            className="flex items-center justify-between px-4 py-2 flex-shrink-0"
            style={{ borderBottom: '0.5px solid var(--xp-bdr)' }}
          >
            <div style={{ display: 'flex', gap: 4 }}>
              {(['all', 'unread'] as const).map(f => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  style={{
                    padding: '4px 10px',
                    borderRadius: 6,
                    fontSize: 11,
                    fontWeight: filter === f ? 700 : 500,
                    background: filter === f
                      ? isDark ? 'rgba(124,58,237,0.20)' : 'rgba(124,58,237,0.10)'
                      : 'transparent',
                    color: filter === f ? '#7c3aed' : 'var(--xp-txt3)',
                    border: 'none',
                    cursor: 'pointer',
                    textTransform: 'capitalize',
                  }}
                >
                  {f}
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
                }}
              >
                Mark all read
              </button>
            )}
          </div>
        )}

        {/* Notification list or empty state */}
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
                {filter === 'unread' ? 'No unread notifications' : 'No notifications yet'}
              </p>
              <p className="text-[12px] leading-relaxed" style={{ color: 'var(--xp-txt3)' }}>
                {filter === 'unread'
                  ? "You're all caught up!"
                  : 'Notifications from reminders, AI Coach, milestones, and achievements will appear here.'}
              </p>
            </div>
          ) : (
            visible.map(n => (
              <NotificationItem
                key={n.id}
                notification={n}
                isDark={isDark}
                onMarkRead={() => markRead(n.id)}
              />
            ))
          )}
        </div>
      </div>
    </div>
  )
}
