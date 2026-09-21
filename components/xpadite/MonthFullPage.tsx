'use client'

import { useMemo, useEffect, useState, useCallback, useRef } from 'react'
import { useApp } from './AppContext'
import { GaugeMeter } from './GaugeMeter'
import { generateShareCardDataUri } from './ShareCardModal'
import { addGalleryItem } from './GalleryModal'
import type { GalleryItem } from './GalleryModal'
import {
  dateKey, isToday, DAY_HEADERS, MONTHS, APP_YEAR, getMonthStats, formatMs,
  hexToRgba, resolveProgressColor,
} from './utils'
import { useUpcomingReminderDates } from './useUpcomingReminderDates'

// ─── Injected styles (keyframes + premium button hover rules) ─────────────────

const MFP_STYLES = `
  @keyframes xp-mfp-in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
  @keyframes xp-from-right{from{opacity:0;transform:translateX(52px)}to{opacity:1;transform:translateX(0)}}
  @keyframes xp-from-left{from{opacity:0;transform:translateX(-52px)}to{opacity:1;transform:translateX(0)}}
  /* Desktop: header title fixed min-width */
  .xp-mfp-hdr-title{min-width:260px;}

  @media(max-width:640px){
    /* Overlay: fills screen above bottom nav; fully opaque to prevent bleed-through */
    .xp-mfp-overlay{bottom:56px!important;overflow:hidden!important;display:flex!important;flex-direction:column!important;padding:0!important;background:rgba(0,0,0,1)!important;}
    /* Wrap: fills overlay */
    .xp-mfp-wrap{flex:1!important;min-height:0!important;padding:0!important;display:flex!important;flex-direction:column!important;align-items:stretch!important;justify-content:flex-start!important;}
    /* Modal box: fills all space; background matches calendar surface for seamless fill */
    .xp-mfp-box{flex:1!important;height:auto!important;max-height:none!important;max-width:none!important;width:100%!important;border-radius:0!important;margin:0!important;background:var(--xp-bg)!important;}

    /* Mobile header: SINGLE ROW — back on left, toggle on right, title TRULY centered (absolute) */
    .xp-mfp-hdr{display:flex!important;flex-wrap:nowrap!important;align-items:center;justify-content:space-between!important;gap:0;padding:12px 10px!important;position:relative!important;}
    .xp-mfp-hdr-l{order:1;flex:0 0 auto;align-self:center;position:relative;z-index:2;}
    /* Center section: absolutely centered in header so title aligns with viewport center */
    .xp-mfp-hdr-c{
      position:absolute!important;left:50%!important;top:50%!important;
      transform:translate(-50%,-50%)!important;
      flex:none!important;width:auto!important;
      display:flex!important;align-items:center!important;gap:8px!important;
      justify-content:center!important;padding-top:0!important;z-index:1;
    }
    /* Dashboard view only: widen gap around title for breathing room (calendar keeps default 8px) */
    .xp-mfp-hdr-c-dash{gap:16px!important;}
    .xp-mfp-hdr-r{order:3;flex:0 0 auto;margin-left:0!important;display:flex!important;justify-content:flex-end;align-items:center;gap:0!important;position:relative;z-index:2;}

    .xp-mfp-hdr-title{min-width:0!important;font-size:12px!important;}
    .xp-mfp-nav{width:28px!important;height:28px!important;font-size:18px!important;}

    /* Back button: transparent, no focus rectangle on tap */
    .xp-mfp-hdr .xp-mfp-back{background:transparent!important;border:none!important;box-shadow:none!important;padding:6px 6px 6px 0!important;font-size:22px!important;line-height:1!important;border-radius:4px!important;-webkit-tap-highlight-color:transparent!important;}
    .xp-mfp-hdr .xp-mfp-back:hover{background:transparent!important;transform:none!important;box-shadow:none!important;}
    .xp-mfp-hdr .xp-mfp-back:focus{outline:none!important;background:transparent!important;box-shadow:none!important;}
    .xp-mfp-hdr .xp-mfp-back:focus:not(:focus-visible){background:transparent!important;outline:none!important;box-shadow:none!important;}
    .xp-mfp-hdr .xp-mfp-back:active{background:rgba(255,255,255,0.12)!important;}
    .xp-back-txt{display:none;}

    /* Remove dashboard pill from mobile header */
    .xp-mfp-hdr .xp-mfp-dash-pill{display:none!important;}

    /* Calendar: slightly increased weekday-bar height + week-row spacing */
    .xp-mfp-cal-body{padding:10px 6px!important;}
    .xp-mfp-cal-dh{padding-top:9px!important;padding-bottom:9px!important;}
    .xp-mfp-cal-grid{row-gap:24px!important;}
    .xp-cal-circle{inset:20%!important;}

    /* Mobile: hide desktop share button, show dual bar */
    .xp-mfp-share-desktop{display:none!important;}

    /* Subtle secondary action bar — light background, tertiary hierarchy */
    .xp-mfp-dual-bar{
      display:flex!important;align-items:center;
      margin:0!important;padding:11px 14px!important;gap:10px!important;
      border-radius:0!important;border:none!important;
      border-top:0.5px solid rgba(0,0,0,0.08)!important;
      background:rgba(124,58,237,0.05)!important;
      box-shadow:none!important;
      flex-shrink:0!important;
    }
    .xp-mfp-dual-left,.xp-mfp-dual-right{
      flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;
      padding:7px 8px!important;
      background:rgba(124,58,237,0.07)!important;
      border:1px solid rgba(124,58,237,0.20)!important;
      border-radius:12px!important;cursor:pointer;
      font-size:11px!important;font-weight:600!important;color:#7c3aed!important;line-height:1.3;
      box-shadow:0 1px 4px rgba(124,58,237,0.08)!important;
      -webkit-tap-highlight-color:transparent;
      transition:transform 120ms ease,background 120ms ease!important;
    }
    .xp-mfp-dual-left:active,.xp-mfp-dual-right:active{
      transform:scale(0.97)!important;
      background:rgba(124,58,237,0.14)!important;
      transition:transform 80ms ease,background 80ms ease!important;
    }
    .xp-mfp-dual-divider{display:none!important;}
    .xp-mfp-dual-icon{color:#7c3aed!important;}

    /* Mobile dashboard header: title + month/year subtitle inside header */
    .xp-mfp-dash-main-title{display:none!important;}
    .xp-mfp-dash-mobile-title{display:inline!important;}
    .xp-mfp-dash-mobile-sub{display:block!important;font-size:9.5px!important;font-weight:500!important;color:rgba(255,255,255,0.65)!important;margin-top:2px!important;line-height:1.2!important;white-space:nowrap;}
  }

  /* Desktop defaults */
  .xp-mfp-dash-mobile-title{display:none;}
  .xp-mfp-dash-mobile-sub{display:none;}
  .xp-mfp-share-desktop{display:flex;}
  .xp-mfp-dual-bar{display:none;flex-shrink:0;}
  .xp-mfp-dual-left,.xp-mfp-dual-right{
    flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;
    padding:13px 8px;background:transparent;border:none;cursor:pointer;
    font-size:11px;font-weight:600;color:#7c3aed;line-height:1.3;
    -webkit-tap-highlight-color:transparent;
  }
  .xp-mfp-dual-icon{font-size:15px;line-height:1;margin-bottom:1px;}
  .xp-mfp-dual-divider{width:1px;background:rgba(124,58,237,0.20);flex-shrink:0;align-self:stretch;margin:10px 0;}
  .xp-mfp-dash-ctx{display:none;text-align:center;font-size:10.5px;font-weight:500;color:var(--xp-txt2,#64748b);padding:8px 0 2px;letter-spacing:0.01em;}
  @media(max-width:640px){.xp-mfp-dash-ctx{display:none!important;}}

  .xp-mfp-back{
    display:inline-flex;align-items:center;gap:6px;
    padding:7px 20px;border-radius:24px;font-size:11px;font-weight:700;
    cursor:pointer;background:white;color:#7c3aed;
    border:1px solid rgba(124,58,237,0.30);
    box-shadow:0 1px 5px rgba(124,58,237,0.14);
    transition:all 180ms ease;
  }
  .xp-mfp-back:hover{
    background:#7c3aed!important;color:white!important;
    border-color:#7c3aed!important;
    box-shadow:0 4px 16px rgba(124,58,237,0.42),0 2px 6px rgba(124,58,237,0.22)!important;
    transform:translateY(-1px);
  }

  /* Back button on purple header */
  .xp-mfp-hdr .xp-mfp-back{
    background:rgba(255,255,255,0.12);color:white;
    border:1px solid rgba(255,255,255,0.22);
    box-shadow:0 1px 5px rgba(0,0,0,0.18);
  }
  .xp-mfp-hdr .xp-mfp-back:hover{
    background:rgba(255,255,255,0.22)!important;color:white!important;
    border-color:rgba(255,255,255,0.38)!important;
    box-shadow:0 4px 12px rgba(0,0,0,0.28)!important;
  }

  .xp-mfp-close{
    width:36px;height:36px;border-radius:50%;
    display:flex;align-items:center;justify-content:center;
    font-size:13px;cursor:pointer;
    background:white;color:#7c3aed;
    border:1px solid rgba(124,58,237,0.30);
    box-shadow:0 1px 5px rgba(124,58,237,0.14);
    transition:all 180ms ease;flex-shrink:0;
  }
  .xp-mfp-close:hover{
    background:#7c3aed!important;color:white!important;
    border-color:#7c3aed!important;
    box-shadow:0 4px 14px rgba(124,58,237,0.40)!important;
    transform:translateY(-1px);
  }

  /* Close button on purple header */
  .xp-mfp-hdr .xp-mfp-close{
    background:rgba(255,255,255,0.12);color:white;
    border:1px solid rgba(255,255,255,0.22);
    box-shadow:0 1px 5px rgba(0,0,0,0.18);
  }
  .xp-mfp-hdr .xp-mfp-close:hover{
    background:rgba(255,255,255,0.22)!important;color:white!important;
    border-color:rgba(255,255,255,0.38)!important;
    box-shadow:0 4px 12px rgba(0,0,0,0.28)!important;
  }

  .xp-mfp-nav:not(:disabled):hover{
    background:rgba(255,255,255,0.26)!important;
    border-color:rgba(255,255,255,0.50)!important;
    box-shadow:0 2px 12px rgba(0,0,0,0.30),inset 0 1px 0 rgba(255,255,255,0.22)!important;
  }
  .xp-mfp-nav:not(:disabled):active{
    background:rgba(255,255,255,0.16)!important;
    border-color:rgba(255,255,255,0.35)!important;
    transform:scale(0.94)!important;
    transition-duration:80ms!important;
  }
  .xp-mfp-nav:disabled{opacity:0.2!important;cursor:default!important;}

  .xp-mfp-share:hover{
    background:#7c3aed!important;color:white!important;
    border-color:#7c3aed!important;
    box-shadow:0 4px 14px rgba(124,58,237,0.40)!important;
    transform:translateY(-1px);
  }

  /* Clean-view fade transition for calendar indicators */
  .xp-cal-fade{transition:opacity 200ms ease;}
  @media(prefers-reduced-motion:reduce){.xp-cal-fade{transition:none!important;}}

  /* Monthly Dashboard pill micro-interactions */
  .xp-mfp-dash-pill{transition:background 180ms ease,border-color 180ms ease,box-shadow 180ms ease,transform 180ms ease;}
  .xp-mfp-dash-pill:hover{
    background:rgba(255,255,255,0.22)!important;
    border-color:rgba(255,255,255,0.42)!important;
    box-shadow:0 2px 12px rgba(0,0,0,0.24),0 0 0 1px rgba(255,255,255,0.14)!important;
    transform:translateY(-1px);
  }
  .xp-mfp-dash-pill:active{
    transform:translateY(0) scale(0.97)!important;
    transition-duration:80ms!important;
  }
  @media(prefers-reduced-motion:reduce){
    .xp-mfp-dash-pill{transition:background 180ms ease,border-color 180ms ease!important;}
    .xp-mfp-dash-pill:hover,.xp-mfp-dash-pill:active{transform:none!important;}
  }

  /* Back-button final override — placed after all global rules so these !important values
     win over the global .xp-mfp-hdr .xp-mfp-back:hover{background:rgba(...)!important}
     that would otherwise override the earlier mobile block (same specificity, later position). */
  @media(max-width:640px){
    .xp-mfp-hdr .xp-mfp-back{
      background:transparent!important;border:none!important;
      box-shadow:none!important;outline:none!important;
      transition:background 80ms ease!important;
    }
    .xp-mfp-hdr .xp-mfp-back:hover{
      background:transparent!important;border:none!important;
      box-shadow:none!important;transform:none!important;
    }
    .xp-mfp-hdr .xp-mfp-back:focus,.xp-mfp-hdr .xp-mfp-back:focus-visible{
      outline:none!important;background:transparent!important;
      box-shadow:none!important;border:none!important;
    }
    .xp-mfp-hdr .xp-mfp-back:focus:not(:focus-visible){
      outline:none!important;background:transparent!important;
      box-shadow:none!important;border:none!important;
    }
    .xp-mfp-hdr .xp-mfp-back:active{
      background:rgba(255,255,255,0.12)!important;
      border:none!important;box-shadow:none!important;
    }
  }
`

// ─── Platform definitions ─────────────────────────────────────────────────────

interface Platform {
  id: string; label: string; sublabel?: string
  color: string; bg: string; abbr: string
}

const PLATFORMS: Platform[] = [
  { id: 'ig-story', label: 'Instagram', sublabel: 'Story', color: '#fff', bg: 'linear-gradient(135deg,#f09433,#e6683c,#dc2743,#cc2366,#bc1888)', abbr: 'IG' },
  { id: 'ig-post',  label: 'Instagram', sublabel: 'Post',  color: '#fff', bg: 'linear-gradient(135deg,#f09433,#e6683c,#dc2743,#cc2366,#bc1888)', abbr: 'IG' },
  { id: 'fb',       label: 'Facebook',  sublabel: 'Post',  color: '#fff', bg: '#1877F2', abbr: 'f'  },
  { id: 'linkedin', label: 'LinkedIn',  sublabel: 'Post',  color: '#fff', bg: '#0A66C2', abbr: 'in' },
  { id: 'x',        label: 'X',         sublabel: 'Post',  color: '#fff', bg: '#000000', abbr: 'X'  },
  { id: 'tiktok',   label: 'TikTok',    sublabel: '',      color: '#fff', bg: '#010101', abbr: 'TT' },
  { id: 'snapchat', label: 'Snapchat',  sublabel: 'Story', color: '#000', bg: '#FFFC00', abbr: 'SC' },
  { id: 'whatsapp', label: 'WhatsApp',  sublabel: '',      color: '#fff', bg: '#25D366', abbr: 'WA' },
]

const CONN_KEY = 'xp9_connections'
function getConnections(): Record<string, boolean> {
  if (typeof window === 'undefined') return {}
  try { return JSON.parse(localStorage.getItem(CONN_KEY) || '{}') } catch { return {} }
}
function markConnected(id: string) {
  const c = getConnections(); c[id] = true; localStorage.setItem(CONN_KEY, JSON.stringify(c))
}

// ─── PlatformLogo ─────────────────────────────────────────────────────────────

function PlatformLogo({ p }: { p: Platform }) {
  const smallAbbr = p.abbr === 'in' || p.abbr === 'TT' || p.abbr === 'WA' || p.abbr === 'SC'
  return (
    <div style={{
      width: 40, height: 40, borderRadius: 12, flexShrink: 0,
      background: p.bg,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: smallAbbr ? 10 : 15, fontWeight: 800, color: p.color,
      fontStyle: p.abbr === 'f' ? 'italic' : 'normal',
    }}>
      {p.abbr}
    </div>
  )
}

// ─── ShareIcon ────────────────────────────────────────────────────────────────

const ShareIcon = () => (
  <svg viewBox="0 0 20 18" fill="none" width="14" height="13" aria-hidden="true">
    <circle cx="16" cy="2" r="2" fill="currentColor"/>
    <circle cx="16" cy="15" r="2" fill="currentColor"/>
    <circle cx="4" cy="9" r="2" fill="currentColor"/>
    <line x1="5.8" y1="8" x2="14.3" y2="3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
    <line x1="5.8" y1="10" x2="14.3" y2="15" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
  </svg>
)

// ─── Share Card Preview (CSS mockup shown inside the share panel) ─────────────

function ShareCardPreview({ month, stats, totalMs, currentStreak, longestStreak }: {
  month: number
  stats: ReturnType<typeof getMonthStats>
  totalMs: number
  currentStreak: number
  longestStreak: number
}) {
  type Chip = { emoji: string; label: string; value: string }
  const chips: Chip[] = [
    { emoji: '✅', label: 'Productive',  value: `${stats.productiveDays}/${stats.totalDays}d` },
    { emoji: '📈', label: 'Completion',  value: `${stats.completionRate}%` },
    { emoji: '🔗', label: 'Streak',      value: `${currentStreak}d` },
    { emoji: '⚡', label: 'Best Streak', value: `${longestStreak}d` },
  ]
  if (stats.hyperDays > 0)     chips.push({ emoji: '🔥', label: 'Hyper',     value: String(stats.hyperDays) })
  if (stats.milestoneDays > 0) chips.push({ emoji: '🏆', label: 'Milestone', value: String(stats.milestoneDays) })
  if (stats.goalDays > 0)      chips.push({ emoji: '🎯', label: 'Goals',     value: String(stats.goalDays) })
  if (totalMs > 0)              chips.push({ emoji: '⏱', label: 'Hours',     value: formatMs(totalMs) })

  return (
    <div style={{
      background: 'linear-gradient(135deg,#1a0533 0%,#2d1b69 45%,#1a1a3e 100%)',
      borderRadius: 18, padding: '18px 20px 14px',
      border: '1px solid rgba(167,139,250,0.18)',
      boxShadow: '0 8px 32px rgba(124,58,237,0.28), inset 0 1px 0 rgba(255,255,255,0.06)',
      position: 'relative', overflow: 'hidden',
    }}>
      <div style={{ position: 'absolute', top: -50, right: -50, width: 130, height: 130, borderRadius: '50%', background: 'radial-gradient(circle,rgba(124,58,237,0.32) 0%,transparent 70%)', pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', bottom: -30, left: -30, width: 90, height: 90, borderRadius: '50%', background: 'radial-gradient(circle,rgba(99,102,241,0.20) 0%,transparent 70%)', pointerEvents: 'none' }} />
      <div style={{ fontSize: 8, fontWeight: 700, letterSpacing: '0.14em', color: 'rgba(216,180,254,0.52)', marginBottom: 6, position: 'relative' }}>XPADITE MONTHLY RECAP</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: 'white', lineHeight: 1.1, marginBottom: 14, position: 'relative' }}>
        {MONTHS[month]} <span style={{ opacity: 0.6, fontSize: 16 }}>{APP_YEAR}</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 6, position: 'relative' }}>
        {chips.slice(0, 8).map(c => (
          <div key={c.label} style={{
            background: 'rgba(255,255,255,0.07)', borderRadius: 11, padding: '8px 4px',
            border: '0.5px solid rgba(255,255,255,0.08)', textAlign: 'center',
          }}>
            <div style={{ fontSize: 14, lineHeight: 1, marginBottom: 3 }}>{c.emoji}</div>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'white' }}>{c.value}</div>
            <div style={{ fontSize: 7, color: 'rgba(255,255,255,0.40)', marginTop: 2 }}>{c.label}</div>
          </div>
        ))}
      </div>
      <div style={{ fontSize: 7, color: 'rgba(167,139,250,0.35)', marginTop: 11, textAlign: 'center', letterSpacing: '0.07em', position: 'relative' }}>
        XPADITE · YOUR PRODUCTIVITY JOURNEY
      </div>
    </div>
  )
}

// ─── Reminder ring overlay ────────────────────────────────────────────────────

function ReminderRing({ count }: { count: number }) {
  if (count === 0) return null
  return (
    <>
      <div
        aria-label={count === 1 ? 'Has 1 upcoming reminder' : `Has ${count} upcoming reminders`}
        className="absolute inset-[14%] rounded-full pointer-events-none"
        style={{
          border: '2px solid rgba(239,68,68,0.55)',
          boxShadow: '0 0 0 2px rgba(239,68,68,0.08)',
          zIndex: 2,
          transition: 'opacity 200ms ease',
        }}
      />
      {count > 1 && (
        <span
          aria-hidden="true"
          className="absolute flex items-center justify-center pointer-events-none"
          style={{
            top: '6%', right: '6%',
            minWidth: 10, height: 10,
            padding: '0 2px',
            borderRadius: 6,
            background: 'rgba(239,68,68,0.90)',
            fontSize: 6, fontWeight: 800, color: 'white',
            lineHeight: '10px',
            zIndex: 5,
          }}
        >
          {count > 9 ? '9+' : count}
        </span>
      )}
    </>
  )
}

// ─── Large interactive calendar ───────────────────────────────────────────────

function MonthCalendarLarge({
  month,
  calData,
  onDayDoubleClick,
}: {
  month: number
  calData: Record<string, unknown>
  onDayDoubleClick?: (key: string, month: number, day: number) => void
}) {
  const { progressColor: _rawColor, isDark, updateDay, setToast, reminders, calData: appCalData, calendarClean } = useApp()
  const progressColor = resolveProgressColor(_rawColor, isDark)
  const gapColor = isDark ? '#1a1a28' : '#ffffff'
  const reminderDates = useUpcomingReminderDates(reminders, appCalData)

  const clickRef = useRef<{ key: string | null; count: number; timer: ReturnType<typeof setTimeout> | null }>(
    { key: null, count: 0, timer: null }
  )

  const handleCellClick = useCallback((key: string, day: number, wasStreak: boolean) => {
    if (clickRef.current.key !== key) {
      if (clickRef.current.timer) clearTimeout(clickRef.current.timer)
      clickRef.current = { key, count: 0, timer: null }
    }
    clickRef.current.count++
    if (clickRef.current.count === 1) {
      clickRef.current.timer = setTimeout(() => {
        clickRef.current = { key: null, count: 0, timer: null }
        updateDay(key, prev => ({
          ...prev,
          productive: !prev.productive,
          hyper: prev.productive ? false : prev.hyper,
        }))
        if (!wasStreak) setToast('Day Complete ✅  Great work. See you tomorrow.')
      }, 260)
    } else if (clickRef.current.count === 2) {
      if (clickRef.current.timer) clearTimeout(clickRef.current.timer)
      clickRef.current = { key: null, count: 0, timer: null }
      onDayDoubleClick?.(key, month, day)
    }
  }, [updateDay, setToast, onDayDoubleClick, month])

  const { cells, totalDays } = useMemo(() => {
    const fd = new Date(APP_YEAR, month, 1).getDay()
    const td = new Date(APP_YEAR, month + 1, 0).getDate()
    const prevTd = new Date(APP_YEAR, month, 0).getDate()
    const result: { day: number; key: string; isGhost: boolean; dow: number }[] = []
    for (let i = fd - 1; i >= 0; i--) {
      result.push({ day: prevTd - i, key: `g-p-${month}-${i}`, isGhost: true, dow: fd - 1 - i })
    }
    for (let d = 1; d <= td; d++) {
      result.push({ day: d, key: dateKey(APP_YEAR, month, d), isGhost: false, dow: (fd + d - 1) % 7 })
    }
    // Always pad to 42 cells (6 rows)
    let nd = 1
    while (result.length < 42) {
      result.push({ day: nd++, key: `g-n-${month}-${nd}`, isGhost: true, dow: result.length % 7 })
    }
    return { cells: result, totalDays: td }
  }, [month])

  const cd = calData as Record<string, { productive?: boolean; hyper?: boolean; milestone?: boolean; goal?: boolean }>
  const connGlow = isDark ? `0 0 7px 2px ${hexToRgba(progressColor, 0.28)}` : undefined

  return (
    <div className="w-full">
      {/* Day-of-week headers — segmented translucent capsule */}
      <div className="grid grid-cols-7 mb-3" style={{ borderRadius: 10, overflow: 'hidden', background: isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)', border: isDark ? '0.5px solid rgba(255,255,255,0.09)' : '0.5px solid rgba(0,0,0,0.08)' }}>
        {DAY_HEADERS.map((d, i) => (
          <div key={d} className="text-center py-2 xp-mfp-cal-dh" style={{ fontSize: 11, fontWeight: 600, color: i === 0 ? '#f97316' : 'var(--xp-txt3)', letterSpacing: '0.02em', position: 'relative' }}>
            {d}
            {i < 6 && (
              <div style={{ position: 'absolute', right: 0, top: '22%', bottom: '22%', width: '0.5px', background: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.09)', pointerEvents: 'none' }} />
            )}
          </div>
        ))}
      </div>

      {/* Calendar cells */}
      <div className="grid grid-cols-7 gap-x-2 gap-y-1 xp-mfp-cal-grid">
        {cells.map((cell, idx) => {
          if (cell.isGhost) return (
            <div key={idx} className="aspect-square flex items-center justify-center" style={{ fontSize: 11, color: isDark ? 'rgba(255,255,255,0.22)' : '#b0bac6' }}>
              {cell.day}
            </div>
          )

          const data = cd[cell.key]
          const rawProd  = !!data?.productive
          const rawHyper = !!data?.hyper
          const rawMil   = !!data?.milestone
          const rawGoal  = !!data?.goal
          const rawStreak = rawProd || rawHyper || rawMil || rawGoal

          // Connectors hidden in clean mode; raw streak for click toast
          const visStreak = !calendarClean && rawStreak
          const streak    = rawStreak

          const todayCell     = isToday(APP_YEAR, month, cell.day)
          const reminderCount = reminderDates.get(cell.key) ?? 0

          const prevKey = cell.day > 1 ? dateKey(APP_YEAR, month, cell.day - 1) : null
          const nextKey = cell.day < totalDays ? dateKey(APP_YEAR, month, cell.day + 1) : null
          const connL = visStreak && cell.dow !== 0 && !!prevKey && (() => { const d = cd[prevKey]; return !!(d?.productive || d?.hyper || d?.milestone || d?.goal) })()
          const connR = visStreak && cell.dow !== 6 && !!nextKey && (() => { const d = cd[nextKey]; return !!(d?.productive || d?.hyper || d?.milestone || d?.goal) })()

          const connEdge = (rawHyper || rawMil || rawGoal) && !calendarClean ? '50%' : '70%'
          const connLeft = connL && (
            <div style={{ position: 'absolute', left: 0, right: connEdge, top: '50%', height: 2.5, background: progressColor, boxShadow: connGlow, transform: 'translateY(-50%)', zIndex: 0, pointerEvents: 'none' }} />
          )
          const connRight = connR && (
            <div style={{ position: 'absolute', left: connEdge, right: -8, top: '50%', height: 2.5, background: progressColor, boxShadow: connGlow, transform: 'translateY(-50%)', zIndex: 0, pointerEvents: 'none' }} />
          )

          return (
            <div key={cell.key} className="aspect-square relative cursor-pointer select-none group" onClick={() => handleCellClick(cell.key, cell.day, streak)}>
              {connLeft}{connRight}
              <ReminderRing count={reminderCount} />

              {/* 🔥 Hyper — kept in DOM, fades via xp-cal-fade + opacity */}
              {rawHyper && (
                <div className="absolute inset-[25%] xp-cal-fade" style={{ zIndex: 2, opacity: calendarClean ? 0 : 1, pointerEvents: 'none', overflow: 'visible' }}>
                  <div className="absolute inset-0 flex items-center justify-center transition-transform duration-[160ms] group-hover:scale-110" style={{ zIndex: 1 }}>
                    <span style={{ position: 'relative', display: 'inline-block', lineHeight: 1 }}>
                      <span className="xp-fire-emoji" style={{ fontSize: 40, lineHeight: 1, userSelect: 'none', display: 'block', transform: 'translateY(-4px)' }}>🔥</span>
                      <span className="xp-fire-date" style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', fontSize: 12, fontWeight: 900, color: '#0a0a0a', textShadow: '0 0 6px rgba(255,255,255,1)', zIndex: 3, pointerEvents: 'none' }}>{cell.day}</span>
                    </span>
                  </div>
                </div>
              )}

              {/* 🏆 Milestone — kept in DOM, fades */}
              {!rawHyper && rawMil && (
                <div className="absolute inset-[25%] xp-cal-fade" style={{ zIndex: 2, opacity: calendarClean ? 0 : 1, pointerEvents: 'none', overflow: 'visible' }}>
                  <div className="absolute inset-0 flex items-center justify-center transition-transform duration-[160ms] group-hover:scale-110" style={{ zIndex: 1 }}>
                    <span style={{ position: 'relative', display: 'inline-block', lineHeight: 1 }}>
                      <span style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', fontSize: 30, color: 'rgba(167,139,250,0.20)', filter: 'drop-shadow(0 0 6px rgba(167,139,250,0.55))', lineHeight: 1, userSelect: 'none', zIndex: 0, pointerEvents: 'none' }}>★</span>
                      <span style={{ fontSize: 36, lineHeight: 1, userSelect: 'none', display: 'block', position: 'relative', zIndex: 1 }}>🏆</span>
                      <span style={{ position: 'absolute', top: '26%', left: '50%', transform: 'translate(-50%,-50%)', fontSize: 12, fontWeight: 900, color: '#0a0a0a', textShadow: '0 0 6px rgba(255,255,255,1)', zIndex: 3, pointerEvents: 'none' }}>{cell.day}</span>
                    </span>
                  </div>
                </div>
              )}

              {/* 🎯 Goal — kept in DOM, fades */}
              {!rawHyper && !rawMil && rawGoal && (
                <div className="absolute inset-[25%] xp-cal-fade" style={{ zIndex: 2, opacity: calendarClean ? 0 : 1, pointerEvents: 'none', overflow: 'visible' }}>
                  <div className="absolute inset-0 flex items-center justify-center transition-transform duration-[160ms] group-hover:scale-110" style={{ zIndex: 1 }}>
                    <span style={{ position: 'relative', display: 'inline-block', lineHeight: 1 }}>
                      <span className="xp-goal-emoji" style={{ fontSize: 42, lineHeight: 1, userSelect: 'none', display: 'block', position: 'relative', zIndex: 1 }}>🎯</span>
                      <span className="xp-goal-date" style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', fontSize: 12, fontWeight: 900, color: '#0a0a0a', textShadow: '0 0 6px rgba(255,255,255,1)', zIndex: 3, pointerEvents: 'none' }}>{cell.day}</span>
                    </span>
                  </div>
                </div>
              )}

              {/* Purple productive circle — kept in DOM, fades in clean mode */}
              {rawProd && !rawHyper && !rawMil && !rawGoal && (
                <div className="absolute inset-[25%] rounded-full flex items-center justify-center group-hover:scale-105 transition-transform duration-150 xp-cal-fade xp-cal-circle" style={{
                  zIndex: 2, pointerEvents: 'none',
                  background: progressColor,
                  color: progressColor === '#ffffff' ? '#000000' : 'white',
                  fontWeight: 700, fontSize: 14,
                  boxShadow: `0 0 0 2.5px ${gapColor}, 0 0 0 5.5px ${hexToRgba(progressColor, 0.7)}`,
                  opacity: calendarClean ? 0 : 1,
                }}>
                  {cell.day}
                </div>
              )}

              {/* Base circle — always shows when clean mode is on (so toggling emojis never hides dates);
                   in normal mode only shows when no emoji state is active (preserves status priority). */}
              {(calendarClean || !(rawHyper || rawMil || rawGoal)) && (
                <div className="absolute inset-[25%] rounded-full flex items-center justify-center transition-all duration-150 group-hover:scale-105 xp-cal-circle" style={{
                  zIndex: 1,
                  color: todayCell ? 'var(--xp-acc)' : cell.dow === 0 ? '#f97316' : isDark ? 'rgba(255,255,255,0.70)' : '#374151',
                  fontSize: 14,
                  ...(todayCell ? { background: 'rgba(124,58,237,0.08)', outline: '2px solid var(--xp-acc)', outlineOffset: '-1px' } : {}),
                }}>
                  {cell.day}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Weekly progress bars ─────────────────────────────────────────────────────

function MonthWeeklyBars({ month, sessions }: { month: number; sessions: { dateKey: string; startTs: number; endTs: number | null }[] }) {
  const weeks = useMemo(() => {
    const td = new Date(APP_YEAR, month + 1, 0).getDate()
    const result: { label: string; ms: number }[] = []
    let wk = 1
    for (let start = 1; start <= td; start += 7) {
      const end = Math.min(start + 6, td)
      const keys = new Set<string>()
      for (let d = start; d <= end; d++) keys.add(dateKey(APP_YEAR, month, d))
      const ms = sessions.filter(s => s.endTs !== null && keys.has(s.dateKey)).reduce((sum, s) => sum + (s.endTs! - s.startTs), 0)
      result.push({ label: `Wk ${wk++}`, ms })
    }
    return result
  }, [month, sessions])

  const maxMs = Math.max(...weeks.map(w => w.ms), 1)
  const COLORS = ['#6366f1', '#7c3aed', '#ef4444', '#f97316', '#eab308']

  return (
    <div className="flex items-end gap-3 h-28">
      {weeks.map((w, i) => {
        const pct = (w.ms / maxMs) * 100
        const hrs = w.ms / 3_600_000
        return (
          <div key={w.label} className="flex flex-col items-center flex-1 gap-1">
            {w.ms > 0 && (
              <span className="text-[9px] font-bold" style={{ color: COLORS[i % COLORS.length] }}>
                {hrs >= 1 ? `${hrs.toFixed(1)}h` : `${Math.round(w.ms / 60_000)}m`}
              </span>
            )}
            <div className="w-full flex-1 flex items-end">
              <div className="w-full rounded-t-md" style={{ height: `${Math.max(pct, w.ms > 0 ? 4 : 0)}%`, background: COLORS[i % COLORS.length], opacity: w.ms > 0 ? 1 : 0.12, minHeight: w.ms > 0 ? 4 : 0 }} />
            </div>
            <span className="text-[9px]" style={{ color: 'var(--xp-txt3)' }}>{w.label}</span>
          </div>
        )
      })}
    </div>
  )
}

// ─── Activity donut chart ─────────────────────────────────────────────────────

type ActivityRow = { name: string; color: string; ms: number }

function ActivityPieChart({ breakdown, totalMs }: { breakdown: ActivityRow[]; totalMs: number }) {
  const [hovered, setHovered] = useState<number | null>(null)
  const { isDark } = useApp()
  const surface = isDark ? '#16162a' : '#ffffff'

  if (breakdown.length === 0 || totalMs === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-10 rounded-xl" style={{ background: 'var(--xp-bg3)', border: '0.5px solid var(--xp-bdr)' }}>
        <p className="text-2xl mb-2">⏱</p>
        <p className="text-xs" style={{ color: 'var(--xp-txt3)' }}>No tracked time this month</p>
      </div>
    )
  }

  const cx = 110, cy = 110, ro = 85, ri = 44
  const toRad = (d: number) => d * Math.PI / 180

  type Slice = ActivityRow & { pct: number; start: number; end: number }
  const slices: Slice[] = []
  let cursor = -90
  for (const a of breakdown) {
    const pct = a.ms / totalMs
    const sweep = pct * 360
    slices.push({ ...a, pct, start: cursor, end: cursor + sweep })
    cursor += sweep
  }

  function arcPath(s: Slice): string {
    if (s.pct >= 0.9999) {
      return `M ${(cx - ro).toFixed(1)} ${cy} A ${ro} ${ro} 0 1 1 ${(cx + ro).toFixed(1)} ${cy} A ${ro} ${ro} 0 1 1 ${(cx - ro).toFixed(1)} ${cy} Z`
    }
    const x1 = cx + ro * Math.cos(toRad(s.start))
    const y1 = cy + ro * Math.sin(toRad(s.start))
    const x2 = cx + ro * Math.cos(toRad(s.end))
    const y2 = cy + ro * Math.sin(toRad(s.end))
    const large = (s.end - s.start) > 180 ? 1 : 0
    return `M ${cx} ${cy} L ${x1.toFixed(2)} ${y1.toFixed(2)} A ${ro} ${ro} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z`
  }

  const h = hovered !== null ? slices[hovered] : null

  return (
    <svg viewBox="0 0 220 220" className="w-full max-w-[220px] mx-auto">
      {slices.map((s, i) => (
        <path
          key={i} d={arcPath(s)} fill={s.color} stroke={surface} strokeWidth={2.5}
          opacity={hovered === null || hovered === i ? 1 : 0.4}
          style={{ cursor: 'pointer', transition: 'opacity 140ms ease' }}
          onMouseEnter={() => setHovered(i)} onMouseLeave={() => setHovered(null)}
        />
      ))}
      <circle cx={cx} cy={cy} r={ri} fill={surface} />
      {h ? (
        <>
          <text x={cx} y={cy - 14} textAnchor="middle" fontSize="8.5" fontWeight="700" fill={h.color}>{h.name.length > 11 ? h.name.slice(0, 10) + '…' : h.name}</text>
          <text x={cx} y={cy + 4}  textAnchor="middle" fontSize="17"  fontWeight="900" fill={h.color}>{Math.round(h.pct * 100)}%</text>
          <text x={cx} y={cy + 19} textAnchor="middle" fontSize="8" fill="var(--xp-txt3)">{formatMs(h.ms)}</text>
        </>
      ) : (
        <>
          <text x={cx} y={cy + 5}  textAnchor="middle" fontSize="20" fontWeight="900" fill="var(--xp-txt)">{breakdown.length}</text>
          <text x={cx} y={cy + 18} textAnchor="middle" fontSize="8" fill="var(--xp-txt3)">activities</text>
        </>
      )}
    </svg>
  )
}

// ─── Stat tile + section divider ──────────────────────────────────────────────

function StatTile({ emoji, label, value, accent }: { emoji: string; label: string; value: string; accent?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 py-4 px-2 rounded-2xl" style={{ background: 'var(--xp-bg3)', border: '0.5px solid var(--xp-bdr)' }}>
      <span className="text-base leading-none">{emoji}</span>
      <span className="text-xl font-bold leading-none" style={{ color: accent ?? 'var(--xp-acc)' }}>{value}</span>
      <span className="text-[9px] font-semibold uppercase tracking-wide text-center leading-tight" style={{ color: 'var(--xp-txt3)' }}>{label}</span>
    </div>
  )
}

function SectionDivider({ title }: { title: string }) {
  return (
    <div className="flex items-center gap-2 mb-4">
      <span className="text-[9px] font-bold uppercase tracking-widest whitespace-nowrap" style={{ color: 'var(--xp-txt3)' }}>{title}</span>
      <div className="flex-1 h-px" style={{ background: 'var(--xp-bdr)' }} />
    </div>
  )
}

// ─── Cumulative focus progress chart ─────────────────────────────────────────

function MonthCumulativeChart({ month, sessions, isDark }: {
  month: number
  sessions: { dateKey: string; startTs: number; endTs: number | null }[]
  isDark: boolean
}) {
  const { points, totalDays, maxMs } = useMemo(() => {
    const td = new Date(APP_YEAR, month + 1, 0).getDate()
    const byDay = new Map<string, number>()
    for (const s of sessions) {
      if (s.endTs !== null) {
        byDay.set(s.dateKey, (byDay.get(s.dateKey) ?? 0) + (s.endTs - s.startTs))
      }
    }
    let cum = 0
    const pts: number[] = []
    for (let d = 1; d <= td; d++) {
      cum += byDay.get(dateKey(APP_YEAR, month, d)) ?? 0
      pts.push(cum)
    }
    return { points: pts, totalDays: td, maxMs: cum }
  }, [month, sessions])

  if (maxMs === 0) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 160, flexDirection: 'column', gap: 8 }}>
        <span style={{ fontSize: 22 }}>📈</span>
        <p style={{ fontSize: 10, color: isDark ? 'rgba(148,163,184,0.50)' : 'var(--xp-txt3)' }}>No focus sessions this month</p>
      </div>
    )
  }

  const W = 480, H = 160
  const PAD = { top: 18, right: 16, bottom: 30, left: 44 }
  const cW = W - PAD.left - PAD.right
  const cH = H - PAD.top - PAD.bottom
  const xPos = (i: number) => PAD.left + (totalDays > 1 ? i / (totalDays - 1) : 0.5) * cW
  const yPos = (ms: number) => PAD.top + cH - (ms / maxMs) * cH
  const linePath = points.map((ms, i) => `${i === 0 ? 'M' : 'L'} ${xPos(i).toFixed(1)} ${yPos(ms).toFixed(1)}`).join(' ')
  const areaPath = `${linePath} L ${xPos(totalDays - 1).toFixed(1)} ${(PAD.top + cH).toFixed(1)} L ${xPos(0).toFixed(1)} ${(PAD.top + cH).toFixed(1)} Z`
  const maxHours = maxMs / 3_600_000
  const rawStep = maxHours <= 10 ? 2 : maxHours <= 30 ? 5 : maxHours <= 60 ? 10 : maxHours <= 120 ? 20 : 30
  const yLines: number[] = []
  for (let h = rawStep; h < maxHours * 1.2; h += rawStep) { if (yLines.length >= 5) break; yLines.push(h) }
  const xLabels = [1, 5, 10, 15, 20, 25, totalDays].filter((d, i, arr) => arr.indexOf(d) === i && d <= totalDays)
  const lineCol = '#a78bfa'
  const gridCol = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'
  const txtCol  = isDark ? 'rgba(148,163,184,0.55)' : 'rgba(100,116,139,0.70)'
  const now = new Date()
  const todayIdx = (now.getMonth() === month && now.getFullYear() === APP_YEAR) ? Math.min(now.getDate() - 1, totalDays - 1) : null

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
      <defs>
        <linearGradient id="mfpCumGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor={lineCol} stopOpacity={isDark ? 0.30 : 0.18} />
          <stop offset="100%" stopColor={lineCol} stopOpacity={0.01} />
        </linearGradient>
        <clipPath id="mfpCumClip">
          <rect x={PAD.left} y={PAD.top - 2} width={cW} height={cH + 4} />
        </clipPath>
      </defs>
      {yLines.map(h => {
        const y = yPos(h * 3_600_000)
        if (y < PAD.top) return null
        return (
          <g key={h}>
            <line x1={PAD.left} x2={PAD.left + cW} y1={y.toFixed(1)} y2={y.toFixed(1)} stroke={gridCol} strokeWidth={1} />
            <text x={PAD.left - 5} y={y + 3.5} textAnchor="end" fontSize={8} fill={txtCol}>{h}h</text>
          </g>
        )
      })}
      <path d={areaPath} fill="url(#mfpCumGrad)" clipPath="url(#mfpCumClip)" />
      <path d={linePath} fill="none" stroke={lineCol} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" clipPath="url(#mfpCumClip)" />
      {todayIdx !== null && (
        <line x1={xPos(todayIdx)} x2={xPos(todayIdx)} y1={PAD.top} y2={PAD.top + cH} stroke="rgba(167,139,250,0.40)" strokeWidth={1.5} strokeDasharray="3 3" />
      )}
      <line x1={PAD.left} x2={PAD.left + cW} y1={PAD.top + cH} y2={PAD.top + cH} stroke={gridCol} strokeWidth={1} />
      {xLabels.map(d => (
        <text key={d} x={xPos(d - 1)} y={PAD.top + cH + 14} textAnchor="middle" fontSize={8} fill={txtCol}>{d}</text>
      ))}
    </svg>
  )
}

// ─── Weekly focus breakdown bar chart ─────────────────────────────────────────

function WeeklyFocusChart({ month, sessions, isDark }: {
  month: number
  sessions: { dateKey: string; startTs: number; endTs: number | null }[]
  isDark: boolean
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const animRafRef   = useRef<number>(0)
  const animDoneRef  = useRef(false)
  const [animProgress, setAnimProgress] = useState(0)

  const weeks = useMemo(() => {
    const td = new Date(APP_YEAR, month + 1, 0).getDate()
    const now = new Date()
    const isCurrentMonth = now.getMonth() === month && now.getFullYear() === APP_YEAR
    const todayDate = now.getDate()
    const result: { label: string; days: string; ms: number; isCurrentWeek: boolean; isFutureWeek: boolean }[] = []
    let wk = 1
    for (let start = 1; start <= td; start += 7) {
      const end = Math.min(start + 6, td)
      const keys = new Set<string>()
      for (let d = start; d <= end; d++) keys.add(dateKey(APP_YEAR, month, d))
      const ms = sessions.filter(s => s.endTs !== null && keys.has(s.dateKey)).reduce((sum, s) => sum + (s.endTs! - s.startTs), 0)
      const isCurrentWeek = isCurrentMonth && todayDate >= start && todayDate <= end
      const isFutureWeek  = isCurrentMonth && todayDate < start
      result.push({ label: `Week ${wk++}`, days: start === end ? `${start}` : `${start}–${end}`, ms, isCurrentWeek, isFutureWeek })
    }
    return result
  }, [month, sessions])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const obs = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting || animDoneRef.current) return
      animDoneRef.current = true
      obs.disconnect()
      const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      if (prefersReduced) { setAnimProgress(1); return }
      const DURATION = 700
      const start = performance.now()
      function tick(now: number) {
        const t = Math.min((now - start) / DURATION, 1)
        setAnimProgress(t)
        if (t < 1) animRafRef.current = requestAnimationFrame(tick)
      }
      animRafRef.current = requestAnimationFrame(tick)
    }, { threshold: 0.25 })
    obs.observe(el)
    return () => { obs.disconnect(); cancelAnimationFrame(animRafRef.current) }
  }, [])

  function getBarFrac(i: number): number {
    const STAGGER = 0.09
    const barStart = i * STAGGER
    const t = Math.max(0, Math.min((animProgress - barStart) / (1 - barStart), 1))
    return 1 - Math.pow(1 - t, 3)
  }

  const maxMs = Math.max(...weeks.map(w => w.ms), 1)
  const COLORS = ['#7c3aed', '#6366f1', '#0ea5e9', '#14b8a6', '#f97316']
  const W = 480, H = 180
  const PAD = { top: 28, bottom: 44, left: 10, right: 10 }
  const cW = W - PAD.left - PAD.right
  const cH = H - PAD.top - PAD.bottom
  const slotW = cW / weeks.length
  const barW = Math.min(Math.max(slotW * 0.46, 28), 54)

  return (
    <div ref={containerRef} style={{ flex: 1 }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
        <defs>
          {weeks.map((w, i) => (
            <linearGradient key={i} id={`wfc${month}_${i}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor={COLORS[i % COLORS.length]} stopOpacity={0.92} />
              <stop offset="100%" stopColor={COLORS[i % COLORS.length]} stopOpacity={0.55} />
            </linearGradient>
          ))}
        </defs>

        {/* Baseline */}
        <line x1={PAD.left} x2={W - PAD.right} y1={PAD.top + cH} y2={PAD.top + cH}
          stroke={isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'} strokeWidth={1} />

        {weeks.map((w, i) => {
          const frac   = getBarFrac(i)
          const fullH  = maxMs > 0 ? (w.ms / maxMs) * cH : 0
          const barH   = fullH * frac
          const cx     = PAD.left + i * slotW + slotW / 2
          const x      = cx - barW / 2
          const y      = PAD.top + cH - barH
          const baseY  = PAD.top + cH
          const color  = COLORS[i % COLORS.length]

          return (
            <g key={w.label}>
              {/* Ghost placeholder for future/empty weeks */}
              {(w.isFutureWeek || (w.ms === 0 && !w.isCurrentWeek)) && (
                <rect x={x} y={PAD.top} width={barW} height={cH} rx={5}
                  fill={isDark ? 'rgba(255,255,255,0.025)' : 'rgba(0,0,0,0.025)'}
                  stroke={isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)'} strokeWidth={0.75} strokeDasharray="3 3"
                />
              )}

              {/* Ghost height placeholder for current week with 0 ms */}
              {w.isCurrentWeek && w.ms === 0 && (
                <rect x={x} y={PAD.top} width={barW} height={cH} rx={5}
                  fill={isDark ? 'rgba(124,58,237,0.06)' : 'rgba(124,58,237,0.04)'}
                  stroke={isDark ? 'rgba(124,58,237,0.18)' : 'rgba(124,58,237,0.12)'} strokeWidth={0.75} strokeDasharray="3 3"
                />
              )}

              {/* Main bar */}
              {w.ms > 0 && barH > 0 && (
                <rect x={x} y={y} width={barW} height={Math.max(barH, 3)} rx={5}
                  fill={`url(#wfc${month}_${i})`}
                  style={{ filter: w.isCurrentWeek ? `drop-shadow(0 0 8px ${color}66)` : 'none' }}
                />
              )}

              {/* WIP label — current week */}
              {w.isCurrentWeek && (
                w.ms > 0 && barH > 22
                  ? <text x={cx} y={y + barH / 2 + 4} textAnchor="middle" fontSize={8.5} fontWeight="800"
                      fill="rgba(255,255,255,0.88)" letterSpacing="0.10em">WIP</text>
                  : <text x={cx} y={PAD.top + cH / 2 + 4} textAnchor="middle" fontSize={8.5} fontWeight="800"
                      fill={color} letterSpacing="0.10em" opacity={0.65}>WIP</text>
              )}

              {/* Focus time label above bar */}
              {w.ms > 0 && !w.isFutureWeek && barH > 0 && (
                <text x={cx} y={y - 6} textAnchor="middle" fontSize={8.5} fontWeight="700" fill={color}>
                  {formatMs(w.ms)}
                </text>
              )}

              {/* Week label */}
              <text x={cx} y={baseY + 15} textAnchor="middle" fontSize={9}
                fontWeight={w.isCurrentWeek ? 700 : 500}
                fill={w.isCurrentWeek ? color : isDark ? 'rgba(203,213,225,0.65)' : 'var(--xp-txt2)'}>
                {w.label}
              </text>

              {/* Day range */}
              <text x={cx} y={baseY + 28} textAnchor="middle" fontSize={7.5}
                fill={isDark ? 'rgba(148,163,184,0.40)' : 'rgba(100,116,139,0.55)'}>
                {w.days}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

// ─── MonthFullPage ────────────────────────────────────────────────────────────

interface MonthFullPageProps {
  month: number
  onClose: () => void
  onMonthDashboard?: (month: number) => void
  onDayDoubleClick?: (key: string, month: number, day: number) => void
}

function playTapSound() {
  try {
    const Ctx = (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)
    if (!Ctx) return
    const ctx = new Ctx()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain); gain.connect(ctx.destination)
    osc.frequency.value = 820; osc.type = 'sine'
    gain.gain.setValueAtTime(0.07, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.07)
    osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.07)
    setTimeout(() => { try { ctx.close() } catch {} }, 200)
  } catch {}
}

export function MonthFullPage({ month, onClose, onDayDoubleClick }: MonthFullPageProps) {
  const { calData, sessions, activities, isDark, progressColor: _rawColor2, setToast, calendarClean, setCalendarClean } = useApp()
  const progressColor = resolveProgressColor(_rawColor2, isDark)
  const [view, setView]               = useState<'calendar' | 'dashboard'>('calendar')
  const [currentMonth, setCurrentMonth] = useState(month)
  const [animType, setAnimType]        = useState<'fade' | 'right' | 'left'>('fade')
  const backBtnRef = useRef<HTMLButtonElement>(null)

  // Monthly Achievement fill-bar animation
  const achRef         = useRef<HTMLDivElement>(null)
  const achRafRef      = useRef<number>(0)
  const achAnimDoneRef = useRef(false)
  const [achFrac, setAchFrac] = useState(0)
  useEffect(() => {
    const el = achRef.current
    if (!el) return
    const obs = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting || achAnimDoneRef.current) return
      achAnimDoneRef.current = true
      obs.disconnect()
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setAchFrac(1); return }
      const DURATION = 600
      const start = performance.now()
      function tick(now: number) {
        const t = Math.min((now - start) / DURATION, 1)
        const eased = 1 - Math.pow(1 - t, 3)
        setAchFrac(eased)
        if (t < 1) achRafRef.current = requestAnimationFrame(tick)
      }
      achRafRef.current = requestAnimationFrame(tick)
    }, { threshold: 0.3 })
    obs.observe(el)
    return () => { obs.disconnect(); cancelAnimationFrame(achRafRef.current) }
  }, [])

  // Share panel state
  const [panelOpen, setPanelOpen]         = useState(false)
  const [panelAnim, setPanelAnim]         = useState(false)
  const [sharing, setSharing]             = useState(false)
  const [connectTarget, setConnectTarget] = useState<Platform | null>(null)

  // Modal Escape — closes MonthFullPage
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Lock body scroll while modal is open (prevents background calendar from scrolling through)
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

  // Back button focus fix: when returning from dashboard → calendar, the back button
  // retains focus from the prior tap. Blur it after the view settles.
  useEffect(() => {
    if (view === 'calendar') {
      const t = setTimeout(() => backBtnRef.current?.blur(), 50)
      return () => clearTimeout(t)
    }
  }, [view])

  // Share panel Escape — intercepts before modal listener via capture phase
  useEffect(() => {
    if (!panelOpen) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.stopImmediatePropagation(); closePanel() }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [panelOpen]) // eslint-disable-line react-hooks/exhaustive-deps

  function openPanel() {
    setPanelOpen(true)
    requestAnimationFrame(() => requestAnimationFrame(() => setPanelAnim(true)))
  }
  function closePanel() {
    setPanelAnim(false)
    setTimeout(() => setPanelOpen(false), 380)
  }

  async function executeShare() {
    if (sharing) return
    setSharing(true)
    try {
      const mStats = getMonthStats(calData, APP_YEAR, currentMonth)
      const uri = await generateShareCardDataUri(currentMonth, mStats)
      const monthName = MONTHS[currentMonth]
      const item: GalleryItem = {
        id: 'card-' + Date.now(), type: 'month-share', createdAt: Date.now(),
        title: `${monthName} ${APP_YEAR}`, month: currentMonth, year: APP_YEAR, dataUri: uri,
        stats: {
          productiveDays: mStats.productiveDays, totalDays: mStats.totalDays,
          hyperDays: mStats.hyperDays, milestoneDays: mStats.milestoneDays,
          goalDays: mStats.goalDays, completionRate: mStats.completionRate,
        },
      }
      addGalleryItem(item)
      setToast(`${monthName} share card saved to Gallery ✓`)
      const shareText = `${monthName} ${APP_YEAR}: ${mStats.completionRate}% completion — XPadite`
      if (navigator.share) {
        try {
          const res = await fetch(uri)
          const blob = await res.blob()
          const file = new File([blob], `xpadite-${monthName.toLowerCase()}-${APP_YEAR}.png`, { type: 'image/png' })
          const canFiles = navigator.canShare?.({ files: [file] })
          await navigator.share(
            canFiles
              ? { title: `${monthName} XPadite`, text: shareText, files: [file] }
              : { title: `${monthName} XPadite`, text: shareText }
          )
        } catch {
          const a = document.createElement('a')
          a.href = uri; a.download = `xpadite-${monthName.toLowerCase()}-${APP_YEAR}.png`; a.click()
        }
      } else {
        const a = document.createElement('a')
        a.href = uri; a.download = `xpadite-${monthName.toLowerCase()}-${APP_YEAR}.png`; a.click()
      }
      closePanel()
    } finally { setSharing(false) }
  }

  async function copyImage() {
    if (sharing) return
    setSharing(true)
    try {
      const mStats = getMonthStats(calData, APP_YEAR, currentMonth)
      const uri = await generateShareCardDataUri(currentMonth, mStats)
      const res = await fetch(uri)
      const blob = await res.blob()
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
      setToast('Share card copied to clipboard ✓')
      closePanel()
    } catch {
      setToast('Copy failed — try Download PNG instead.')
    } finally { setSharing(false) }
  }

  function handlePlatformClick(p: Platform) {
    const connections = getConnections()
    if (!connections[p.id]) setConnectTarget(p)
    else void executeShare()
  }
  function handleConnect() {
    if (!connectTarget) return
    markConnected(connectTarget.id)
    setConnectTarget(null)
    void executeShare()
  }

  function goNext() { if (currentMonth < 11) { setAnimType('right'); setCurrentMonth(m => m + 1) } }
  function goPrev() { if (currentMonth > 0)  { setAnimType('left');  setCurrentMonth(m => m - 1) } }
  function toggleView() { setAnimType('fade'); setView(v => v === 'calendar' ? 'dashboard' : 'calendar') }

  // ── Data computations (all keyed to currentMonth) ──────────────────────────

  const stats = useMemo(() => getMonthStats(calData, APP_YEAR, currentMonth), [calData, currentMonth])

  const monthScore = useMemo(() => {
    const now = new Date()
    const isCurrentCalMonth = now.getMonth() === currentMonth && now.getFullYear() === APP_YEAR
    const td = new Date(APP_YEAR, currentMonth + 1, 0).getDate()
    const elapsed = isCurrentCalMonth ? now.getDate() : td
    const rate = elapsed > 0 ? (stats.productiveDays / elapsed) * 100 : 0
    let ms = 0
    for (let d = 1; d <= elapsed; d++) {
      const k = dateKey(APP_YEAR, currentMonth, d)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(calData[k] as any)?.tasks?.forEach((t: any) => {
        ;((t.sessions ?? []) as any[]).filter((s: any) => s.endTs !== null).forEach((s: any) => { ms += s.endTs - s.startTs })
      })
    }
    const hours = ms / 3_600_000
    let score = 0
    if (rate >= 30)  score += 20; if (rate >= 50)  score += 20
    if (rate >= 70)  score += 15; if (rate >= 90)  score += 15
    if (hours >= 5)  score += 10; if (hours >= 15) score += 5
    if (stats.hyperDays >= 1)     score += 8
    if (stats.milestoneDays >= 1) score += 5
    if (stats.goalDays >= 1)      score += 2
    return Math.min(100, score)
  }, [stats, currentMonth, calData])

  const monthKeys = useMemo(() => {
    const s = new Set<string>()
    const td = new Date(APP_YEAR, currentMonth + 1, 0).getDate()
    for (let d = 1; d <= td; d++) s.add(dateKey(APP_YEAR, currentMonth, d))
    return s
  }, [currentMonth])

  const monthSessions = useMemo(
    () => sessions.filter(s => monthKeys.has(s.dateKey)),
    [sessions, monthKeys]
  )

  const totalMs = useMemo(
    () => monthSessions.filter(s => s.endTs !== null).reduce((sum, s) => sum + (s.endTs! - s.startTs), 0),
    [monthSessions]
  )

  const actBreakdown = useMemo((): ActivityRow[] => {
    const actMs = new Map<string, number>()
    for (const key of monthKeys) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const day = calData[key] as any
      if (!day) continue
      ;(day.tasks ?? []).forEach((t: any) => {
        ;((t.sessions ?? []) as any[]).filter((s: any) => s.endTs !== null).forEach((s: any) => {
          if (t.actId) actMs.set(t.actId, (actMs.get(t.actId) ?? 0) + (s.endTs - s.startTs))
        })
      })
    }
    return Array.from(actMs.entries()).map(([actId, ms]) => {
      const act = activities.find(a => a.id === actId)
      return { name: act?.name ?? 'Other', color: act?.color ?? '#94a3b8', ms }
    }).sort((a, b) => b.ms - a.ms).slice(0, 7)
  }, [calData, monthKeys, activities])

  const { currentStreak, longestStreak } = useMemo(() => {
    const td = new Date(APP_YEAR, currentMonth + 1, 0).getDate()
    type D = { productive?: boolean; hyper?: boolean; milestone?: boolean; goal?: boolean }
    const isProd = (k: string) => { const d = calData[k] as D | undefined; return !!(d?.productive || d?.hyper || d?.milestone || d?.goal) }
    let longest = 0, run = 0
    for (let d = 1; d <= td; d++) { if (isProd(dateKey(APP_YEAR, currentMonth, d))) { run++; if (run > longest) longest = run } else run = 0 }
    const now = new Date()
    const last = currentMonth === now.getMonth() && APP_YEAR === now.getFullYear() ? Math.min(now.getDate(), td) : td
    let current = 0
    for (let d = last; d >= 1; d--) { if (isProd(dateKey(APP_YEAR, currentMonth, d))) current++; else break }
    return { currentStreak: current, longestStreak: longest }
  }, [calData, currentMonth])

  const monthTaskStats = useMemo(() => {
    let totalTasks = 0, completedTasks = 0
    for (const key of monthKeys) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const day = calData[key] as any
      if (!day) continue
      const tasks = day.tasks ?? []
      totalTasks += tasks.length
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      completedTasks += tasks.filter((t: any) => t.done).length
    }
    return { totalTasks, completedTasks }
  }, [calData, monthKeys])

  const monthTopSessions = useMemo(() => {
    const result: { actName: string; actColor: string; durationMs: number }[] = []
    for (const key of monthKeys) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const day = calData[key] as any
      if (!day) continue
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const task of (day.tasks ?? [])) {
        const act = activities.find(a => a.id === task.actId)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for (const s of (task.sessions ?? [])) {
          if (s.endTs !== null) {
            result.push({ actName: act?.name ?? 'Other', actColor: act?.color ?? '#94a3b8', durationMs: s.endTs - s.startTs })
          }
        }
      }
    }
    return result.sort((a, b) => b.durationMs - a.durationMs).slice(0, 10)
  }, [calData, monthKeys, activities])

  const stopProp = useCallback((e: React.MouseEvent) => e.stopPropagation(), [])
  const animName = animType === 'right' ? 'xp-from-right' : animType === 'left' ? 'xp-from-left' : 'xp-mfp-in'

  const S1  = isDark ? 'rgba(15,8,36,0.99)'  : '#ffffff'
  const S2  = isDark ? 'rgba(20,11,46,0.98)' : 'var(--xp-card)'
  const BDR = isDark ? 'rgba(124,58,237,0.22)' : 'rgba(0,0,0,0.09)'
  const card1: React.CSSProperties = { background: S1, border: `0.5px solid ${BDR}`, boxShadow: isDark ? '0 2px 20px rgba(0,0,0,0.42)' : '0 1px 10px rgba(0,0,0,0.07)' }
  const card2: React.CSSProperties = { background: S2, border: `0.5px solid ${BDR}`, boxShadow: isDark ? '0 2px 18px rgba(0,0,0,0.38)' : '0 1px 6px rgba(0,0,0,0.05)' }

  const mKpis = [
    { label: 'Productive Days', value: `${stats.productiveDays}/${stats.totalDays}`, sub: stats.totalDays > 0 ? `${Math.round((stats.productiveDays / stats.totalDays) * 100)}% rate` : null, icon: '✅', bg: isDark ? 'linear-gradient(135deg, #047857 0%, #15803D 52%, #4D7C0F 100%)' : 'linear-gradient(135deg, #059669 0%, #22C55E 52%, #84CC16 100%)', border: isDark ? 'rgba(21,128,61,0.46)' : 'rgba(34,197,94,0.44)', glowRgb: '34,197,94' },
    { label: 'Total Focus', value: formatMs(totalMs), sub: null, icon: '⏱', bg: isDark ? 'linear-gradient(135deg, #5B21B6 0%, #7E22CE 50%, #A21CAF 100%)' : 'linear-gradient(135deg, #7C3AED 0%, #A855F7 50%, #D946EF 100%)', border: isDark ? 'rgba(162,28,175,0.46)' : 'rgba(126,34,206,0.45)', glowRgb: '167,139,250' },
    { label: 'Hyper Days', value: String(stats.hyperDays), sub: stats.hyperDays > 0 ? '🔥 On fire' : null, icon: '🔥', bg: isDark ? 'linear-gradient(135deg, #92400E 0%, #B45309 50%, #D97706 100%)' : 'linear-gradient(135deg, #F59E0B 0%, #F97316 50%, #EF4444 100%)', border: isDark ? 'rgba(217,119,6,0.46)' : 'rgba(249,115,22,0.46)', glowRgb: '249,115,22' },
    { label: 'Tasks Done', value: `${monthTaskStats.completedTasks}/${monthTaskStats.totalTasks}`, sub: monthTaskStats.totalTasks > 0 ? `${Math.round((monthTaskStats.completedTasks / monthTaskStats.totalTasks) * 100)}% complete` : null, icon: '✓', bg: isDark ? 'linear-gradient(135deg, #1D4ED8 0%, #0369A1 52%, #0891B2 100%)' : 'linear-gradient(135deg, #2563EB 0%, #0EA5E9 52%, #22D3EE 100%)', border: isDark ? 'rgba(8,145,178,0.46)' : 'rgba(14,165,233,0.45)', glowRgb: '14,165,233' },
    { label: 'Avg Focus/Day', value: stats.productiveDays > 0 ? formatMs(Math.round(totalMs / stats.productiveDays)) : '—', sub: null, icon: '📈', bg: isDark ? 'linear-gradient(135deg, #0E7490 0%, #0F766E 54%, #0D9488 100%)' : 'linear-gradient(135deg, #06B6D4 0%, #14B8A6 54%, #2DD4BF 100%)', border: isDark ? 'rgba(13,148,136,0.46)' : 'rgba(20,184,166,0.44)', glowRgb: '20,184,166' },
    { label: 'Best Streak', value: `${longestStreak}d`, sub: currentStreak > 0 ? `${currentStreak}d current` : null, icon: '🔗', bg: isDark ? 'linear-gradient(135deg, #9D174D 0%, #BE185D 48%, #86198F 100%)' : 'linear-gradient(135deg, #DB2777 0%, #EC4899 48%, #C026D3 100%)', border: isDark ? 'rgba(190,24,93,0.46)' : 'rgba(219,39,119,0.46)', glowRgb: '219,39,119' },
  ]

  const navBtnStyle: React.CSSProperties = {
    width: 34, height: 34, borderRadius: '50%',
    display: 'grid', placeItems: 'center',
    fontSize: 22, fontWeight: 400, lineHeight: 1, cursor: 'pointer',
    background: 'rgba(255,255,255,0.13)', color: 'white',
    border: '1px solid rgba(255,255,255,0.28)',
    boxShadow: '0 1px 5px rgba(0,0,0,0.22), inset 0 1px 0 rgba(255,255,255,0.14)',
    transition: 'all 180ms ease', flexShrink: 0,
  }

  const badgeTier = (() => {
    if (monthScore >= 90) return { rank: 'Master',     icon: '👑', color: '#fbbf24', bg: 'linear-gradient(135deg,#92400e,#b45309,#d97706)', border: 'rgba(251,191,36,0.45)', msg: 'Extraordinary commitment.' }
    if (monthScore >= 75) return { rank: 'Elite',      icon: '🏆', color: '#c4b5fd', bg: 'linear-gradient(135deg,#3b0764,#6d28d9,#7c3aed)', border: 'rgba(167,139,250,0.50)', msg: 'Outstanding performance.' }
    if (monthScore >= 60) return { rank: 'Advanced',   icon: '🚀', color: '#7dd3fc', bg: 'linear-gradient(135deg,#0c4a6e,#0369a1,#0284c7)', border: 'rgba(56,189,248,0.45)',  msg: 'Impressive discipline.' }
    if (monthScore >= 45) return { rank: 'Consistent', icon: '⚡', color: '#6ee7b7', bg: 'linear-gradient(135deg,#064e3b,#047857,#059669)', border: 'rgba(52,211,153,0.45)',  msg: 'Great momentum.' }
    if (monthScore >= 25) return { rank: 'Learning',   icon: '📈', color: '#93c5fd', bg: 'linear-gradient(135deg,#1e3a8a,#1d4ed8,#2563eb)', border: 'rgba(96,165,250,0.45)',  msg: 'Keep pushing forward.' }
    return                        { rank: 'Beginner',  icon: '🌱', color: '#86efac', bg: 'linear-gradient(135deg,#14532d,#166534,#15803d)', border: 'rgba(134,239,172,0.45)', msg: 'Every journey starts here.' }
  })()

  return (
    <>
      <style>{MFP_STYLES}</style>
      <div
        className="fixed inset-0 z-50 overflow-y-auto xp-mfp-overlay"
        style={{ background: isDark ? 'rgba(0,0,0,0.82)' : 'rgba(15,23,42,0.60)' }}
      >
        <div className="min-h-full flex items-center justify-center py-8 px-4 xp-mfp-wrap">
          <div
            className="w-full rounded-2xl xp-mfp-box"
            style={{
              maxWidth: 'min(86vw, 1280px)', background: 'var(--xp-card)',
              border: '0.5px solid rgba(124,58,237,0.30)', overflow: 'hidden',
              maxHeight: '92vh', display: 'flex', flexDirection: 'column',
              boxShadow: `0 24px 64px rgba(0,0,0,0.52), 0 0 80px 20px ${hexToRgba(progressColor, 0.10)}`,
            }}
            onClick={stopProp}
          >
            {/* ── Premium 3-column header ────────────────────────────────────── */}
            <div
              className="xp-mfp-hdr"
              style={{
                display: 'grid', gridTemplateColumns: '1fr auto 1fr',
                gap: 16, padding: '14px 20px',
                flexShrink: 0, zIndex: 10,
                background: 'linear-gradient(135deg, #3b0764 0%, #7c3aed 50%, #6d28d9 100%)',
                borderBottom: '0.5px solid rgba(167,139,250,0.28)',
                boxShadow: '0 4px 20px rgba(0,0,0,0.30)',
                alignItems: 'center',
              }}
            >
              {/* Left: Back */}
              <div className="xp-mfp-hdr-l">
                <button
                  ref={backBtnRef}
                  onPointerUp={() => setTimeout(() => backBtnRef.current?.blur(), 0)}
                  onClick={view === 'dashboard' ? () => { setAnimType('fade'); setView('calendar') } : onClose}
                  className="xp-mfp-back"
                ><span className="xp-back-arrow">←</span><span className="xp-back-txt"> Back</span></button>
              </div>

              {/* Center: ‹ Month Year [· Monthly Dashboard] › */}
              <div className={`xp-mfp-hdr-c${view === 'dashboard' ? ' xp-mfp-hdr-c-dash' : ''}`} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <button
                  onClick={goPrev}
                  disabled={currentMonth === 0}
                  className="xp-mfp-nav"
                  style={navBtnStyle}
                  title="Previous month"
                ><span style={{ display: 'block', lineHeight: 1, transform: 'translateY(0)' }}>‹</span></button>
                <h1 className="xp-mfp-hdr-title" style={{ fontSize: 13, fontWeight: 700, color: 'white', textAlign: 'center', whiteSpace: 'nowrap', textShadow: '0 1px 4px rgba(0,0,0,0.30)', margin: 0 }}>
                  {view === 'dashboard' ? (
                    <>
                      <span className="xp-mfp-dash-main-title">{`${MONTHS[currentMonth]} ${APP_YEAR} · Monthly Dashboard`}</span>
                      <span className="xp-mfp-dash-mobile-title">Monthly Dashboard</span>
                      <span className="xp-mfp-dash-mobile-sub">{MONTHS[currentMonth]} {APP_YEAR}</span>
                    </>
                  ) : `${MONTHS[currentMonth]} ${APP_YEAR}`}
                </h1>
                <button
                  onClick={goNext}
                  disabled={currentMonth === 11}
                  className="xp-mfp-nav"
                  style={navBtnStyle}
                  title="Next month"
                ><span style={{ display: 'block', lineHeight: 1, transform: 'translateY(0)' }}>›</span></button>
              </div>

              {/* Right: Calendar toggle + Dashboard pill */}
              <div className="xp-mfp-hdr-r" style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 16 }}>
                {/* Calendar view toggle — switch only, no label */}
                {view === 'calendar' && (
                  <button
                    onClick={() => setCalendarClean(!calendarClean)}
                    aria-label={calendarClean ? 'Switch to Normal Calendar' : 'Switch to Clean Calendar'}
                    style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', flexShrink: 0 }}
                  >
                    <div style={{ position: 'relative', width: 42, height: 20, borderRadius: 10, background: calendarClean ? 'rgba(255,255,255,0.22)' : '#7c3aed', border: '0.5px solid rgba(255,255,255,0.25)', flexShrink: 0, transition: 'background 280ms ease', boxShadow: '0 1px 5px rgba(0,0,0,0.25)' }}>
                      <div style={{ position: 'absolute', top: 3, width: 14, height: 14, borderRadius: '50%', background: 'white', boxShadow: '0 1px 4px rgba(0,0,0,0.28)', transition: 'transform 280ms ease', transform: calendarClean ? 'translateX(25px)' : 'translateX(3px)' }} />
                    </div>
                  </button>
                )}
                {/* Monthly Dashboard pill */}
                {view === 'calendar' && (
                  <button
                    onClick={toggleView}
                    className="xp-mfp-dash-pill"
                    style={{
                      display: 'flex', alignItems: 'center', gap: 5,
                      padding: '5px 14px', borderRadius: 20, fontSize: 11, fontWeight: 600,
                      background: 'rgba(255,255,255,0.12)', color: 'white',
                      border: '1px solid rgba(255,255,255,0.22)',
                      boxShadow: '0 1px 5px rgba(0,0,0,0.18)',
                      cursor: 'pointer', transition: 'all 180ms ease', whiteSpace: 'nowrap',
                    }}
                  >
                    📊 Monthly Dashboard
                  </button>
                )}
              </div>

            </div>

            {/* ── Scroll body — scrollbar clipped within modal rounded corners ── */}
            <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, overscrollBehavior: 'contain', WebkitOverflowScrolling: 'touch' } as React.CSSProperties}>

            {/* ── Animated body ──────────────────────────────────────────────── */}
            <div key={`${view}-${currentMonth}`} style={{ animation: `${animName} 270ms ease` }}>

              {/* ── CALENDAR VIEW ─────────────────────────────────────────────── */}
              {view === 'calendar' && (
                <div className="p-6 xp-mfp-cal-body" style={{ background: 'var(--xp-bg)' }}>
                  <div style={{ maxWidth: 860, margin: '0 auto' }}>
                    <MonthCalendarLarge
                      month={currentMonth}
                      calData={calData as Record<string, unknown>}
                      onDayDoubleClick={onDayDoubleClick}
                    />
                    {/* Share button — desktop only (hidden on mobile via CSS) */}
                    <div className="xp-mfp-share-desktop" style={{ justifyContent: 'center', paddingTop: 28, paddingBottom: 4 }}>
                      <button
                        onClick={openPanel}
                        className="xp-mfp-share"
                        style={{
                          display: 'flex', alignItems: 'center', gap: 8,
                          padding: '9px 24px', borderRadius: 24, fontSize: 12, fontWeight: 600,
                          background: 'rgba(124,58,237,0.08)', color: '#7c3aed',
                          border: '1px solid rgba(124,58,237,0.28)',
                          boxShadow: '0 1px 5px rgba(124,58,237,0.10)',
                          cursor: 'pointer', transition: 'all 180ms ease',
                        }}
                      >
                        <ShareIcon /> Share {MONTHS[currentMonth]}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* ── DASHBOARD VIEW ─────────────────────────────────────────────── */}
              {view === 'dashboard' && (
                <div className="p-3 sm:p-4 lg:p-5 space-y-3 lg:space-y-4" style={{ background: isDark ? 'rgba(9,4,22,0.99)' : 'var(--xp-bg3)' }}>
                  {/* Mobile context label — month/year shown below header on mobile */}
                  <div className="xp-mfp-dash-ctx">{MONTHS[currentMonth]} {APP_YEAR}</div>

                  {/* ROW 1 — KPI Cards | Gauge | Achievement */}
                  <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.52fr)_minmax(0,1.36fr)_minmax(0,0.70fr)] items-stretch gap-3 lg:gap-4">

                    {/* LEFT: 6 KPI cards + Monthly Summary */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        {mKpis.map(m => (
                          <div key={m.label} className="rounded-2xl flex flex-col relative overflow-hidden p-2.5 xp-kpi-card"
                            style={{ '--kpi-glow-rgb': m.glowRgb, background: m.bg, border: `0.5px solid ${m.border}`, minHeight: 80 } as React.CSSProperties}>
                            <div style={{ position: 'absolute', inset: 0, borderRadius: 'inherit', pointerEvents: 'none', background: 'linear-gradient(165deg,rgba(255,255,255,0.22) 0%,rgba(255,255,255,0.06) 38%,rgba(255,255,255,0) 100%)' }} />
                            <div style={{ width: 20, height: 20, borderRadius: 5, marginBottom: 5, background: 'rgba(255,255,255,0.16)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, flexShrink: 0 }}>{m.icon}</div>
                            <p className="text-base sm:text-lg font-bold leading-none tabular-nums mb-1" style={{ color: '#FFFFFF' }}>{m.value}</p>
                            <p className="text-[8.5px] font-medium mt-auto leading-tight" style={{ color: 'rgba(255,255,255,0.72)' }}>{m.label}</p>
                            {m.sub && <p className="text-[8px] mt-0.5 font-semibold" style={{ color: 'rgba(255,255,255,0.86)' }}>{m.sub}</p>}
                          </div>
                        ))}
                      </div>

                      {/* Monthly Summary compact panel */}
                      <div className="rounded-2xl p-3" style={{ background: isDark ? 'linear-gradient(135deg,rgba(76,29,149,0.55) 0%,rgba(109,40,217,0.32) 50%,rgba(167,139,250,0.18) 100%)' : 'linear-gradient(135deg,rgba(237,233,254,0.95) 0%,rgba(221,214,254,0.80) 50%,rgba(196,181,253,0.55) 100%)', border: `0.5px solid ${isDark ? 'rgba(167,139,250,0.22)' : 'rgba(139,92,246,0.22)'}`, boxShadow: isDark ? '0 2px 18px rgba(109,40,217,0.18)' : '0 1px 6px rgba(109,40,217,0.08)' }}>
                        <p className="text-[10px] font-semibold mb-2" style={{ color: isDark ? 'rgba(221,214,254,0.80)' : 'rgba(109,40,217,0.80)', letterSpacing: '0.03em' }}>Monthly Summary</p>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 0', rowGap: 4 }}>
                          {([
                            { label: `${stats.productiveDays} Productive Days`, col: '#22c55e' },
                            { label: `${stats.hyperDays} Hyper 🔥`, col: '#f97316' },
                            { label: `${formatMs(totalMs)} Focus`, col: '#a78bfa' },
                            { label: `${monthTaskStats.completedTasks} Tasks ✓`, col: '#38bdf8' },
                            ...(stats.goalDays > 0 ? [{ label: `${stats.goalDays} Goals 🎯`, col: '#22c55e' }] : []),
                            ...(stats.milestoneDays > 0 ? [{ label: `${stats.milestoneDays} Milestones 🏆`, col: '#a855f7' }] : []),
                          ] as { label: string; col: string }[]).map((item, i) => (
                            <span key={i} style={{ fontSize: 10, fontWeight: 600, color: item.col, whiteSpace: 'nowrap' }}>
                              {i > 0 && <span style={{ color: isDark ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.28)', margin: '0 6px' }}>·</span>}
                              {item.label}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* CENTER: Performance Analytics Gauge */}
                    <div className="rounded-2xl overflow-hidden flex flex-col" style={{ background: isDark ? 'linear-gradient(145deg,rgba(16,7,44,0.99) 0%,rgba(7,3,18,0.99) 100%)' : 'var(--xp-card)', border: isDark ? '0.5px solid rgba(124,58,237,0.35)' : '0.5px solid var(--xp-bdr2)', boxShadow: isDark ? '0 4px 36px rgba(80,0,220,0.22),0 2px 16px rgba(0,0,0,0.55)' : '0 2px 12px rgba(0,0,0,0.08)', minHeight: 280 }}>
                      <GaugeMeter score={monthScore} />
                    </div>

                    {/* RIGHT: Monthly Achievement summary */}
                    <div ref={achRef} className="rounded-2xl p-3 flex flex-col" style={card1}>
                      <p className="text-[11px] font-bold mb-3" style={{ color: isDark ? '#a78bfa' : '#7c3aed' }}>Monthly Achievement</p>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
                        {([
                          { emoji: '📅', label: 'Days in Month', value: String(stats.totalDays),      fill: null },
                          { emoji: '⭐', label: 'Productive',     value: String(stats.productiveDays), fill: stats.totalDays > 0 ? stats.productiveDays / stats.totalDays : 0 },
                          { emoji: '🔥', label: 'Current Streak', value: `${currentStreak}d`,          fill: longestStreak > 0 ? currentStreak / longestStreak : 0 },
                          { emoji: '⚡', label: 'Best Streak',    value: `${longestStreak}d`,          fill: stats.totalDays > 0 ? longestStreak / stats.totalDays : 0 },
                          { emoji: '📊', label: 'Performance',    value: `${monthScore}%`,             fill: monthScore / 100 },
                          { emoji: '🎯', label: 'Goals',          value: String(stats.goalDays),       fill: stats.goalDays > 0 ? Math.min(stats.goalDays / Math.max(stats.totalDays, 1), 1) : null },
                          { emoji: '🏆', label: 'Milestones',     value: String(stats.milestoneDays),  fill: stats.milestoneDays > 0 ? Math.min(stats.milestoneDays / Math.max(stats.totalDays, 1), 1) : null },
                        ] as { emoji: string; label: string; value: string; fill: number | null }[]).map(item => (
                          <div key={item.label} style={{ position: 'relative', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '5px 8px', borderRadius: 8, background: isDark ? 'rgba(124,58,237,0.07)' : 'rgba(124,58,237,0.04)', border: `0.5px solid ${isDark ? 'rgba(124,58,237,0.14)' : 'rgba(124,58,237,0.10)'}` }}>
                            {item.fill !== null && item.fill > 0 && (
                              <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${item.fill * achFrac * 100}%`, background: isDark ? 'linear-gradient(90deg,rgba(124,58,237,0.22) 0%,rgba(167,139,250,0.10) 100%)' : 'linear-gradient(90deg,rgba(124,58,237,0.10) 0%,rgba(167,139,250,0.05) 100%)', borderRadius: 8, pointerEvents: 'none' }} />
                            )}
                            <span style={{ position: 'relative', fontSize: 10, color: isDark ? 'rgba(203,213,225,0.65)' : 'var(--xp-txt3)' }}>{item.emoji} {item.label}</span>
                            <span style={{ position: 'relative', fontSize: 11, fontWeight: 700, color: isDark ? 'rgba(255,255,255,0.90)' : 'var(--xp-txt)' }}>{item.value}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* ROW 2 — Monthly Progress (cumulative) | Activity Breakdown */}
                  <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.9fr)_minmax(0,1fr)] items-stretch gap-3 lg:gap-4">

                    {/* Monthly Progress — cumulative day-by-day area chart */}
                    <div className="rounded-2xl p-4 sm:p-5 flex flex-col" style={card1}>
                      <div className="flex items-start justify-between flex-shrink-0 mb-3">
                        <div>
                          <p className="text-[11px] font-semibold tracking-wide" style={{ color: isDark ? 'rgba(255,255,255,0.88)' : 'var(--xp-txt)' }}>Monthly Progress</p>
                          <p className="text-[9px] mt-0.5" style={{ color: isDark ? 'rgba(148,163,184,0.5)' : 'var(--xp-txt3)' }}>Cumulative focus time across {MONTHS[currentMonth]}</p>
                        </div>
                        {totalMs > 0 && (
                          <div className="text-right">
                            <p className="text-[14px] font-bold tabular-nums" style={{ color: '#a78bfa' }}>{formatMs(totalMs)}</p>
                            <p className="text-[9px]" style={{ color: isDark ? 'rgba(148,163,184,0.45)' : 'var(--xp-txt3)' }}>total</p>
                          </div>
                        )}
                      </div>
                      <div style={{ flex: 1, minHeight: 160 }}>
                        <MonthCumulativeChart month={currentMonth} sessions={monthSessions} isDark={isDark} />
                      </div>
                    </div>

                    {/* Activity Breakdown donut */}
                    <div className="rounded-2xl p-4 sm:p-5" style={card2}>
                      <p className="text-[11px] font-semibold tracking-wide mb-3" style={{ color: isDark ? 'rgba(255,255,255,0.88)' : 'var(--xp-txt)' }}>Activity Breakdown</p>
                      {actBreakdown.length > 0 ? (
                        <div className="flex flex-col items-center">
                          <ActivityPieChart breakdown={actBreakdown} totalMs={totalMs} />
                        </div>
                      ) : (
                        <div className="flex items-center justify-center h-24">
                          <p className="text-[10px]" style={{ color: 'var(--xp-txt3)' }}>No activity data this month</p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* ROW 3 — Total Activities | Total Sessions | Total Tasks */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 lg:gap-4">

                    {/* Total Activities */}
                    <div className="rounded-2xl p-3.5" style={card1}>
                      <p className="text-[11px] font-semibold tracking-wide mb-2.5" style={{ color: isDark ? 'rgba(255,255,255,0.88)' : 'var(--xp-txt)' }}>Total Activities</p>
                      {actBreakdown.length > 0 ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                          {actBreakdown.map(a => {
                            const pct = totalMs > 0 ? Math.round((a.ms / totalMs) * 100) : 0
                            return (
                              <div key={a.name}>
                                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(80px,1fr) 52px 32px', alignItems: 'center', gap: 4, marginBottom: 5 }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
                                    <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: a.color }} />
                                    <span className="text-[9px] truncate" style={{ color: isDark ? 'rgba(203,213,225,0.78)' : 'var(--xp-txt2)' }}>{a.name}</span>
                                  </div>
                                  <span className="text-[9px] tabular-nums font-semibold text-right" style={{ color: isDark ? 'rgba(255,255,255,0.72)' : 'var(--xp-txt)' }}>{formatMs(a.ms)}</span>
                                  <span className="text-[8px] tabular-nums text-right" style={{ color: isDark ? 'rgba(148,163,184,0.5)' : 'var(--xp-txt3)' }}>{pct}%</span>
                                </div>
                                <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ background: isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.06)' }}>
                                  <div className="h-full rounded-full" style={{ width: `${pct}%`, background: a.color, transition: 'width 600ms ease' }} />
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      ) : (
                        <div className="flex items-center justify-center h-20">
                          <p className="text-[10px]" style={{ color: 'var(--xp-txt3)' }}>No activity data</p>
                        </div>
                      )}
                    </div>

                    {/* Total Sessions */}
                    <div className="rounded-2xl overflow-hidden" style={card2}>
                      <div className="px-4 py-2.5" style={{ borderBottom: isDark ? '0.5px solid rgba(124,58,237,0.12)' : '0.5px solid rgba(0,0,0,0.08)' }}>
                        <p className="text-[11px] font-semibold tracking-wide" style={{ color: isDark ? 'rgba(255,255,255,0.88)' : 'var(--xp-txt)' }}>Total Sessions</p>
                      </div>
                      {monthTopSessions.length > 0 ? (
                        <div>
                          {monthTopSessions.slice(0, 8).map((s, i) => {
                            const deep = s.durationMs >= 45 * 60_000
                            return (
                              <div key={i} style={{ display: 'grid', gridTemplateColumns: 'minmax(86px,1fr) 44px 54px', alignItems: 'center', gap: 6, padding: '5px 14px', borderBottom: i < Math.min(monthTopSessions.length, 8) - 1 ? isDark ? '0.5px solid rgba(124,58,237,0.08)' : '0.5px solid var(--xp-bdr)' : 'none' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                                  <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: s.actColor }} />
                                  <span className="text-[10px] font-semibold truncate" style={{ color: isDark ? 'rgba(255,255,255,0.85)' : 'var(--xp-txt)' }}>{s.actName}</span>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'center' }}>
                                  {deep && <span className="text-[7px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(124,58,237,0.15)', color: '#a78bfa', border: '0.5px solid rgba(124,58,237,0.22)', whiteSpace: 'nowrap' }}>Deep</span>}
                                </div>
                                <span className="text-[10px] font-bold tabular-nums text-right" style={{ color: deep ? '#a78bfa' : isDark ? 'rgba(203,213,225,0.72)' : 'var(--xp-txt2)' }}>{formatMs(s.durationMs)}</span>
                              </div>
                            )
                          })}
                        </div>
                      ) : (
                        <div className="px-4 py-6 text-center">
                          <p className="text-[10px]" style={{ color: 'var(--xp-txt3)' }}>No sessions recorded this month</p>
                        </div>
                      )}
                    </div>

                    {/* Total Tasks */}
                    <div className="rounded-2xl p-3.5" style={card1}>
                      <div className="flex items-center justify-between mb-2.5">
                        <p className="text-[11px] font-semibold tracking-wide" style={{ color: isDark ? 'rgba(255,255,255,0.88)' : 'var(--xp-txt)' }}>Total Tasks</p>
                        {monthTaskStats.totalTasks > 0 && (
                          <span className="text-[8px] font-bold px-2 py-0.5 rounded-full" style={{ background: 'rgba(124,58,237,0.16)', color: '#a78bfa', border: '0.5px solid rgba(124,58,237,0.26)' }}>
                            {monthTaskStats.completedTasks}/{monthTaskStats.totalTasks} done
                          </span>
                        )}
                      </div>
                      {monthTaskStats.totalTasks > 0 ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                          <div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                              <p className="text-[9px]" style={{ color: isDark ? 'rgba(148,163,184,0.5)' : 'var(--xp-txt3)' }}>Completion Rate</p>
                              <p className="text-[9px] font-bold" style={{ color: '#a78bfa' }}>{monthTaskStats.totalTasks > 0 ? Math.round((monthTaskStats.completedTasks / monthTaskStats.totalTasks) * 100) : 0}%</p>
                            </div>
                            <div className="h-2 rounded-full overflow-hidden" style={{ background: isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.06)' }}>
                              <div className="h-full rounded-full" style={{ width: `${monthTaskStats.totalTasks > 0 ? Math.round((monthTaskStats.completedTasks / monthTaskStats.totalTasks) * 100) : 0}%`, background: 'linear-gradient(90deg,#7c3aed 0%,#a855f7 50%,#d946ef 100%)', transition: 'width 600ms ease' }} />
                            </div>
                          </div>
                          {([
                            { icon: '📋', label: 'Total Tasks', val: String(monthTaskStats.totalTasks) },
                            { icon: '✅', label: 'Completed', val: String(monthTaskStats.completedTasks), col: '#22c55e' },
                            { icon: '📅', label: 'Productive Days', val: String(stats.productiveDays) },
                            { icon: '🎯', label: 'Goals', val: String(stats.goalDays) },
                            { icon: '🏆', label: 'Milestones', val: String(stats.milestoneDays) },
                          ] as { icon: string; label: string; val: string; col?: string }[]).map(item => (
                            <div key={item.label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 6, borderBottom: isDark ? '0.5px solid rgba(255,255,255,0.05)' : '0.5px solid var(--xp-bdr)' }}>
                              <span style={{ fontSize: 9, color: isDark ? 'rgba(148,163,184,0.60)' : 'var(--xp-txt3)' }}>{item.icon} {item.label}</span>
                              <span style={{ fontSize: 11, fontWeight: 700, color: item.col ?? (isDark ? 'rgba(255,255,255,0.85)' : 'var(--xp-txt)') }}>{item.val}</span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="flex items-center justify-center h-20">
                          <p className="text-[10px]" style={{ color: 'var(--xp-txt3)' }}>No tasks this month</p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* ROW 4 — Weekly Focus Breakdown | Monthly Performance Badge */}
                  <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.9fr)_minmax(0,1fr)] items-stretch gap-3 lg:gap-4">

                    {/* Weekly Focus Breakdown */}
                    <div className="rounded-2xl p-4 sm:p-5 flex flex-col" style={card1}>
                      <div className="flex items-start justify-between flex-shrink-0 mb-1">
                        <div>
                          <p className="text-[11px] font-semibold tracking-wide" style={{ color: isDark ? 'rgba(255,255,255,0.88)' : 'var(--xp-txt)' }}>Weekly Focus Breakdown</p>
                          <p className="text-[9px] mt-0.5" style={{ color: isDark ? 'rgba(148,163,184,0.5)' : 'var(--xp-txt3)' }}>Total focus hours per week · {MONTHS[currentMonth]}</p>
                        </div>
                      </div>
                      <div style={{ flex: 1 }}>
                        <WeeklyFocusChart month={currentMonth} sessions={monthSessions} isDark={isDark} />
                      </div>
                    </div>

                    {/* Monthly Performance Badge */}
                    <div className="rounded-2xl p-5 flex flex-col items-center justify-center text-center" style={{ ...card2, position: 'relative', overflow: 'hidden' }}>
                      <div style={{ position: 'absolute', inset: 0, background: isDark ? 'linear-gradient(145deg,rgba(124,58,237,0.06) 0%,rgba(0,0,0,0) 60%)' : 'linear-gradient(145deg,rgba(124,58,237,0.04) 0%,rgba(0,0,0,0) 60%)', borderRadius: 'inherit', pointerEvents: 'none' }} />
                      <p style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.10em', color: isDark ? 'rgba(167,139,250,0.65)' : '#7c3aed', marginBottom: 12, position: 'relative' }}>
                        {MONTHS[currentMonth].toUpperCase()} PERFORMANCE
                      </p>
                      <div style={{ width: 88, height: 88, borderRadius: '50%', background: badgeTier.bg, border: `2.5px solid ${badgeTier.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 36, marginBottom: 12, boxShadow: `0 6px 24px ${badgeTier.border}`, position: 'relative' }}>
                        {badgeTier.icon}
                      </div>
                      <p style={{ fontSize: 17, fontWeight: 800, color: badgeTier.color, marginBottom: 6, letterSpacing: '-0.01em', position: 'relative' }}>{badgeTier.rank}</p>
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 12px', borderRadius: 20, background: isDark ? 'rgba(124,58,237,0.14)' : 'rgba(124,58,237,0.08)', border: `0.5px solid ${isDark ? 'rgba(124,58,237,0.24)' : 'rgba(124,58,237,0.15)'}`, marginBottom: 10, position: 'relative' }}>
                        <span style={{ fontSize: 9, fontWeight: 700, color: '#a78bfa' }}>Score: {monthScore}%</span>
                      </div>
                      <p style={{ fontSize: 9.5, color: isDark ? 'rgba(203,213,225,0.60)' : 'var(--xp-txt2)', marginBottom: 6, fontStyle: 'italic', position: 'relative' }}>{badgeTier.msg}</p>
                      <p style={{ fontSize: 8.5, color: isDark ? 'rgba(148,163,184,0.45)' : 'var(--xp-txt3)', position: 'relative' }}>
                        {`You earned ${MONTHS[currentMonth]}'s ${badgeTier.rank} Badge`}
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
            </div>{/* ── /scroll body ── */}

            {/* ── Mobile dual action bar — locked at modal bottom, above nav ── */}
            {view === 'calendar' && (
              <div className="xp-mfp-dual-bar">
                <button className="xp-mfp-dual-left" onClick={() => { playTapSound(); toggleView() }}>
                  <span className="xp-mfp-dual-icon">📊</span>
                  Monthly Dashboard
                </button>
                <div className="xp-mfp-dual-divider" />
                <button className="xp-mfp-dual-right" onClick={() => { playTapSound(); openPanel() }}>
                  <span className="xp-mfp-dual-icon" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}><ShareIcon /></span>
                  Share Progress
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Share panel — fixed bottom sheet, spring slide-up ───────────────── */}
      {panelOpen && (
        <div
          className="fixed inset-0 z-[60]"
          style={{ background: panelAnim ? 'rgba(0,0,0,0.55)' : 'rgba(0,0,0,0)', transition: 'background 0.25s ease' }}
          onClick={closePanel}
        >
          <div
            className="absolute left-0 right-0 bottom-0 rounded-t-2xl shadow-2xl"
            style={{
              background: '#111114',
              border: '0.5px solid rgba(255,255,255,0.10)',
              transform: panelAnim ? 'translateY(0)' : 'translateY(100%)',
              opacity: panelAnim ? 1 : 0,
              transition: 'transform 0.38s cubic-bezier(0.34,1.4,0.64,1), opacity 0.22s ease',
              maxWidth: 520, margin: '0 auto',
              paddingBottom: 'env(safe-area-inset-bottom, 8px)',
              maxHeight: '92vh', overflowY: 'auto',
            }}
            onClick={e => e.stopPropagation()}
          >
            {/* Drag handle */}
            <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 12, paddingBottom: 4 }}>
              <div style={{ width: 36, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.15)' }} />
            </div>

            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 20px 12px', borderBottom: '0.5px solid rgba(255,255,255,0.07)' }}>
              <div>
                <p style={{ fontSize: 13, fontWeight: 700, color: 'white' }}>Share {MONTHS[currentMonth]}</p>
                <p style={{ fontSize: 9.5, color: 'rgba(255,255,255,0.40)', marginTop: 2 }}>Card saved to Gallery automatically</p>
              </div>
              <button onClick={closePanel} style={{ fontSize: 12, color: 'rgba(255,255,255,0.40)', cursor: 'pointer', padding: 4 }}>✕</button>
            </div>

            {/* Share Card preview */}
            <div style={{ padding: '14px 20px 8px' }}>
              <ShareCardPreview
                month={currentMonth} stats={stats}
                totalMs={totalMs} currentStreak={currentStreak} longestStreak={longestStreak}
              />
            </div>

            {/* Platform grid (5 columns) */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 10, padding: '8px 16px 4px' }}>
              {PLATFORMS.map(p => (
                <button
                  key={p.id}
                  onClick={() => handlePlatformClick(p)}
                  disabled={sharing}
                  style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7,
                    padding: '11px 4px', borderRadius: 14,
                    background: 'rgba(255,255,255,0.05)', border: '0.5px solid rgba(255,255,255,0.08)',
                    cursor: 'pointer', opacity: sharing ? 0.4 : 1, transition: 'all 140ms ease',
                  }}
                >
                  <PlatformLogo p={p} />
                  <div style={{ textAlign: 'center', lineHeight: 1.25 }}>
                    <p style={{ fontSize: 8.5, fontWeight: 600, color: 'rgba(255,255,255,0.85)' }}>{p.label}</p>
                    {p.sublabel && <p style={{ fontSize: 7.5, color: 'rgba(255,255,255,0.38)' }}>{p.sublabel}</p>}
                  </div>
                </button>
              ))}
            </div>

            {/* Copy Image + Download PNG — wide buttons */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, padding: '8px 16px 16px' }}>
              <button
                onClick={() => void copyImage()}
                disabled={sharing}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
                  padding: '12px 16px', borderRadius: 14,
                  background: 'rgba(124,58,237,0.12)', border: '1px solid rgba(124,58,237,0.25)',
                  cursor: 'pointer', opacity: sharing ? 0.4 : 1, transition: 'all 140ms ease',
                }}
              >
                <div style={{ width: 36, height: 36, borderRadius: 10, background: '#7c3aed', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <svg viewBox="0 0 16 16" fill="none" width="16" height="16">
                    <rect x="1.5" y="5" width="9.5" height="10" rx="1.5" stroke="white" strokeWidth="1.4"/>
                    <rect x="5" y="1.5" width="9.5" height="10" rx="1.5" stroke="white" strokeWidth="1.4" fill="#7c3aed"/>
                  </svg>
                </div>
                <div style={{ textAlign: 'left' }}>
                  <p style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.90)' }}>Copy Image</p>
                  <p style={{ fontSize: 8.5, color: 'rgba(255,255,255,0.38)' }}>To clipboard</p>
                </div>
              </button>
              <button
                onClick={() => void executeShare()}
                disabled={sharing}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
                  padding: '12px 16px', borderRadius: 14,
                  background: 'rgba(79,70,229,0.12)', border: '1px solid rgba(79,70,229,0.25)',
                  cursor: 'pointer', opacity: sharing ? 0.4 : 1, transition: 'all 140ms ease',
                }}
              >
                <div style={{ width: 36, height: 36, borderRadius: 10, background: '#4f46e5', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <svg viewBox="0 0 16 16" fill="none" width="16" height="16">
                    <path d="M8 2v9M4 7l4 5 4-5" stroke="white" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
                    <line x1="2" y1="14" x2="14" y2="14" stroke="white" strokeWidth="1.6" strokeLinecap="round"/>
                  </svg>
                </div>
                <div style={{ textAlign: 'left' }}>
                  <p style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.90)' }}>Download</p>
                  <p style={{ fontSize: 8.5, color: 'rgba(255,255,255,0.38)' }}>Save as PNG</p>
                </div>
              </button>
            </div>

            {sharing && (
              <p style={{ textAlign: 'center', fontSize: 10, paddingBottom: 12, color: 'rgba(255,255,255,0.40)' }}>
                Generating share card…
              </p>
            )}
          </div>
        </div>
      )}

      {/* ── Connect Account dialog ──────────────────────────────────────────── */}
      {connectTarget && (
        <div
          className="fixed inset-0 z-[65] flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.70)' }}
          onClick={() => setConnectTarget(null)}
        >
          <div
            className="w-full max-w-[300px] rounded-2xl p-6 shadow-2xl"
            style={{ background: '#111114', border: '0.5px solid rgba(255,255,255,0.12)' }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
              <PlatformLogo p={connectTarget} />
            </div>
            <h3 style={{ fontSize: 14, fontWeight: 700, color: 'white', textAlign: 'center', marginBottom: 6 }}>
              Connect {connectTarget.label}?
            </h3>
            <p style={{ fontSize: 11, textAlign: 'center', color: 'rgba(255,255,255,0.45)', marginBottom: 20, lineHeight: 1.55 }}>
              Allow XPadite to share your monthly progress to {connectTarget.label}.
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => setConnectTarget(null)}
                style={{ flex: 1, padding: '9px', borderRadius: 12, fontSize: 12, background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.55)', border: '0.5px solid rgba(255,255,255,0.10)', cursor: 'pointer' }}
              >
                Cancel
              </button>
              <button
                onClick={handleConnect}
                style={{ flex: 1, padding: '9px', borderRadius: 12, fontSize: 12, fontWeight: 600, color: connectTarget.color, background: connectTarget.bg.startsWith('linear') ? '#E1306C' : connectTarget.bg, cursor: 'pointer' }}
              >
                Connect
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
