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
import { useDisplayFirstName } from './useDisplayFirstName'
import { AchievementBanner, PERFORMANCE_TIERS, getTaskPerformanceLevel, DonutChart, TASK_GRAD_STRINGS } from './DayDashboardModal'
import { ProductiveDot } from './LegendRow'

// ─── Injected styles (keyframes + premium button hover rules) ─────────────────

const MFP_STYLES = `
  @keyframes xp-mfp-in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
  @keyframes xp-from-right{from{opacity:0;transform:translateX(52px)}to{opacity:1;transform:translateX(0)}}
  @keyframes xp-from-left{from{opacity:0;transform:translateX(-52px)}to{opacity:1;transform:translateX(0)}}
  @keyframes xp-picker-in{from{opacity:0;transform:translateX(-50%) scale(0.95) translateY(-4px)}to{opacity:1;transform:translateX(-50%) scale(1) translateY(0)}}

  /* Monthly Progress trend-line points — unchanged on mobile; modestly
     smaller on tablet/desktop only. */
  @media(min-width:640px){
    .xp-mfp-week-point{r:4px;}
  }

  @media(max-width:640px){
    .xp-mfp-overlay{bottom:56px!important;overflow:hidden!important;display:flex!important;flex-direction:column!important;padding:0!important;background:rgba(0,0,0,1)!important;}
    .xp-mfp-wrap{flex:1!important;min-height:0!important;padding:0!important;display:flex!important;flex-direction:column!important;align-items:stretch!important;justify-content:flex-start!important;}
    .xp-mfp-box{flex:1!important;height:auto!important;max-height:none!important;max-width:none!important;width:100%!important;border-radius:0!important;margin:0!important;background:var(--xp-bg)!important;}

    .xp-mfp-hdr{display:flex!important;flex-wrap:nowrap!important;align-items:center;justify-content:space-between!important;gap:0;padding:12px 10px!important;position:relative!important;}
    .xp-mfp-hdr-l{order:1;flex:0 0 auto;align-self:center;position:relative;z-index:2;display:flex!important;align-items:center!important;}
    .xp-mfp-hdr-c{
      position:absolute!important;left:50%!important;top:50%!important;
      transform:translate(-50%,-50%)!important;
      flex:none!important;width:auto!important;
      display:flex!important;flex-direction:column!important;align-items:center!important;gap:2px!important;
      justify-content:center!important;padding-top:0!important;z-index:1;
    }
    .xp-mfp-hdr-r{order:3;flex:0 0 auto;margin-left:0!important;display:flex!important;justify-content:flex-end;align-items:center;gap:0!important;position:relative;z-index:2;}

    .xp-mfp-hdr .xp-mfp-back{background:transparent!important;border:none!important;box-shadow:none!important;padding:6px 6px 6px 0!important;font-size:22px!important;line-height:1!important;border-radius:4px!important;-webkit-tap-highlight-color:transparent!important;}
    .xp-mfp-hdr .xp-mfp-back:hover{background:transparent!important;transform:none!important;box-shadow:none!important;}
    .xp-mfp-hdr .xp-mfp-back:focus{outline:none!important;background:transparent!important;box-shadow:none!important;}
    .xp-mfp-hdr .xp-mfp-back:focus:not(:focus-visible){background:transparent!important;outline:none!important;box-shadow:none!important;}
    .xp-mfp-hdr .xp-mfp-back:active{background:rgba(255,255,255,0.12)!important;}
    .xp-back-txt{display:none;}
    .xp-mfp-hdr .xp-mfp-dash-pill{display:none!important;}

    /* Month trigger — smaller on mobile */
    .xp-mfp-month-trigger{font-size:12px!important;}
    .xp-mfp-month-trigger-sub{font-size:10px!important;}
    .xp-mfp-month-caret{font-size:15px!important;margin-top:-1px!important;}

    .xp-mfp-cal-body{padding:10px 6px!important;}
    .xp-mfp-cal-dh{padding-top:9px!important;padding-bottom:9px!important;}
    .xp-mfp-cal-grid{row-gap:24px!important;}
    .xp-cal-circle{inset:20%!important;}
    .xp-mfp-share-desktop{display:none!important;}

    .xp-mfp-dual-bar{
      display:flex!important;align-items:center;
      margin:0!important;padding:11px 14px!important;gap:10px!important;
      border-radius:0!important;border:none!important;
      border-top:0.5px solid rgba(0,0,0,0.08)!important;
      background:rgba(124,58,237,0.05)!important;
      box-shadow:none!important;flex-shrink:0!important;
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

    /* Picker viewport clamping on mobile */
    .xp-mfp-picker{min-width:192px;max-width:calc(100vw - 32px);}
  }

  /* Desktop defaults */
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

  /* Dashboard-view Back control: arrow-only, all breakpoints (overrides the
     pill recipe above, which stays as-is for the calendar view's own Back). */
  .xp-mfp-hdr .xp-mfp-back-dash{
    background:transparent!important;border:none!important;box-shadow:none!important;
    padding:6px 6px 6px 0!important;font-size:20px!important;line-height:1!important;
  }
  .xp-mfp-hdr .xp-mfp-back-dash:hover{
    background:rgba(255,255,255,0.12)!important;border:none!important;box-shadow:none!important;transform:none!important;
  }
  .xp-mfp-back-dash .xp-back-txt{display:none!important;}

  /* Dashboard-view title block: absolutely centered on the full header width
     at every breakpoint, so it never shifts with the Back control's width
     (the calendar view's own center column keeps its grid-based position). */
  .xp-mfp-hdr-c-dash{
    position:absolute!important;left:50%!important;top:50%!important;
    transform:translate(-50%,-50%)!important;
    width:auto!important;
  }

  /* Dashboard-view header: vertical height matched to Today's Dashboard's
     header (py-3.5/py-4 — 14px mobile, 16px sm+ — plus the same explicit
     min-height floor, since this grid's right column is empty in dashboard
     view and the center title is absolutely positioned, so neither
     contributes to the grid row's auto height on its own). The calendar
     view's own header padding (set inline above) is untouched. */
  .xp-mfp-hdr.xp-mfp-hdr-dash{padding-top:14px!important;padding-bottom:14px!important;min-height:60px!important;}
  @media(min-width:640px){
    .xp-mfp-hdr.xp-mfp-hdr-dash{padding-top:16px!important;padding-bottom:16px!important;min-height:64px!important;}
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

  .xp-mfp-share:hover{
    background:#7c3aed!important;color:white!important;
    border-color:#7c3aed!important;
    box-shadow:0 4px 14px rgba(124,58,237,0.40)!important;
    transform:translateY(-1px);
  }

  /* Month/Year trigger button */
  .xp-mfp-month-trigger{
    display:inline-flex;align-items:center;gap:4px;
    background:transparent;border:none;cursor:pointer;
    padding:3px 8px;border-radius:8px;
    color:rgba(255,255,255,0.92);
    font-size:13px;font-weight:700;
    white-space:nowrap;
    text-shadow:0 1px 4px rgba(0,0,0,0.30);
    transition:background 140ms ease;
    -webkit-tap-highlight-color:transparent;
    line-height:1.2;
  }
  .xp-mfp-month-trigger:hover{background:rgba(255,255,255,0.12);}
  .xp-mfp-month-trigger:active{background:rgba(255,255,255,0.20);transition-duration:60ms;}
  /* Subtitle variant — for dashboard sub-line */
  .xp-mfp-month-trigger-sub{
    font-size:11px!important;font-weight:500!important;
    color:rgba(255,255,255,0.70)!important;text-shadow:none!important;
    padding:2px 8px!important;
  }
  .xp-mfp-month-caret{font-size:13px;opacity:0.78;margin-top:-1px;line-height:1;}

  /* Month/Year picker popup */
  .xp-mfp-picker-wrap{
    position:absolute;
    top:100%;
    left:50%;
    transform:translateX(-50%);
    z-index:50;
    padding-top:6px;
    animation:xp-picker-in 150ms ease;
  }
  .xp-mfp-picker{
    background:#1e0d3a;
    border:0.5px solid rgba(167,139,250,0.32);
    border-radius:14px;
    box-shadow:0 12px 40px rgba(0,0,0,0.65),0 0 0 0.5px rgba(167,139,250,0.10);
    padding:10px;
    width:206px;
  }
  .xp-mfp-picker-present{
    width:100%;padding:8px 12px;border-radius:9px;
    font-size:11.5px;font-weight:600;color:white;
    background:rgba(124,58,237,0.22);
    border:0.5px solid rgba(124,58,237,0.40);
    cursor:pointer;text-align:center;margin-bottom:8px;
    transition:background 120ms ease;
    -webkit-tap-highlight-color:transparent;display:block;
  }
  .xp-mfp-picker-present:hover{background:rgba(124,58,237,0.38);}
  .xp-mfp-picker-present:active{background:rgba(124,58,237,0.52);transition-duration:60ms;}
  /* Active state: user is on a different month — strong purple CTA */
  .xp-mfp-picker-present-active{
    background:#7c3aed!important;
    border-color:rgba(124,58,237,0.90)!important;
    box-shadow:0 2px 14px rgba(124,58,237,0.48)!important;
    font-weight:700!important;
  }
  .xp-mfp-picker-present-active:hover{background:#6d28d9!important;}
  .xp-mfp-picker-present-active:active{background:#5b21b6!important;transition-duration:60ms;}
  /* Inactive state: already viewing present month — subdued */
  .xp-mfp-picker-present-inactive{
    background:rgba(255,255,255,0.05)!important;
    border-color:rgba(255,255,255,0.10)!important;
    color:rgba(255,255,255,0.32)!important;
    cursor:default!important;font-weight:500!important;
  }
  .xp-mfp-picker-present-inactive:hover{background:rgba(255,255,255,0.05)!important;}
  .xp-mfp-picker-year{
    display:flex;align-items:center;justify-content:space-between;
    padding:2px 2px 8px;
  }
  .xp-mfp-picker-year-lbl{font-size:12px;font-weight:700;color:white;letter-spacing:0.01em;}
  .xp-mfp-picker-year-btn{
    width:26px;height:26px;border-radius:50%;
    font-size:16px;line-height:1;
    color:rgba(255,255,255,0.60);
    background:rgba(255,255,255,0.08);border:none;cursor:pointer;
    display:flex;align-items:center;justify-content:center;
    transition:background 100ms ease,color 100ms ease;
    -webkit-tap-highlight-color:transparent;
  }
  .xp-mfp-picker-year-btn:hover:not(:disabled){background:rgba(255,255,255,0.16);color:white;}
  .xp-mfp-picker-year-btn:active:not(:disabled){background:rgba(255,255,255,0.22);}
  .xp-mfp-picker-year-btn:disabled{opacity:0.25;cursor:default;}
  .xp-mfp-picker-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:3px;}
  .xp-mfp-picker-month{
    padding:7px 2px;border-radius:8px;
    font-size:11px;font-weight:500;
    color:rgba(255,255,255,0.70);
    background:transparent;border:none;cursor:pointer;text-align:center;
    transition:background 100ms ease,color 100ms ease;
    -webkit-tap-highlight-color:transparent;
  }
  .xp-mfp-picker-month:hover{background:rgba(255,255,255,0.10);color:rgba(255,255,255,0.92);}
  .xp-mfp-picker-month:active{background:rgba(255,255,255,0.16);}
  .xp-mfp-picker-month-sel{
    background:#7c3aed!important;color:white!important;
    font-weight:700!important;
    box-shadow:0 2px 8px rgba(124,58,237,0.40);
  }
  .xp-mfp-picker-month-now{
    outline:1.5px solid rgba(167,139,250,0.55);
    outline-offset:-1px;
    color:rgba(196,181,253,0.88)!important;
  }

  /* Clean-view fade transition */
  .xp-cal-fade{transition:opacity 200ms ease;}
  @media(prefers-reduced-motion:reduce){.xp-cal-fade{transition:none!important;}}

  /* Desktop only: nudge the 🎯 Goal glyph up and slightly right so its
     bullseye centre lines up with the date number's row/column — a
     transform, so it never affects the .xp-goal-date overlay (anchored to
     the wrapper span, not this element) or the date digit's own position. */
  @media (min-width: 1024px) {
    .xp-goal-emoji { transform: translate(3px, -4px); }
  }

  /* Desktop only: nudge an entire connected Goal sequence (emoji+date block
     and its connector-line wrapper, applied to each in equal measure so the
     chain stays continuous) slightly left for better centering. Horizontal
     only — never combined with .xp-goal-emoji's own transform since it's a
     different element in the tree. */
  @media (min-width: 1024px) {
    .xp-goal-shift { transform: translateX(-6px); }
  }

  /* Dashboard pill micro-interactions */
  .xp-mfp-dash-pill{transition:background 180ms ease,border-color 180ms ease,box-shadow 180ms ease,transform 180ms ease;}
  .xp-mfp-dash-pill:hover{
    background:rgba(255,255,255,0.22)!important;
    border-color:rgba(255,255,255,0.42)!important;
    box-shadow:0 2px 12px rgba(0,0,0,0.24),0 0 0 1px rgba(255,255,255,0.14)!important;
    transform:translateY(-1px);
  }
  .xp-mfp-dash-pill:active{transform:translateY(0) scale(0.97)!important;transition-duration:80ms!important;}
  @media(prefers-reduced-motion:reduce){
    .xp-mfp-dash-pill{transition:background 180ms ease,border-color 180ms ease!important;}
    .xp-mfp-dash-pill:hover,.xp-mfp-dash-pill:active{transform:none!important;}
  }

  /* Back-button final override — after all global rules to win cascade */
  @media(max-width:640px){
    .xp-mfp-hdr .xp-mfp-back{
      background:transparent!important;border:none!important;
      box-shadow:none!important;outline:none!important;
      transition:background 80ms ease!important;
    }
    .xp-mfp-hdr .xp-mfp-back:hover{background:transparent!important;border:none!important;box-shadow:none!important;transform:none!important;}
    .xp-mfp-hdr .xp-mfp-back:focus,.xp-mfp-hdr .xp-mfp-back:focus-visible{outline:none!important;background:transparent!important;box-shadow:none!important;border:none!important;}
    .xp-mfp-hdr .xp-mfp-back:focus:not(:focus-visible){outline:none!important;background:transparent!important;box-shadow:none!important;border:none!important;}
    .xp-mfp-hdr .xp-mfp-back:active{background:rgba(255,255,255,0.12)!important;border:none!important;box-shadow:none!important;}
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
  const { progressColor: _rawColor, isDark, updateDay, setToast, reminders, calData: appCalData, calendarClean, effectiveTimezone } = useApp()
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
        const _t = new Date()
        if (new Date(APP_YEAR, month, day) > new Date(_t.getFullYear(), _t.getMonth(), _t.getDate())) {
          setToast("Activity status can't be changed for future dates. You can only update today or past dates.")
          return
        }
        if (wasStreak) { setToast('Change this status from the Task Manager.'); return }
        updateDay(key, prev => ({
          ...prev,
          productive: !prev.productive,
          hyper: prev.productive ? false : prev.hyper,
        }))
        setToast('Day Complete ✅  Great work. See you tomorrow.')
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

          const todayCell     = isToday(APP_YEAR, month, cell.day, effectiveTimezone)
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
              {(!rawHyper && !rawMil && rawGoal) ? (
                <div className="absolute inset-0 xp-goal-shift" style={{ zIndex: 0, pointerEvents: 'none' }}>
                  {connLeft}{connRight}
                </div>
              ) : (<>{connLeft}{connRight}</>)}
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
                      <span style={{ fontSize: 36, lineHeight: 1, userSelect: 'none', display: 'block', position: 'relative', zIndex: 1 }}>🏆</span>
                      <span style={{ position: 'absolute', top: '26%', left: '50%', transform: 'translate(-50%,-50%)', fontSize: 12, fontWeight: 900, color: '#0a0a0a', textShadow: '0 0 6px rgba(255,255,255,1)', zIndex: 3, pointerEvents: 'none' }}>{cell.day}</span>
                    </span>
                  </div>
                </div>
              )}

              {/* 🎯 Goal — kept in DOM, fades */}
              {!rawHyper && !rawMil && rawGoal && (
                <div className="absolute inset-[25%] xp-cal-fade xp-goal-shift" style={{ zIndex: 2, opacity: calendarClean ? 0 : 1, pointerEvents: 'none', overflow: 'visible' }}>
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

type ActivityRow = { name: string; color: string; ms: number }

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

// ─── Monthly weekly trend chart (bars + curved line + points) ─────────────────
// Replaces the old day-by-day cumulative chart and the separate Weekly Focus
// Breakdown bar chart with one combined visualization.

interface WeekBucket {
  label: string
  ms: number
  // Set only when this week spans two calendar months AND the bucket is in
  // "calendar" mode — chronologically-ordered portions for the hover detail.
  crossMonth: { range: string; ms: number }[] | null
  // Hasn't started yet (today is before this week's Sunday) — distinct from a
  // completed week that legitimately totals 0. Drives both the trend line's
  // stop point and the WIP marker below.
  isFuture: boolean
  isCurrent: boolean
}

type WeekMode = 'calendar' | 'month-only'

function WeekModeDropdown({ mode, onChange, isDark }: {
  mode: WeekMode
  onChange: (m: WeekMode) => void
  isDark: boolean
}) {
  const [open, setOpen] = useState(false)
  const [hover, setHover] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const LABELS: Record<WeekMode, string> = { calendar: 'Calendar Weeks', 'month-only': 'This Month Only' }

  return (
    <div ref={ref} style={{ position: 'relative', flexShrink: 0 }}>
      <button
        onClick={() => setOpen(o => !o)}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{
          display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 20,
          fontSize: 9, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
          background: hover || open ? (isDark ? 'rgba(124,58,237,0.20)' : 'rgba(124,58,237,0.10)') : (isDark ? 'rgba(124,58,237,0.10)' : 'rgba(124,58,237,0.06)'),
          border: `0.5px solid ${isDark ? 'rgba(124,58,237,0.32)' : 'rgba(124,58,237,0.20)'}`,
          color: isDark ? '#c4b5fd' : '#7c3aed',
          transition: 'background 150ms ease',
        }}
      >
        {LABELS[mode]}
        <span style={{ fontSize: 8, lineHeight: 1, transition: 'transform 150ms ease', transform: open ? 'rotate(180deg)' : 'none' }}>▾</span>
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', right: 0, zIndex: 20, minWidth: 142,
          background: isDark ? 'rgba(20,11,46,0.99)' : '#ffffff',
          border: `0.5px solid ${isDark ? 'rgba(124,58,237,0.30)' : 'var(--xp-bdr2)'}`,
          borderRadius: 10, padding: 4,
          boxShadow: '0 10px 28px rgba(0,0,0,0.28)',
        }}>
          {(['calendar', 'month-only'] as const).map(m => (
            <button
              key={m}
              onClick={() => { onChange(m); setOpen(false) }}
              style={{
                display: 'block', width: '100%', textAlign: 'left', padding: '6px 8px', borderRadius: 6,
                fontSize: 9.5, fontWeight: m === mode ? 700 : 500, cursor: 'pointer', border: 'none',
                background: m === mode ? (isDark ? 'rgba(124,58,237,0.20)' : 'rgba(124,58,237,0.10)') : 'transparent',
                color: m === mode ? (isDark ? '#c4b5fd' : '#7c3aed') : (isDark ? 'rgba(226,232,240,0.85)' : 'var(--xp-txt)'),
              }}
            >
              {LABELS[m]}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function MonthlyWeeklyTrendChart({ weeks, isDark }: {
  weeks: WeekBucket[]
  isDark: boolean
}) {
  // Lazy initial value (not an effect) so the reduced-motion case never needs
  // a synchronous setState inside the effect below — it just skips starting
  // the animation loop when this is already 1.
  const [revealFrac, setRevealFrac] = useState(() => (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) ? 1 : 0)
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)
  const rafRef = useRef<number>(0)

  // Plays once per mount. The caller remounts this component (via a `key`
  // keyed to month+mode) to replay it on a month/mode switch instead of
  // resetting state from inside this effect.
  useEffect(() => {
    if (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const DURATION = 1100
    const start = performance.now()
    function tick(now: number) {
      const t = Math.min((now - start) / DURATION, 1)
      setRevealFrac(1 - Math.pow(1 - t, 3))
      if (t < 1) rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [])

  if (weeks.every(w => w.ms === 0)) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 180, flexDirection: 'column', gap: 8 }}>
        <span style={{ fontSize: 22 }}>📈</span>
        <p style={{ fontSize: 10, color: isDark ? 'rgba(148,163,184,0.50)' : 'var(--xp-txt3)' }}>No focus sessions this month</p>
      </div>
    )
  }

  const n = weeks.length
  const maxMs = Math.max(...weeks.map(w => w.ms), 1)
  const maxHours = maxMs / 3_600_000
  // Sensible 1-16h default range that grows to fit higher totals — never clips.
  const yMaxHours = Math.max(16, Math.ceil((maxHours * 1.15) / 2) * 2)
  const yMaxMs = yMaxHours * 3_600_000

  const W = 520, H = 220
  const PAD = { top: 52, bottom: 28, left: 32, right: 14 }
  const cW = W - PAD.left - PAD.right
  const cH = H - PAD.top - PAD.bottom
  const slotW = cW / n
  const barW = Math.min(Math.max(slotW * 0.44, 26), 60)
  const xCenter = (i: number) => PAD.left + i * slotW + slotW / 2
  const yPos = (ms: number) => PAD.top + cH - (ms / yMaxMs) * cH
  const baseY = PAD.top + cH
  // The trend line/points float above their bar's top rather than sitting on it.
  const LINE_GAP = 12

  const step = yMaxHours <= 16 ? 2 : yMaxHours <= 30 ? 5 : yMaxHours <= 60 ? 10 : 20
  const yTicks: number[] = []
  for (let h = step; h <= yMaxHours; h += step) yTicks.push(h)

  const peakIdx = weeks.reduce((best, w, i) => (w.ms > weeks[best].ms ? i : best), 0)
  const hasPeak = weeks[peakIdx].ms > 0

  function barFrac(i: number): number {
    const stagger = n > 1 ? 0.45 / n : 0
    const localStart = i * stagger
    const t = Math.max(0, Math.min((revealFrac - localStart) / Math.max(1 - localStart, 0.01), 1))
    return 1 - Math.pow(1 - t, 3)
  }

  // Last week that has actually begun — the trend line/points stop here, so a
  // month that's only just started never connects forward through weeks that
  // haven't happened yet (which would otherwise sit at 0 and read as "0 time").
  let lastActiveIdx = -1
  for (let i = 0; i < n; i++) if (!weeks[i].isFuture) lastActiveIdx = i

  const linePts = weeks.map((w, i) => ({ x: xCenter(i), y: yPos(w.ms) - LINE_GAP }))
  const activePts = lastActiveIdx >= 0 ? linePts.slice(0, lastActiveIdx + 1) : []

  // Per-segment horizontal-tangent cubic Bézier: each segment leaves its
  // start point and arrives at its end point moving horizontally, which
  // always produces a genuine flowing S-curve — including between just 2
  // points, where the earlier Catmull-Rom approach degenerated to a straight
  // diagonal (its clamped control points landed exactly on the line between
  // the two points). The points themselves stay at their exact data value;
  // this only shapes the line connecting them.
  function smoothPath(pts: { x: number; y: number }[]): string {
    if (pts.length < 2) return ''
    let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`
    for (let i = 0; i < pts.length - 1; i++) {
      const p1 = pts[i]
      const p2 = pts[i + 1]
      const midX = (p1.x + p2.x) / 2
      d += ` C ${midX.toFixed(1)} ${p1.y.toFixed(1)}, ${midX.toFixed(1)} ${p2.y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`
    }
    return d
  }
  const linePath = smoothPath(activePts)
  const gridCol = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'
  const txtCol  = isDark ? 'rgba(148,163,184,0.55)' : 'rgba(100,116,139,0.70)'

  return (
    <div style={{ position: 'relative' }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block', overflow: 'visible' }}>
        <defs>
          <linearGradient id="mfpWeekBar" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#a855f7" />
            <stop offset="100%" stopColor="#6d28d9" />
          </linearGradient>
          <clipPath id="mfpWeekLineClip">
            <rect x={0} y={0} width={W * revealFrac} height={H} />
          </clipPath>
        </defs>

        {yTicks.map(h => {
          const y = yPos(h * 3_600_000)
          return (
            <g key={h}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y} y2={y} stroke={gridCol} strokeWidth={1} />
              <text x={PAD.left - 6} y={y + 3} textAnchor="end" fontSize={7.5} fill={txtCol}>{h}h</text>
            </g>
          )
        })}
        <line x1={PAD.left} x2={W - PAD.right} y1={baseY} y2={baseY} stroke={isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.10)'} strokeWidth={1} />

        {/* Full-column hover hit areas */}
        {weeks.map((w, i) => (
          <rect key={`hit-${w.label}`} x={xCenter(i) - slotW / 2} y={PAD.top} width={slotW} height={cH} fill="transparent"
            style={{ cursor: 'pointer' }}
            onMouseEnter={() => setHoverIdx(i)} onMouseLeave={() => setHoverIdx(null)} />
        ))}

        {/* Bars — rise from the baseline, staggered left to right. Always
            fully opaque/solid — no hover-dim on the bar fill itself. */}
        {weeks.map((w, i) => {
          const frac = barFrac(i)
          const fullH = (w.ms / yMaxMs) * cH
          const barH = fullH * frac
          const x = xCenter(i) - barW / 2
          const y = baseY - barH
          return (
            <rect key={w.label} x={x} y={y} width={barW} height={Math.max(barH, 0)} rx={6}
              fill="url(#mfpWeekBar)" pointerEvents="none"
            />
          )
        })}

        {/* WIP — only the current (in-progress) week's bar, only when there's
            room for the stacked letters so it never overflows or collides. */}
        {weeks.map((w, i) => {
          if (!w.isCurrent) return null
          const fullBarH = (w.ms / yMaxMs) * cH
          const availH = fullBarH * barFrac(i)
          const LETTER_H = 11
          const totalH = 3 * LETTER_H
          if (availH < totalH + 10 || barW < 16) return null
          const startY = baseY - availH / 2 - totalH / 2 + LETTER_H * 0.78
          return (
            <g key={`wip-${w.label}`} pointerEvents="none" style={{ opacity: barFrac(i) > 0.85 ? 1 : 0, transition: 'opacity 200ms ease' }}>
              {['W', 'I', 'P'].map((l, li) => (
                <text key={l} x={xCenter(i)} y={startY + li * LETTER_H} textAnchor="middle" fontSize={9} fontWeight={800}
                  letterSpacing="0.04em" fill="rgba(255,255,255,0.88)">{l}</text>
              ))}
            </g>
          )
        })}

        {/* Trend line — wipes in left to right, stops at the last week that
            has actually begun (never drawn through future weeks). */}
        {activePts.length > 1 && (
          <g clipPath="url(#mfpWeekLineClip)">
            <path d={linePath} fill="none" stroke="#ef4444" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" pointerEvents="none" />
          </g>
        )}

        {/* Points + exact time labels + peak trophy — only for weeks that
            have begun; floating LINE_GAP above their bar's top. */}
        {weeks.map((w, i) => {
          if (w.isFuture) return null
          const activeN = lastActiveIdx + 1
          const threshold = activeN > 1 ? (i / (lastActiveIdx || 1)) * 0.92 : 0
          const visible = revealFrac >= threshold
          const p = linePts[i]
          return (
            <g key={w.label} pointerEvents="none" style={{ opacity: visible ? 1 : 0, transition: 'opacity 280ms ease' }}>
              <circle className="xp-mfp-week-point" cx={p.x} cy={p.y} r={5} fill={isDark ? '#1a1030' : '#ffffff'} stroke="#7c3aed" strokeWidth={2.5} />
              <text x={p.x} y={p.y - 11} textAnchor="middle" fontSize={8.5} fontWeight={700} fill="#7c3aed">
                {formatMs(w.ms)}
              </text>
              {hasPeak && i === peakIdx && (
                <text x={p.x} y={p.y - 23} textAnchor="middle" fontSize={11}>🏆</text>
              )}
            </g>
          )
        })}

        {weeks.map((w, i) => (
          <text key={`lbl-${w.label}`} x={xCenter(i)} y={baseY + 16} textAnchor="middle" fontSize={8.5} fontWeight={700}
            fill={isDark ? 'rgba(226,232,240,0.78)' : 'var(--xp-txt2)'} pointerEvents="none">
            {w.label}
          </text>
        ))}
      </svg>

      {/* Cross-month breakdown — only for weeks that straddle two months in Calendar Weeks mode */}
      {hoverIdx !== null && weeks[hoverIdx].crossMonth && (
        <div style={{
          position: 'absolute', left: `${(xCenter(hoverIdx) / W) * 100}%`, transform: 'translateX(-50%)',
          bottom: `${100 - (PAD.top / H) * 100 + 2}%`,
          background: isDark ? 'rgba(20,11,46,0.98)' : '#ffffff',
          border: `0.5px solid ${isDark ? 'rgba(124,58,237,0.35)' : 'var(--xp-bdr2)'}`,
          borderRadius: 10, padding: '6px 10px', boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
          fontSize: 9, whiteSpace: 'nowrap', zIndex: 5, pointerEvents: 'none',
        }}>
          <div style={{ fontWeight: 700, marginBottom: 2, color: isDark ? 'rgba(255,255,255,0.90)' : 'var(--xp-txt)' }}>
            {weeks[hoverIdx].label} — {formatMs(weeks[hoverIdx].ms)}
          </div>
          {weeks[hoverIdx].crossMonth!.map(part => (
            <div key={part.range} style={{ color: isDark ? 'rgba(203,213,225,0.75)' : 'var(--xp-txt2)' }}>
              {part.range} · {formatMs(part.ms)}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
// ─── Month/Year picker ────────────────────────────────────────────────────────

const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function MonthYearPicker({
  selectedMonth,
  onSelect,
  pickerRef,
}: {
  selectedMonth: number
  onSelect: (month: number) => void
  pickerRef: React.RefObject<HTMLDivElement | null>
}) {
  const realMonth = new Date().getMonth()
  const isPresent = selectedMonth === realMonth

  return (
    <div ref={pickerRef} className="xp-mfp-picker">
      <button
        className={`xp-mfp-picker-present${isPresent ? ' xp-mfp-picker-present-inactive' : ' xp-mfp-picker-present-active'}`}
        onClick={() => { if (!isPresent) onSelect(realMonth) }}
      >
        Present Month
      </button>
      <div className="xp-mfp-picker-year">
        <button className="xp-mfp-picker-year-btn" disabled aria-label="Previous year">‹</button>
        <span className="xp-mfp-picker-year-lbl">{APP_YEAR}</span>
        <button className="xp-mfp-picker-year-btn" disabled aria-label="Next year">›</button>
      </div>
      <div className="xp-mfp-picker-grid">
        {MONTH_ABBR.map((label, i) => (
          <button
            key={i}
            className={[
              'xp-mfp-picker-month',
              i === selectedMonth ? 'xp-mfp-picker-month-sel' : '',
              i === realMonth && i !== selectedMonth ? 'xp-mfp-picker-month-now' : '',
            ].filter(Boolean).join(' ')}
            onClick={() => onSelect(i)}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  )
}

// ─── MonthFullPage ────────────────────────────────────────────────────────────

interface MonthFullPageProps {
  month: number
  onClose: () => void
  onMonthDashboard?: (month: number) => void
  onDayDoubleClick?: (key: string, month: number, day: number) => void
  initialView?: 'calendar' | 'dashboard'
  // True when rendered inside another modal's own container (e.g. the
  // Analytics modal's "Monthly Dashboard" card) rather than as its own
  // full-viewport overlay: strips the backdrop/centering/max-size chrome so
  // the card fills whatever space its host gives it, skips this component's
  // own body-scroll-lock and self-close-on-Escape (the host already owns
  // both), and makes the dashboard-view Back control close straight back to
  // the host instead of toggling to this component's own calendar view.
  embedded?: boolean
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

export function MonthFullPage({ month, onClose, onDayDoubleClick, initialView, embedded = false }: MonthFullPageProps) {
  // Note: AppContext's flat `sessions` is deliberately NOT used here — see
  // allTaskSessions below for why calData is the authoritative source.
  const { calData, activities, isDark, progressColor: _rawColor2, setToast, calendarClean, setCalendarClean } = useApp()
  const progressColor = resolveProgressColor(_rawColor2, isDark)
  const [view, setView]               = useState<'calendar' | 'dashboard'>(initialView ?? 'calendar')
  const [currentMonth, setCurrentMonth] = useState(month)
  const [animType, setAnimType]        = useState<'fade' | 'right' | 'left'>('fade')
  const [pickerOpen, setPickerOpen]    = useState(false)
  const backBtnRef  = useRef<HTMLButtonElement>(null)
  const pickerRef   = useRef<HTMLDivElement>(null)
  const triggerRef  = useRef<HTMLButtonElement>(null)

  // Share panel state
  const [panelOpen, setPanelOpen]         = useState(false)
  const [panelAnim, setPanelAnim]         = useState(false)
  const [sharing, setSharing]             = useState(false)
  const [connectTarget, setConnectTarget] = useState<Platform | null>(null)

  // Modal Escape — closes MonthFullPage. Skipped when embedded: the host
  // (e.g. AnalyticsModal) owns its own Escape handling in that case.
  useEffect(() => {
    if (embedded) return
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, embedded])

  // Lock body scroll while modal is open (prevents background calendar from
  // scrolling through). Skipped when embedded: the host already locks it.
  useEffect(() => {
    if (embedded) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [embedded])

  // Back button focus fix: when returning from dashboard → calendar, the back button
  // retains focus from the prior tap. Blur it after the view settles.
  useEffect(() => {
    if (view === 'calendar') {
      const t = setTimeout(() => backBtnRef.current?.blur(), 50)
      return () => clearTimeout(t)
    }
  }, [view])

  // Picker: close on outside click/tap
  useEffect(() => {
    if (!pickerOpen) return
    function handler(e: Event) {
      const t = e.target as Node
      if (!pickerRef.current?.contains(t) && !triggerRef.current?.contains(t)) {
        setPickerOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    document.addEventListener('touchstart', handler)
    return () => {
      document.removeEventListener('mousedown', handler)
      document.removeEventListener('touchstart', handler)
    }
  }, [pickerOpen])

  // Picker: close on Escape (intercepts before modal Escape listener)
  useEffect(() => {
    if (!pickerOpen) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.stopImmediatePropagation(); setPickerOpen(false) }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [pickerOpen])

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

  function selectMonth(m: number) {
    if (m !== currentMonth) setAnimType(m > currentMonth ? 'right' : 'left')
    setCurrentMonth(m)
    setPickerOpen(false)
  }
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

  // The flat top-level `sessions` array (AppContext) is only ever written by
  // the global Clock In/Out button in AppHeader.tsx — Task Manager's own
  // per-task Start/Stop timer sessions are written straight into
  // calData[date].tasks[].sessions and never also call addSession(), so
  // `sessions` is NOT a complete record of a user's tracked time. calData is
  // the authoritative source (it's what DayDashboardModal/actBreakdown/
  // monthTaskStats/monthTopSessions already correctly read from) — this
  // flattens it ONCE, across every date on record (not just this month, so
  // a calendar week reaching into an adjacent month, or switching to a past
  // month, still aggregates from real data), for the computations below that
  // previously read the incomplete `sessions` array instead.
  const allTaskSessions = useMemo(() => {
    const result: { dateKey: string; startTs: number; endTs: number }[] = []
    for (const key of Object.keys(calData)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const day = calData[key] as any
      for (const task of (day?.tasks ?? [])) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for (const s of (task.sessions ?? []) as any[]) {
          if (s.endTs !== null) result.push({ dateKey: key, startTs: s.startTs, endTs: s.endTs })
        }
      }
    }
    return result
  }, [calData])

  const monthKeys = useMemo(() => {
    const s = new Set<string>()
    const td = new Date(APP_YEAR, currentMonth + 1, 0).getDate()
    for (let d = 1; d <= td; d++) s.add(dateKey(APP_YEAR, currentMonth, d))
    return s
  }, [currentMonth])

  const monthSessions = useMemo(
    () => allTaskSessions.filter(s => monthKeys.has(s.dateKey)),
    [allTaskSessions, monthKeys]
  )

  const totalMs = useMemo(
    () => monthSessions.reduce((sum, s) => sum + (s.endTs - s.startTs), 0),
    [monthSessions]
  )

  // ── Monthly Progress weekly buckets (Sunday→Saturday calendar weeks, with an
  //    optional "this month only" mode) — drives MonthlyWeeklyTrendChart below. ──

  const [weekMode, setWeekMode] = useState<WeekMode>('calendar')

  // Per-day totals across the user's ENTIRE session history (not just this
  // month) — calendar weeks at a month's start/end can reach into the
  // adjacent month, so this is the source of truth those days are summed from.
  const dailyMsMap = useMemo(() => {
    const map = new Map<string, number>()
    for (const s of allTaskSessions) {
      map.set(s.dateKey, (map.get(s.dateKey) ?? 0) + (s.endTs - s.startTs))
    }
    return map
  }, [allTaskSessions])

  const weeklyBuckets = useMemo((): WeekBucket[] => {
    const firstOfMonth = new Date(APP_YEAR, currentMonth, 1)
    const lastOfMonth   = new Date(APP_YEAR, currentMonth + 1, 0)
    const cursor = new Date(firstOfMonth)
    cursor.setDate(cursor.getDate() - cursor.getDay()) // back to that week's Sunday

    const dayMs = (d: Date) => dailyMsMap.get(dateKey(d.getFullYear(), d.getMonth(), d.getDate())) ?? 0
    const shortRange = (days: Date[]): string => {
      if (days.length === 1) return `${MONTH_ABBR[days[0].getMonth()]} ${days[0].getDate()}`
      const a = days[0], b = days[days.length - 1]
      return a.getMonth() === b.getMonth()
        ? `${MONTH_ABBR[a.getMonth()]} ${a.getDate()}–${b.getDate()}`
        : `${MONTH_ABBR[a.getMonth()]} ${a.getDate()}–${MONTH_ABBR[b.getMonth()]} ${b.getDate()}`
    }

    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const buckets: WeekBucket[] = []
    let weekNum = 1
    while (cursor <= lastOfMonth) {
      const weekStart = new Date(cursor)
      weekStart.setHours(0, 0, 0, 0)
      const weekEndIncl = new Date(weekStart)
      weekEndIncl.setDate(weekEndIncl.getDate() + 6)
      const isFuture  = weekStart > today
      const isCurrent = !isFuture && weekEndIncl >= today

      const inMonth: Date[] = [], before: Date[] = [], after: Date[] = []
      for (let i = 0; i < 7; i++) {
        const d = new Date(cursor)
        d.setDate(d.getDate() + i)
        if (d.getMonth() === currentMonth && d.getFullYear() === APP_YEAR) inMonth.push(d)
        else if (d < firstOfMonth) before.push(d)
        else after.push(d)
      }
      const inMonthMs = inMonth.reduce((s, d) => s + dayMs(d), 0)
      const beforeMs  = before.reduce((s, d) => s + dayMs(d), 0)
      const afterMs   = after.reduce((s, d) => s + dayMs(d), 0)

      const ms = weekMode === 'calendar' ? inMonthMs + beforeMs + afterMs : inMonthMs

      const spansTwoMonths = inMonth.length > 0 && inMonth.length < 7 && (before.length > 0 || after.length > 0)
      let crossMonth: WeekBucket['crossMonth'] = null
      if (weekMode === 'calendar' && spansTwoMonths) {
        const parts: { range: string; ms: number }[] = []
        if (before.length) parts.push({ range: shortRange(before), ms: beforeMs })
        if (inMonth.length) parts.push({ range: shortRange(inMonth), ms: inMonthMs })
        if (after.length) parts.push({ range: shortRange(after), ms: afterMs })
        crossMonth = parts
      }

      buckets.push({ label: `Week ${weekNum}`, ms, crossMonth, isFuture, isCurrent })
      weekNum++
      cursor.setDate(cursor.getDate() + 7)
    }
    return buckets
  }, [currentMonth, dailyMsMap, weekMode])

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

  // Pending Tasks — real, unfinished Task Manager records for the selected
  // month, oldest first. Same calData source as monthTaskStats above, so
  // completing/adding/removing a task here is reflected immediately.
  const pendingTasks = useMemo(() => {
    const result: { id: string; text: string; dateKey: string }[] = []
    for (const key of monthKeys) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const day = calData[key] as any
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const t of (day?.tasks ?? []) as any[]) {
        if (!t.done) result.push({ id: t.id, text: t.text, dateKey: key })
      }
    }
    return result.sort((a, b) => a.dateKey.localeCompare(b.dateKey))
  }, [calData, monthKeys])

  function fmtTaskDate(dk: string): string {
    const [y, m, d] = dk.split('-').map(Number)
    const dt = new Date(y, m - 1, d)
    const weekday = dt.toLocaleDateString('en-US', { weekday: 'long' })
    const monthDay = dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    return `${weekday} · ${monthDay}`
  }

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

  // ── Monthly KPI card data (days-worked remaining, vs-last-month deltas,
  //    peak time-of-day window) — all derived from the same calData/sessions
  //    this dashboard already uses, no new data sources. ──────────────────

  const daysRemaining = useMemo(() => {
    const now = new Date()
    const isCurrentCalMonth = now.getMonth() === currentMonth && now.getFullYear() === APP_YEAR
    if (!isCurrentCalMonth) return 0
    return Math.max(stats.totalDays - now.getDate(), 0)
  }, [currentMonth, stats.totalDays])

  // Previous calendar month's totals, for the "vs last month" sub-lines.
  // Resolves to zero/empty if that month has no data (e.g. before the user
  // started using XPadite) — the comparison line is simply omitted then,
  // rather than inventing a delta.
  const prevMonth = useMemo(() => {
    const pm = currentMonth === 0 ? 11 : currentMonth - 1
    const py = currentMonth === 0 ? APP_YEAR - 1 : APP_YEAR
    const td = new Date(py, pm + 1, 0).getDate()
    const pKeys = new Set<string>()
    for (let d = 1; d <= td; d++) pKeys.add(dateKey(py, pm, d))
    const pSessions = allTaskSessions.filter(s => pKeys.has(s.dateKey))
    const pTotalMs = pSessions.reduce((sum, s) => sum + (s.endTs - s.startTs), 0)
    return { totalMs: pTotalMs, sessionCount: pSessions.length }
  }, [allTaskSessions, currentMonth])

  // Peak Performance Time — buckets every completed session this month into
  // 2-hour time-of-day windows by its start hour, scores each bucket on BOTH
  // how often (frequency) and how long (accumulated duration) the user works
  // in it, then reports the single dominant window (merging an adjacent
  // bucket when it meaningfully contributes) plus, only when it's genuinely
  // comparable in strength, a second recurring window — never from one
  // unusually long session, since a lone session only ever contributes to
  // one bucket's score alongside every other session that month.
  const peakTime = useMemo(() => {
    const completed = monthSessions
    if (completed.length < 3) return null

    const BUCKET_HOURS = 2
    const NUM_BUCKETS = 24 / BUCKET_HOURS
    const counts = new Array(NUM_BUCKETS).fill(0) as number[]
    const durations = new Array(NUM_BUCKETS).fill(0) as number[]
    for (const s of completed) {
      const bucket = Math.floor(new Date(s.startTs).getHours() / BUCKET_HOURS)
      counts[bucket] += 1
      durations[bucket] += s.endTs - s.startTs
    }
    const maxCount = Math.max(...counts, 1)
    const maxDur   = Math.max(...durations, 1)
    const scores   = counts.map((c, i) => (c / maxCount) * 0.5 + (durations[i] / maxDur) * 0.5)
    const totalDur = durations.reduce((a, b) => a + b, 0)
    if (totalDur === 0) return null

    function fmtHour(h: number): string {
      const hh = ((h % 24) + 24) % 24
      const period = hh < 12 ? 'AM' : 'PM'
      let h12 = hh % 12
      if (h12 === 0) h12 = 12
      return `${h12} ${period}`
    }
    const windowLabel = (startBucket: number, endBucketExclusive: number) =>
      `${fmtHour(startBucket * BUCKET_HOURS)} – ${fmtHour(endBucketExclusive * BUCKET_HOURS)}`

    let topIdx = 0
    for (let i = 1; i < NUM_BUCKETS; i++) if (scores[i] > scores[topIdx]) topIdx = i
    if (scores[topIdx] === 0) return null

    const leftIdx  = topIdx > 0 ? topIdx - 1 : -1
    const rightIdx = topIdx < NUM_BUCKETS - 1 ? topIdx + 1 : -1
    let mergeIdx = -1
    if (leftIdx >= 0 && rightIdx >= 0) mergeIdx = scores[leftIdx] >= scores[rightIdx] ? leftIdx : rightIdx
    else if (leftIdx >= 0) mergeIdx = leftIdx
    else if (rightIdx >= 0) mergeIdx = rightIdx

    const used = new Set([topIdx])
    let winStart = topIdx, winEnd = topIdx + 1
    if (mergeIdx >= 0 && scores[mergeIdx] >= scores[topIdx] * 0.6) {
      used.add(mergeIdx)
      winStart = Math.min(topIdx, mergeIdx)
      winEnd   = Math.max(topIdx, mergeIdx) + 1
    }
    const window1Dur = Array.from(used).reduce((s, i) => s + durations[i], 0)

    let secondIdx = -1
    for (let i = 0; i < NUM_BUCKETS; i++) {
      if (used.has(i) || i === winStart - 1 || i === winEnd) continue
      if (secondIdx === -1 || scores[i] > scores[secondIdx]) secondIdx = i
    }
    const secondary = secondIdx >= 0 && scores[secondIdx] >= scores[topIdx] * 0.65
      ? windowLabel(secondIdx, secondIdx + 1)
      : null

    return {
      primary: windowLabel(winStart, winEnd),
      secondary,
      sharePct: Math.round((window1Dur / totalDur) * 100),
    }
  }, [monthSessions])

  const longestSession = monthTopSessions[0] ?? null
  const totalSessionCount = monthSessions.length
  const monthlyWinsTotal = stats.goalDays + stats.milestoneDays + stats.hyperDays + stats.productiveDays

  const stopProp = useCallback((e: React.MouseEvent) => e.stopPropagation(), [])
  const animName = animType === 'right' ? 'xp-from-right' : animType === 'left' ? 'xp-from-left' : 'xp-mfp-in'

  const S1  = isDark ? 'rgba(15,8,36,0.99)'  : '#ffffff'
  const S2  = isDark ? 'rgba(20,11,46,0.98)' : 'var(--xp-card)'
  const BDR = isDark ? 'rgba(124,58,237,0.22)' : 'rgba(0,0,0,0.09)'
  const card1: React.CSSProperties = { background: S1, border: `0.5px solid ${BDR}`, boxShadow: isDark ? '0 2px 20px rgba(0,0,0,0.42)' : '0 1px 10px rgba(0,0,0,0.07)' }
  const card2: React.CSSProperties = { background: S2, border: `0.5px solid ${BDR}`, boxShadow: isDark ? '0 2px 18px rgba(0,0,0,0.38)' : '0 1px 6px rgba(0,0,0,0.05)' }

  // Monthly Performance Badge reuses Today's Dashboard's existing badge system
  // (same artwork/animations/copy) rather than inventing a separate one —
  // monthScore is already a 0-100 score like Today's own task score, so the
  // same level/tier mapping applies directly.
  const monthLevel = getTaskPerformanceLevel(monthScore)
  const monthTier  = PERFORMANCE_TIERS[monthLevel]
  const firstName  = useDisplayFirstName()
  const [monthBadgeShine, setMonthBadgeShine] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setMonthBadgeShine(true), 900)
    return () => clearTimeout(t)
  }, [currentMonth])

  // Activity Breakdown reuses Today's Dashboard's DonutChart + legend/total-row
  // structure (imported above) — this is its own hover-index state since
  // DayDashboardModal's actHovIdx is local to that component.
  const [monthActHovIdx, setMonthActHovIdx] = useState<number | null>(null)

  return (
    <>
      <style>{MFP_STYLES}</style>
      <div
        className={embedded ? 'w-full h-full flex flex-col' : 'fixed inset-0 z-50 overflow-y-auto xp-mfp-overlay'}
        style={embedded ? undefined : { background: isDark ? 'rgba(0,0,0,0.82)' : 'rgba(15,23,42,0.60)' }}
      >
        <div className={embedded ? 'w-full h-full flex flex-col' : 'min-h-full flex items-center justify-center py-8 px-4 xp-mfp-wrap'}>
          <div
            className={embedded ? 'w-full h-full flex flex-col overflow-hidden' : 'w-full rounded-2xl xp-mfp-box'}
            style={embedded ? { background: 'var(--xp-card)' } : {
              maxWidth: 'min(86vw, 1280px)', background: 'var(--xp-card)',
              border: '0.5px solid rgba(124,58,237,0.30)', overflow: 'hidden',
              maxHeight: '92vh', display: 'flex', flexDirection: 'column',
              boxShadow: `0 24px 64px rgba(0,0,0,0.52), 0 0 80px 20px ${hexToRgba(progressColor, 0.10)}`,
            }}
            onClick={stopProp}
          >
            {/* ── Premium 3-column header ────────────────────────────────────── */}
            <div
              className={`xp-mfp-hdr${view === 'dashboard' ? ' xp-mfp-hdr-dash' : ''}`}
              style={{
                display: 'grid', gridTemplateColumns: '1fr auto 1fr',
                gap: 16, padding: '14px 20px',
                flexShrink: 0, zIndex: 10, position: 'relative',
                background: 'linear-gradient(135deg, #3b0764 0%, #7c3aed 50%, #6d28d9 100%)',
                borderBottom: '0.5px solid rgba(167,139,250,0.28)',
                boxShadow: '0 4px 20px rgba(0,0,0,0.30)',
                alignItems: 'center',
              }}
            >
              {/* Left: Back — arrow-only in dashboard view (all breakpoints) */}
              <div className="xp-mfp-hdr-l">
                <button
                  ref={backBtnRef}
                  onPointerUp={() => setTimeout(() => backBtnRef.current?.blur(), 0)}
                  onClick={view === 'dashboard' ? (embedded ? onClose : () => { setAnimType('fade'); setView('calendar') }) : onClose}
                  className={`xp-mfp-back${view === 'dashboard' ? ' xp-mfp-back-dash' : ''}`}
                  aria-label="Back"
                ><span className="xp-back-arrow">←</span><span className="xp-back-txt"> Back</span></button>
              </div>

              {/* Center: Month/Year dropdown trigger (+ Dashboard title in dashboard view) —
                  truly centered on the full header width in dashboard view, independent of
                  the Back control's width, via absolute centering (not flex/grid sharing). */}
              <div
                className={`xp-mfp-hdr-c${view === 'dashboard' ? ' xp-mfp-hdr-c-dash' : ''}`}
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}
              >
                {view === 'dashboard' && (
                  // Typography matched to Goal Manager's heading (18px/700/-0.02em/1.2)
                  <span style={{ fontSize: 18, fontWeight: 700, color: 'white', letterSpacing: '-0.02em', whiteSpace: 'nowrap', textShadow: '0 1px 4px rgba(0,0,0,0.30)', lineHeight: 1.2 }}>
                    Monthly Dashboard
                  </span>
                )}
                <button
                  ref={triggerRef}
                  className={`xp-mfp-month-trigger${view === 'dashboard' ? ' xp-mfp-month-trigger-sub' : ''}`}
                  onClick={() => setPickerOpen(p => !p)}
                  aria-expanded={pickerOpen}
                  aria-haspopup="listbox"
                >
                  {MONTHS[currentMonth]} {APP_YEAR}
                  <span className="xp-mfp-month-caret" aria-hidden="true">▾</span>
                </button>
              </div>

              {/* Month/Year picker — absolutely positioned below header, centered */}
              {pickerOpen && (
                <div className="xp-mfp-picker-wrap">
                  <MonthYearPicker
                    selectedMonth={currentMonth}
                    onSelect={selectMonth}
                    pickerRef={pickerRef}
                  />
                </div>
              )}

              {/* Right: Calendar toggle + Dashboard pill */}
              <div className="xp-mfp-hdr-r" style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 16 }}>
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

            {/* ── Scroll body — scrollbar clipped within modal rounded corners.
                 Embedded mode (desktop/tablet) switches to content-driven height
                 instead of always-internal-scroll, matching the host's (Analytics
                 modal's) own auto-height card so dimensions line up and there's no
                 dead space — mobile still scrolls internally within the host's
                 bounded viewport, same as DayDashboardModal's own split. ── */}
            <div
              className={embedded ? 'flex-1 overflow-y-auto sm:flex-none sm:overflow-visible' : undefined}
              style={embedded
                ? { minHeight: 0, WebkitOverflowScrolling: 'touch' } as React.CSSProperties
                : { flex: 1, overflowY: 'auto', minHeight: 0, overscrollBehavior: 'contain', WebkitOverflowScrolling: 'touch' } as React.CSSProperties}
            >

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
                  {/* ROW 1 — KPI area | (Performance Analytics + Performance Badge).
                      The KPI area now has 4 rows (6 cards + 2 separated cards) and is
                      naturally taller than gauge+badge need to be. items-stretch at this
                      outer level would force gauge/badge to stretch to match the KPI
                      column's height, which is exactly what produced the excess blank
                      space at their bottoms — so this level uses items-start instead,
                      and gauge+badge are grouped into their own nested grid (below) that
                      keeps items-stretch between just those two, so they still match
                      each other's bottom edge without being tied to the KPI column. */}
                  <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.52fr)_minmax(0,2.06fr)] items-stretch gap-3 lg:gap-4">

                    {/* LEFT: the 6 primary Monthly KPI cards (Today's Dashboard's exact
                        dimensions/spacing/3×2 placement) plus one compact combined card
                        underneath for Tasks Completed + Monthly Wins, sized to the space
                        naturally left over beneath the 6 cards — never under the gauge or
                        badge, since it lives inside this same KPI column. */}
                    <div className="flex flex-col gap-2">
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 content-start">
                      {([
                        {
                          label: 'Days Worked', icon: '📅',
                          value: `${stats.productiveDays}/${stats.totalDays}`,
                          sub: daysRemaining > 0 ? `${daysRemaining} day${daysRemaining === 1 ? '' : 's'} remaining` : null,
                          bg: isDark ? 'linear-gradient(135deg, #1E3A8A 0%, #1D4ED8 50%, #3B82F6 100%)' : 'linear-gradient(135deg, #2563EB 0%, #3B82F6 50%, #60A5FA 100%)',
                          border: isDark ? 'rgba(59,130,246,0.46)' : 'rgba(37,99,235,0.42)', glowRgb: '59,130,246',
                        },
                        {
                          label: 'Total Worked', icon: '⏱',
                          value: formatMs(totalMs),
                          sub: prevMonth.totalMs > 0
                            ? `${totalMs >= prevMonth.totalMs ? '↑' : '↓'} ${formatMs(Math.abs(totalMs - prevMonth.totalMs))} vs last month`
                            : null,
                          bg: isDark ? 'linear-gradient(135deg, #5B21B6 0%, #7E22CE 50%, #A21CAF 100%)' : 'linear-gradient(135deg, #7C3AED 0%, #A855F7 50%, #D946EF 100%)',
                          border: isDark ? 'rgba(162,28,175,0.46)' : 'rgba(126,34,206,0.45)', glowRgb: '167,139,250',
                        },
                        {
                          label: 'Longest Streak', icon: '🔗',
                          value: `${longestStreak} day${longestStreak === 1 ? '' : 's'}`,
                          sub: currentStreak > 0 ? `${currentStreak}d current` : null,
                          bg: isDark ? 'linear-gradient(135deg, #9D174D 0%, #BE185D 48%, #86198F 100%)' : 'linear-gradient(135deg, #DB2777 0%, #EC4899 48%, #C026D3 100%)',
                          border: isDark ? 'rgba(190,24,93,0.46)' : 'rgba(219,39,119,0.46)', glowRgb: '219,39,119',
                        },
                        {
                          label: 'Peak Performance Time', icon: '⏰',
                          value: peakTime?.primary ?? '—',
                          value2: peakTime?.secondary ?? null,
                          sub: !peakTime ? 'Not enough data yet' : !peakTime.secondary ? `${peakTime.sharePct}% of focused work` : null,
                          bg: isDark ? 'linear-gradient(135deg, #5B21B6 0%, #4338CA 52%, #1D4ED8 100%)' : 'linear-gradient(135deg, #7C3AED 0%, #6366F1 52%, #3B82F6 100%)',
                          border: 'rgba(99,102,241,0.46)', glowRgb: '99,102,241',
                        },
                        {
                          label: 'Longest Session', icon: <ProductiveDot color={progressColor} size={14} />,
                          value: longestSession ? formatMs(longestSession.durationMs) : '—',
                          sub: longestSession?.actName ?? null,
                          bg: isDark ? 'linear-gradient(135deg, #1D4ED8 0%, #0369A1 52%, #0891B2 100%)' : 'linear-gradient(135deg, #2563EB 0%, #0EA5E9 52%, #22D3EE 100%)',
                          border: isDark ? 'rgba(8,145,178,0.46)' : 'rgba(14,165,233,0.45)', glowRgb: '14,165,233',
                        },
                        {
                          label: 'Total Sessions', icon: '📋',
                          value: String(totalSessionCount),
                          sub: prevMonth.sessionCount > 0
                            ? `${totalSessionCount >= prevMonth.sessionCount ? '↑' : '↓'} ${Math.abs(totalSessionCount - prevMonth.sessionCount)} vs last month`
                            : null,
                          bg: isDark ? 'linear-gradient(135deg, #0E7490 0%, #0F766E 54%, #0D9488 100%)' : 'linear-gradient(135deg, #06B6D4 0%, #14B8A6 54%, #2DD4BF 100%)',
                          border: isDark ? 'rgba(13,148,136,0.46)' : 'rgba(20,184,166,0.44)', glowRgb: '20,184,166',
                        },
                      ] as { label: string; icon: React.ReactNode; value: string; value2?: string | null; sub: string | null; bg: string; border: string; glowRgb: string }[]).map(m => (
                        <div
                          key={m.label}
                          className="rounded-2xl flex flex-col relative overflow-hidden p-2.5 xp-kpi-card"
                          style={{ '--kpi-glow-rgb': m.glowRgb, background: m.bg, border: `0.5px solid ${m.border}`, minHeight: 100 } as React.CSSProperties}
                        >
                          {/* Glass sheen — smooth top highlight, same recipe as Today's Dashboard */}
                          <div style={{ position: 'absolute', inset: 0, borderRadius: 'inherit', pointerEvents: 'none', background: 'linear-gradient(165deg, rgba(255,255,255,0.22) 0%, rgba(255,255,255,0.06) 38%, rgba(255,255,255,0) 100%)' }} />
                          {/* Icon tile */}
                          <div style={{ width: 20, height: 20, borderRadius: 5, marginBottom: 5, flexShrink: 0, background: 'rgba(255,255,255,0.16)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: '#FFFFFF' }}>
                            {m.icon}
                          </div>
                          {/* Value(s) */}
                          <p className="text-base sm:text-lg font-bold leading-none tabular-nums mb-1" style={{ color: '#FFFFFF' }}>{m.value}</p>
                          {m.value2 && <p className="text-base sm:text-lg font-bold leading-none tabular-nums mb-1" style={{ color: '#FFFFFF' }}>{m.value2}</p>}
                          {/* Label */}
                          <p className="text-[8.5px] font-medium mt-auto leading-tight tracking-wide" style={{ color: 'rgba(255,255,255,0.72)' }}>{m.label}</p>
                          {/* Sub */}
                          {m.sub && <p className="text-[8px] mt-0.5 font-semibold" style={{ color: 'rgba(255,255,255,0.86)' }}>{m.sub}</p>}
                        </div>
                      ))}
                    </div>

                    {/* Tasks Completed + Monthly Wins — now two independent KPI cards
                        (previously one combined card with an internal divider), same
                        gap-2 used between the rows above, equal width via grid-cols-2. */}
                    <div className="grid grid-cols-2 gap-2">
                      {/* Tasks Completed */}
                      <div className="rounded-2xl flex flex-col justify-center relative overflow-hidden p-2.5 xp-kpi-card" style={{ '--kpi-glow-rgb': '34,197,94', background: isDark ? 'linear-gradient(135deg, #047857 0%, #15803D 52%, #4D7C0F 100%)' : 'linear-gradient(135deg, #059669 0%, #22C55E 52%, #84CC16 100%)', border: `0.5px solid ${isDark ? 'rgba(21,128,61,0.46)' : 'rgba(34,197,94,0.44)'}`, minHeight: 100 } as React.CSSProperties}>
                        <div style={{ position: 'absolute', inset: 0, borderRadius: 'inherit', pointerEvents: 'none', background: 'linear-gradient(165deg, rgba(255,255,255,0.22) 0%, rgba(255,255,255,0.06) 38%, rgba(255,255,255,0) 100%)' }} />
                        <p className="relative text-base sm:text-lg font-bold leading-none tabular-nums mb-1" style={{ color: '#FFFFFF' }}>{monthTaskStats.completedTasks}/{monthTaskStats.totalTasks}</p>
                        <p className="relative text-[8.5px] font-medium leading-tight tracking-wide" style={{ color: 'rgba(255,255,255,0.72)' }}>Tasks Completed</p>
                        {monthTaskStats.totalTasks > 0 && (
                          <p className="relative text-[8px] mt-0.5 font-semibold" style={{ color: 'rgba(255,255,255,0.86)' }}>
                            {Math.round((monthTaskStats.completedTasks / monthTaskStats.totalTasks) * 100)}% complete
                          </p>
                        )}
                      </div>
                      {/* Monthly Wins — breakdown arranged 2-up across the card's own width
                          instead of stacked, so it stays compact without extra height. */}
                      <div className="rounded-2xl flex flex-col justify-center relative overflow-hidden p-2.5 xp-kpi-card" style={{ '--kpi-glow-rgb': '245,158,11', background: isDark ? 'linear-gradient(135deg, #78350F 0%, #92400E 50%, #B45309 100%)' : 'linear-gradient(135deg, #D97706 0%, #F59E0B 50%, #FBBF24 100%)', border: `0.5px solid ${isDark ? 'rgba(180,83,9,0.46)' : 'rgba(217,119,6,0.44)'}`, minHeight: 100 } as React.CSSProperties}>
                        <div style={{ position: 'absolute', inset: 0, borderRadius: 'inherit', pointerEvents: 'none', background: 'linear-gradient(165deg, rgba(255,255,255,0.22) 0%, rgba(255,255,255,0.06) 38%, rgba(255,255,255,0) 100%)' }} />
                        <div className="relative flex items-baseline gap-1.5 mb-1">
                          <span className="text-base sm:text-lg font-bold leading-none tabular-nums" style={{ color: '#FFFFFF' }}>{monthlyWinsTotal}</span>
                          <span className="text-[8.5px] font-medium" style={{ color: 'rgba(255,255,255,0.72)' }}>Monthly Wins</span>
                        </div>
                        <div className="relative" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 8, rowGap: 2 }}>
                          {([
                            { icon: <ProductiveDot color="#ffffff" size={8} />, label: 'Productive Days', value: stats.productiveDays },
                            { icon: '🔥', label: 'Hyper Productive Days', value: stats.hyperDays },
                            { icon: '🏆', label: 'Milestones Achieved', value: stats.milestoneDays },
                            { icon: '🎯', label: 'Goals Accomplished', value: stats.goalDays },
                          ] as { icon: React.ReactNode; label: string; value: number }[]).map(row => (
                            <div key={row.label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 3, minWidth: 0, fontSize: 7.5, fontWeight: 700, color: 'rgba(255,255,255,0.90)' }}>
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 500, color: 'rgba(255,255,255,0.78)' }}>{row.icon} {row.label}</span>
                              <span style={{ flexShrink: 0 }}>{row.value}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                    </div>

                    {/* Gauge + Badge, grouped in their own 1.36fr/0.70fr grid so they
                        stretch to match each other; the outer row's own items-stretch
                        (restored above) then matches this whole wrapper's height to the
                        KPI column's, so all three bottoms land on the same line. */}
                    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.36fr)_minmax(0,0.70fr)] items-stretch gap-3 lg:gap-4">
                      {/* Performance Analytics Gauge — stretched (via the outer grid's
                          items-stretch, restored above) so its bottom aligns with the
                          KPI area's bottom; justify-center keeps the SVG (which is
                          width-driven and never distorted) vertically centered within
                          that stretched card instead of leaving blank space only below
                          it — same width/placement as Today's Dashboard's gauge card. */}
                      <div className="rounded-2xl overflow-hidden flex flex-col justify-center" style={{ background: isDark ? 'linear-gradient(145deg,rgba(16,7,44,0.99) 0%,rgba(7,3,18,0.99) 100%)' : 'var(--xp-card)', border: isDark ? '0.5px solid rgba(124,58,237,0.35)' : '0.5px solid var(--xp-bdr2)', boxShadow: isDark ? '0 4px 36px rgba(80,0,220,0.22),0 2px 16px rgba(0,0,0,0.55)' : '0 2px 12px rgba(0,0,0,0.08)', minHeight: 280 }}>
                        <GaugeMeter score={monthScore} />
                      </div>

                      {/* Monthly Performance Badge — the exact existing Today's Dashboard
                          badge system (AchievementBanner: same artwork, animations, glow
                          and copy pools), adapted to this month's context via
                          dateLabel/periodLabel rather than a separate invented badge. */}
                      <AchievementBanner
                        tier={monthTier}
                        level={monthLevel}
                        isDark={isDark}
                        firstName={firstName}
                        dateLabel={`${MONTHS[currentMonth]} ${APP_YEAR}`}
                        periodLabel={`${MONTHS[currentMonth]}'s`}
                        triggerShine={monthBadgeShine}
                      />
                    </div>
                  </div>

                  {/* ROW 2 — Monthly Progress (cumulative) | Activity Breakdown */}
                  <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.9fr)_minmax(0,1fr)] items-stretch gap-3 lg:gap-4">

                    {/* Monthly Progress — weekly bar + trend-line chart (replaces the old
                        day-by-day cumulative line and the separate Weekly Focus
                        Breakdown chart, which is now folded into this one view). */}
                    <div className="rounded-2xl p-4 sm:p-5 flex flex-col" style={card1}>
                      <div className="flex items-start justify-between flex-shrink-0 mb-2">
                        <div>
                          <p className="text-[11px] font-semibold tracking-wide" style={{ color: isDark ? 'rgba(255,255,255,0.88)' : 'var(--xp-txt)' }}>Monthly Progress</p>
                          <p className="text-[9px] mt-0.5" style={{ color: isDark ? 'rgba(148,163,184,0.5)' : 'var(--xp-txt3)' }}>Weekly focus time across {MONTHS[currentMonth]}</p>
                        </div>
                        {totalMs > 0 && (
                          <div className="text-right flex-shrink-0">
                            <p className="text-[14px] font-bold tabular-nums" style={{ color: '#a78bfa' }}>{formatMs(totalMs)}</p>
                            <p className="text-[9px]" style={{ color: isDark ? 'rgba(148,163,184,0.45)' : 'var(--xp-txt3)' }}>total</p>
                          </div>
                        )}
                      </div>
                      <div className="flex justify-end flex-shrink-0 mb-2">
                        <WeekModeDropdown mode={weekMode} onChange={setWeekMode} isDark={isDark} />
                      </div>
                      <div style={{ flex: 1, minHeight: 180 }}>
                        <MonthlyWeeklyTrendChart key={`${currentMonth}-${weekMode}`} weeks={weeklyBuckets} isDark={isDark} />
                      </div>
                    </div>

                    {/* Activity Breakdown — reuses Today's Dashboard's exact Activity
                        Distribution implementation (DonutChart + legend + total row,
                        imported from DayDashboardModal.tsx) rather than the old separate
                        ActivityPieChart, fed with this month's aggregated actBreakdown/
                        totalMs instead of a single day's. */}
                    <div className="rounded-2xl p-4 sm:p-5" style={card2}>
                      <p className="text-[11px] font-semibold tracking-wide mb-3" style={{ color: isDark ? 'rgba(255,255,255,0.88)' : 'var(--xp-txt)' }}>Activity Breakdown</p>
                      {actBreakdown.length > 0 ? (
                        <div className="flex flex-col items-center">
                          <DonutChart
                            segments={actBreakdown.map(a => ({ color: a.color, pct: totalMs > 0 ? a.ms / totalMs : 0, name: a.name, ms: a.ms }))}
                            size="lg"
                            hoveredIdx={monthActHovIdx}
                            onHoverIdx={setMonthActHovIdx}
                            animate
                          />
                          <div className="w-full mt-5">
                            {actBreakdown.map((a, i) => {
                              const isHov = monthActHovIdx === i
                              const pct = totalMs > 0 ? Math.round((a.ms / totalMs) * 100) : 0
                              return (
                                <div
                                  key={a.name}
                                  onMouseEnter={() => setMonthActHovIdx(i)}
                                  onMouseLeave={() => setMonthActHovIdx(null)}
                                  style={{
                                    display: 'grid',
                                    gridTemplateColumns: 'minmax(80px,1fr) 52px 32px',
                                    alignItems: 'center',
                                    gap: 4,
                                    marginBottom: 5,
                                    cursor: 'default',
                                    opacity: monthActHovIdx !== null && !isHov ? 0.5 : 1,
                                    transition: 'opacity 180ms ease',
                                  }}
                                >
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
                                    <div className="w-2 h-2 rounded-full flex-shrink-0"
                                      style={{ background: a.color, boxShadow: isHov ? `0 0 5px ${a.color}88` : 'none' }} />
                                    <span className="text-[9px] truncate"
                                      style={{ color: isHov ? (isDark ? 'rgba(255,255,255,0.95)' : 'var(--xp-txt)') : isDark ? 'rgba(203,213,225,0.78)' : 'var(--xp-txt2)', fontWeight: isHov ? 600 : 400 }}>
                                      {a.name}
                                    </span>
                                  </div>
                                  <span className="text-[9px] tabular-nums font-semibold text-right"
                                    style={{ color: isHov ? (isDark ? 'rgba(255,255,255,0.95)' : 'var(--xp-txt)') : isDark ? 'rgba(255,255,255,0.72)' : 'var(--xp-txt)' }}>
                                    {formatMs(a.ms)}
                                  </span>
                                  <span className="text-[8px] tabular-nums text-right"
                                    style={{ color: isDark ? 'rgba(148,163,184,0.5)' : 'var(--xp-txt3)' }}>
                                    {pct}%
                                  </span>
                                </div>
                              )
                            })}
                            <div style={{
                              display: 'grid', gridTemplateColumns: 'minmax(80px,1fr) 52px 32px',
                              alignItems: 'center', gap: 4, paddingTop: 6,
                              borderTop: isDark ? '0.5px solid rgba(255,255,255,0.07)' : '0.5px solid var(--xp-bdr)',
                            }}>
                              <span className="text-[9px] font-semibold"
                                style={{ color: isDark ? 'rgba(255,255,255,0.55)' : 'var(--xp-txt3)' }}>Total</span>
                              <span className="text-[9px] font-bold tabular-nums text-right"
                                style={{ color: isDark ? 'rgba(255,255,255,0.88)' : 'var(--xp-txt)' }}>
                                {formatMs(totalMs)}
                              </span>
                              <span className="text-[8px] tabular-nums text-right"
                                style={{ color: isDark ? 'rgba(148,163,184,0.5)' : 'var(--xp-txt3)' }}>
                                100%
                              </span>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center justify-center h-24">
                          <p className="text-[10px]" style={{ color: 'var(--xp-txt3)' }}>No activity data this month</p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* ROW 3 — Total Activities | Total Sessions | Pending Tasks */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 lg:gap-4">

                    {/* Total Activities — reuses Today's Dashboard's Task Breakdown
                        gradient-pill visual treatment (TASK_GRAD_STRINGS, imported
                        from DayDashboardModal.tsx), fed with this month's real
                        actBreakdown/totalMs instead of a single day's tasks. Bar
                        length is relative to the top activity (matching Task
                        Breakdown's own behavior); the displayed percentage stays
                        the activity's true share of the month's total time. */}
                    <div className="rounded-2xl p-3.5" style={card1}>
                      <p className="text-[11px] font-semibold tracking-wide mb-2.5" style={{ color: isDark ? 'rgba(255,255,255,0.88)' : 'var(--xp-txt)' }}>Total Activities</p>
                      {actBreakdown.length > 0 ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                          {actBreakdown.map((a, idx) => {
                            const gradStr  = TASK_GRAD_STRINGS[idx % TASK_GRAD_STRINGS.length]
                            const barPct   = Math.round((a.ms / (actBreakdown[0]?.ms ?? 1)) * 100)
                            const totalPct = totalMs > 0 ? Math.round((a.ms / totalMs) * 100) : 0
                            return (
                              <div key={a.name}>
                                <div className="h-2.5 rounded-full overflow-hidden mb-1.5"
                                  style={{ background: isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.06)' }}>
                                  <div className="h-full rounded-full"
                                    style={{
                                      width: `${barPct > 0 ? Math.max(barPct, 4) : 0}%`,
                                      background: gradStr,
                                      boxShadow: isDark ? '0 0 12px rgba(124,58,237,0.44), 0 1px 0 rgba(255,255,255,0.12) inset' : '0 1px 0 rgba(255,255,255,0.35) inset',
                                      transition: 'width 1300ms cubic-bezier(0.4, 0, 0.2, 1)',
                                    }} />
                                </div>
                                <div className="flex items-baseline justify-between gap-2">
                                  <span className="text-[9px] flex-1 min-w-0 leading-snug font-medium truncate" style={{ color: isDark ? 'rgba(203,213,225,0.88)' : 'var(--xp-txt)' }}>{a.name}</span>
                                  <div className="flex-shrink-0 flex items-baseline gap-0.5">
                                    <span className="text-[9.5px] font-bold tabular-nums leading-tight" style={{ color: isDark ? 'rgba(203,213,225,0.9)' : 'var(--xp-txt)' }}>{formatMs(a.ms)}</span>
                                    <span className="text-[8px] tabular-nums leading-tight" style={{ color: isDark ? 'rgba(148,163,184,0.5)' : 'var(--xp-txt3)' }}>({totalPct}%)</span>
                                  </div>
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

                    {/* Pending Tasks — real, unfinished Task Manager records for the
                        selected month (same calData source as monthTaskStats/
                        Tasks Completed elsewhere on this dashboard), oldest first.
                        Visibility/reminder only — no completion controls here;
                        actual task management stays in Task Manager. */}
                    <div className="rounded-2xl p-3.5 flex flex-col" style={{ ...card1, maxHeight: 240 }}>
                      <div className="flex items-center justify-between mb-2.5 flex-shrink-0">
                        <p className="text-[11px] font-semibold tracking-wide" style={{ color: isDark ? 'rgba(255,255,255,0.88)' : 'var(--xp-txt)' }}>Pending Tasks</p>
                        <span className="text-[8px] font-bold px-2 py-0.5 rounded-full" style={{ background: isDark ? 'rgba(124,58,237,0.16)' : 'rgba(124,58,237,0.07)', color: '#a78bfa', border: '0.5px solid rgba(124,58,237,0.26)' }}>
                          {pendingTasks.length} pending
                        </span>
                      </div>
                      {pendingTasks.length > 0 ? (
                        <div className="flex-1 min-h-0 overflow-y-auto" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                          {pendingTasks.map(t => (
                            <div key={t.id} style={{ paddingBottom: 6, borderBottom: isDark ? '0.5px solid rgba(255,255,255,0.05)' : '0.5px solid var(--xp-bdr)' }}>
                              <p className="text-[9.5px] font-medium leading-snug truncate" style={{ color: isDark ? 'rgba(226,232,240,0.90)' : 'var(--xp-txt)' }}>{t.text}</p>
                              <p className="text-[8px] mt-0.5" style={{ color: isDark ? 'rgba(148,163,184,0.5)' : 'var(--xp-txt3)' }}>{fmtTaskDate(t.dateKey)}</p>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="flex items-center justify-center h-20">
                          <p className="text-[10px]" style={{ color: 'var(--xp-txt3)' }}>No pending tasks this month</p>
                        </div>
                      )}
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
