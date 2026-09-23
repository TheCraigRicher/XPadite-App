'use client'

import { useState, useEffect } from 'react'
import { useApp } from './AppContext'
import { dateKey } from './utils'
import { addGalleryItem } from './GalleryModal'
import type { CalendarData, WorkSession } from './types'
import type { GalleryItem } from './GalleryModal'

// ─── Types ────────────────────────────────────────────────────────────────────

type DayMarker = 'milestone' | 'goal' | 'hyper' | 'productive'

export interface YearStats {
  productiveDays: number
  hyperDays: number
  goalDays: number
  milestoneDays: number
  totalHours: number
  totalHoursFormatted: string
  dayMap: Record<string, DayMarker>
}

// ─── Stats computation ────────────────────────────────────────────────────────

export function computeYearStats(
  calData: CalendarData,
  year: number,
  sessions: WorkSession[],
): YearStats {
  const prefix = `${year}-`
  let productiveDays = 0, hyperDays = 0, goalDays = 0, milestoneDays = 0
  const dayMap: Record<string, DayMarker> = {}

  for (const [key, day] of Object.entries(calData)) {
    if (!key.startsWith(prefix)) continue
    if (day.productive)  productiveDays++
    if (day.hyper)       hyperDays++
    if (day.goal)        goalDays++
    if (day.milestone)   milestoneDays++
    // Priority for calendar display: milestone > goal > hyper > productive
    if (day.milestone)       dayMap[key] = 'milestone'
    else if (day.goal)       dayMap[key] = 'goal'
    else if (day.hyper)      dayMap[key] = 'hyper'
    else if (day.productive) dayMap[key] = 'productive'
  }

  let totalMs = 0
  for (const s of sessions) {
    if (s.dateKey.startsWith(prefix) && s.endTs != null) {
      totalMs += s.endTs - s.startTs
    }
  }
  const totalHours = totalMs / 3_600_000
  const totalHoursFormatted =
    totalHours < 10 ? totalHours.toFixed(1) + 'h' : Math.round(totalHours) + 'h'

  return { productiveDays, hyperDays, goalDays, milestoneDays, totalHours, totalHoursFormatted, dayMap }
}

// ─── Platforms ────────────────────────────────────────────────────────────────

interface Platform {
  id: string
  label: string
  sublabel?: string
  color: string
  bg: string
  abbr: string
}

const PLATFORMS: Platform[] = [
  { id: 'ig-story', label: 'Instagram', sublabel: 'Story', color: '#fff', bg: 'linear-gradient(135deg,#f09433,#e6683c,#dc2743,#cc2366,#bc1888)', abbr: 'IG' },
  { id: 'ig-post',  label: 'Instagram', sublabel: 'Post',  color: '#fff', bg: 'linear-gradient(135deg,#f09433,#e6683c,#dc2743,#cc2366,#bc1888)', abbr: 'IG' },
  { id: 'fb-post',  label: 'Facebook',  sublabel: 'Post',  color: '#fff', bg: '#1877F2',  abbr: 'f'  },
  { id: 'linkedin', label: 'LinkedIn',  sublabel: 'Post',  color: '#fff', bg: '#0A66C2',  abbr: 'in' },
  { id: 'x',        label: 'X',         sublabel: 'Post',  color: '#fff', bg: '#000000',  abbr: 'X'  },
  { id: 'tiktok',   label: 'TikTok',                       color: '#fff', bg: '#010101',  abbr: 'TT' },
  { id: 'snapchat', label: 'Snapchat',                     color: '#000', bg: '#FFFC00',  abbr: 'SC' },
  { id: 'whatsapp', label: 'WhatsApp',                     color: '#fff', bg: '#25D366',  abbr: 'WA' },
]

// ─── Mobile / PWA detection ──────────────────────────────────────────────────

function isMobileOrPWA(): boolean {
  if (typeof window === 'undefined') return false
  // Installed PWA on any device
  if (window.matchMedia?.('(display-mode: standalone)').matches) return true
  // Mobile browser
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
}

// ─── Platform desktop destinations ───────────────────────────────────────────

const PLATFORM_DESTINATIONS: Record<string, { url: string; name: string }> = {
  'ig-story':  { url: 'https://www.instagram.com/',             name: 'Instagram'  },
  'ig-post':   { url: 'https://www.instagram.com/',             name: 'Instagram'  },
  'fb-post':   { url: 'https://www.facebook.com/',              name: 'Facebook'   },
  'linkedin':  { url: 'https://www.linkedin.com/feed/',         name: 'LinkedIn'   },
  'x':         { url: 'https://x.com/intent/post',              name: 'X'          },
  'tiktok':    { url: 'https://www.tiktok.com/upload',          name: 'TikTok'     },
  'snapchat':  { url: 'https://web.snapchat.com/',              name: 'Snapchat'   },
  'whatsapp':  { url: 'https://web.whatsapp.com/',              name: 'WhatsApp'   },
}

// ─── Reusable share executor (works for Year + Month Progress) ────────────────
//
// Accepts the pre-generated JPEG File and the selected platform ID.
// On mobile/PWA: tries native OS file share; falls back to download on failure.
// On desktop: downloads the JPG, opens the platform website, toasts instructions.
// Returns 'shared' | 'downloaded' | 'cancelled' so the caller can decide whether
// to close the share panel.

export async function executeXpaditeShare(
  file: File,
  platformId: string,
  setToast: (msg: string) => void,
): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const dest = PLATFORM_DESTINATIONS[platformId]

  if (isMobileOrPWA() && navigator.share) {
    // Mobile / PWA path — prefer native file sharing
    const canShareFile = navigator.canShare?.({ files: [file] }) ?? false
    if (canShareFile) {
      try {
        await navigator.share({ files: [file], title: 'Xpadite Year Progress' })
        return 'shared'
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') return 'cancelled'
        // Other error → fall through to download fallback below
      }
    }
    // Mobile but file sharing unsupported — download + clear message
    triggerDownloadFromFile(file)
    setToast('JPG downloaded — open it to share manually')
    return 'downloaded'
  }

  // Desktop path — download + open platform + instruct user
  triggerDownloadFromFile(file)
  if (dest) {
    window.open(dest.url, '_blank', 'noopener,noreferrer')
    setToast(
      `Downloaded ✓ — select ${file.name} from Downloads to post on ${dest.name}`,
    )
  } else {
    setToast(`Downloaded ✓ — ${file.name}`)
  }
  return 'downloaded'
}

function triggerDownloadFromFile(file: File) {
  const url = URL.createObjectURL(file)
  const a   = document.createElement('a')
  a.href     = url
  a.download = file.name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}

// Silent background storage — fires only when the user has already connected
// Google Drive via Xpadite's sync settings. No-op if Drive is not connected.
// Architecture is reusable for Year and Month reports via the folderPath parameter.
// Drive failure cannot propagate to the share flow (callers use .catch(() => {})).
async function silentDriveSync(
  _uri: string,
  _filename: string,
  _folderPath: string,
): Promise<void> {
  // Hooks into Xpadite's existing Google Drive sync infrastructure when connected.
  // No-op until Drive sync is wired in Settings — no prompts, no UI, no interruption.
}

// ─── Canvas helpers ───────────────────────────────────────────────────────────

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload  = () => resolve(img)
    img.onerror = reject
    img.src     = src
  })
}

function drawRoundRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + r)
  ctx.lineTo(x + w, y + h - r)
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  ctx.lineTo(x + r, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - r)
  ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
}

// ─── Canvas card generation ───────────────────────────────────────────────────

export async function generateYearShareCardDataUri(
  calData: CalendarData,
  year: number,
  sessions: WorkSession[],
  format: 'jpeg' | 'png' = 'jpeg',
): Promise<string> {
  const CW      = 1080
  const PAD     = 44
  const SYS     = '-apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif'
  const PURPLE  = '#7c3aed'
  const WHITE   = '#ffffff'
  const CARD_BG = '#faf9fd'

  const stats = computeYearStats(calData, year, sessions)

  // ── Layout constants ──
  const LOGO_SIZE   = 68
  const KPI_H       = 92
  const KPI_BOX_GAP = 12
  const KPI_BOX_W   = (CW - 2 * PAD - 4 * KPI_BOX_GAP) / 5  // ~188.8
  const FOOT_LOGO   = 44

  const M_COLS  = 4
  const M_GAP_X = 10
  const M_GAP_Y = 14
  const MONTH_W = (CW - 2 * PAD - (M_COLS - 1) * M_GAP_X) / M_COLS  // ~240.5
  const CELL_W  = MONTH_W / 7                                          // ~34.4
  const CELL_H  = 20
  const M_HDR_H = 20
  const M_DOW_H = 16
  const MONTH_H = M_HDR_H + M_DOW_H + 6 * CELL_H + 4                  // 160
  const LEG_H   = 64

  // ── Pre-calculated y positions ──
  const logoY            = 46
  const brandBaseY       = 156
  const taglineBaseY     = 183
  const dividerY         = 205
  const headlineBaseY    = 249
  const sublineBaseY     = 291
  const kpiY             = 323
  const calY             = 453
  const legendY          = calY + 3 * (MONTH_H + M_GAP_Y) - M_GAP_Y + 26
  const footerDivY       = legendY + LEG_H + 22
  const footerLogoY      = footerDivY + 26
  const footerBrandBaseY = footerLogoY + FOOT_LOGO + 28
  const footerLine1BaseY = footerBrandBaseY + 30
  const footerLine2BaseY = footerLine1BaseY + 22
  const CH               = footerLine2BaseY + 42

  // ── Canvas ──
  const canvas = document.createElement('canvas')
  canvas.width  = CW
  canvas.height = CH
  const ctx = canvas.getContext('2d')!

  ctx.fillStyle = WHITE
  ctx.fillRect(0, 0, CW, CH)

  ctx.fillStyle = PURPLE
  ctx.fillRect(0, 0, CW, 5)

  // ── Load logo once, reuse in footer ──
  let logoImg: HTMLImageElement | null = null
  try { logoImg = await loadImage('/logo-icon.png') } catch { logoImg = null }

  function drawLogoOrFallback(x: number, y: number, size: number) {
    if (logoImg) {
      ctx.drawImage(logoImg, x, y, size, size)
    } else {
      ctx.fillStyle = PURPLE
      ctx.beginPath()
      ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  drawLogoOrFallback((CW - LOGO_SIZE) / 2, logoY, LOGO_SIZE)

  ctx.textAlign    = 'center'
  ctx.textBaseline = 'alphabetic'

  // ── Brand name ──
  ctx.fillStyle = '#0d0d14'
  ctx.font      = `bold 36px ${SYS}`
  ctx.fillText('Xpadite', CW / 2, brandBaseY)

  // ── Tagline ──
  ctx.fillStyle = 'rgba(0,0,0,0.40)'
  ctx.font      = `11px ${SYS}`
  ctx.fillText('PLAN  •  TRACK  •  STAY CONSISTENT  •  ACHIEVE YOUR GOALS', CW / 2, taglineBaseY)

  // ── Short divider ──
  ctx.strokeStyle = 'rgba(0,0,0,0.09)'
  ctx.lineWidth   = 1
  ctx.beginPath()
  ctx.moveTo(CW / 2 - 200, dividerY); ctx.lineTo(CW / 2 + 200, dividerY)
  ctx.stroke()

  // ── "My [YEAR] Year Progress" — purple year ──
  ctx.font = `bold 46px ${SYS}`
  const p1  = 'My ', pYr = String(year), p2 = ' Year Progress'
  const pw1 = ctx.measureText(p1).width
  const pwY = ctx.measureText(pYr).width
  const pw2 = ctx.measureText(p2).width
  let hx    = (CW - pw1 - pwY - pw2) / 2
  ctx.textAlign = 'left'
  ctx.fillStyle = '#0d0d14'; ctx.fillText(p1,  hx, headlineBaseY); hx += pw1
  ctx.fillStyle = PURPLE;    ctx.fillText(pYr, hx, headlineBaseY); hx += pwY
  ctx.fillStyle = '#0d0d14'; ctx.fillText(p2,  hx, headlineBaseY)
  ctx.textAlign = 'center'

  // ── Subline ──
  ctx.fillStyle = 'rgba(0,0,0,0.45)'
  ctx.font      = `16px ${SYS}`
  ctx.fillText('Small steps. Big results.', CW / 2, sublineBaseY)

  // ── KPI cards — horizontal: icon LEFT · number + label RIGHT ──
  type KpiItem =
    | { type: 'productive'; value: string; label: string }
    | { type: 'emoji'; emoji: string; value: string; label: string }

  const KPI_ITEMS: KpiItem[] = [
    { type: 'productive',                              value: String(stats.productiveDays), label: 'Productive Days'       },
    { type: 'emoji', emoji: '🔥', value: String(stats.hyperDays),     label: 'Hyper Productive Days' },
    { type: 'emoji', emoji: '🎯', value: String(stats.goalDays),       label: 'Goals Achieved'        },
    { type: 'emoji', emoji: '🏆', value: String(stats.milestoneDays),  label: 'Milestones'            },
    { type: 'emoji', emoji: '⏱',  value: stats.totalHoursFormatted,   label: 'Total Hours'           },
  ]

  KPI_ITEMS.forEach((s, i) => {
    const bx     = PAD + i * (KPI_BOX_W + KPI_BOX_GAP)
    const iconCX = bx + 36
    const iconCY = kpiY + KPI_H / 2
    const textX  = bx + 64

    ctx.fillStyle   = 'rgba(0,0,0,0.02)'
    drawRoundRect(ctx, bx, kpiY, KPI_BOX_W, KPI_H, 12)
    ctx.fill()
    ctx.strokeStyle = 'rgba(0,0,0,0.09)'
    ctx.lineWidth   = 0.75
    drawRoundRect(ctx, bx, kpiY, KPI_BOX_W, KPI_H, 12)
    ctx.stroke()

    ctx.textBaseline = 'middle'
    if (s.type === 'productive') {
      const iconR = 18
      ctx.fillStyle = PURPLE
      ctx.beginPath(); ctx.arc(iconCX, iconCY, iconR, 0, Math.PI * 2); ctx.fill()
      ctx.strokeStyle = WHITE
      ctx.lineWidth   = 2.5
      ctx.beginPath(); ctx.arc(iconCX, iconCY, iconR + 1.5, 0, Math.PI * 2); ctx.stroke()
      ctx.strokeStyle = 'rgba(124,58,237,0.65)'
      ctx.lineWidth   = 2
      ctx.beginPath(); ctx.arc(iconCX, iconCY, iconR + 4, 0, Math.PI * 2); ctx.stroke()
    } else {
      ctx.font = `28px serif`
      ctx.textAlign = 'center'
      ctx.fillText(s.emoji, iconCX, iconCY)
    }

    ctx.fillStyle    = '#0d0d14'
    ctx.font         = `bold 22px ${SYS}`
    ctx.textAlign    = 'left'
    ctx.textBaseline = 'alphabetic'
    ctx.fillText(s.value, textX, kpiY + 50)
    ctx.fillStyle = 'rgba(0,0,0,0.48)'
    ctx.font      = `9px ${SYS}`
    ctx.fillText(s.label, textX, kpiY + 68)
  })
  ctx.textBaseline = 'alphabetic'

  // ── 12-month calendar grid — 4 cols × 3 rows with ghost dates ──
  const FULL_MONTHS = [
    'January','February','March','April',
    'May','June','July','August',
    'September','October','November','December',
  ]
  const DOW_LABELS = ['Su','Mo','Tu','We','Th','Fr','Sa']

  for (let m = 0; m < 12; m++) {
    const col = m % M_COLS
    const row = Math.floor(m / M_COLS)
    const mx  = PAD + col * (MONTH_W + M_GAP_X)
    const my  = calY + row * (MONTH_H + M_GAP_Y)

    ctx.fillStyle = CARD_BG
    drawRoundRect(ctx, mx, my, MONTH_W, MONTH_H, 8)
    ctx.fill()
    ctx.strokeStyle = 'rgba(0,0,0,0.07)'
    ctx.lineWidth   = 0.5
    drawRoundRect(ctx, mx, my, MONTH_W, MONTH_H, 8)
    ctx.stroke()

    // Month name — left aligned, bold
    ctx.fillStyle    = '#111111'
    ctx.font         = `bold 11px ${SYS}`
    ctx.textAlign    = 'left'
    ctx.textBaseline = 'alphabetic'
    ctx.fillText(FULL_MONTHS[m], mx + 8, my + 13)

    // Day-of-week headers — Su in orange
    for (let d = 0; d < 7; d++) {
      ctx.fillStyle = d === 0 ? '#f97316' : 'rgba(0,0,0,0.35)'
      ctx.font      = `8px ${SYS}`
      ctx.textAlign = 'center'
      ctx.fillText(DOW_LABELS[d], mx + d * CELL_W + CELL_W / 2, my + M_HDR_H + 11)
    }

    // Build 42-cell grid matching MonthCard's logic
    const firstDay      = new Date(year, m, 1).getDay()
    const daysInMonth   = new Date(year, m + 1, 0).getDate()
    const prevMonthDays = new Date(year, m, 0).getDate()

    for (let slot = 0; slot < 42; slot++) {
      const colD = slot % 7
      const rowD = Math.floor(slot / 7)
      const cx   = mx + colD * CELL_W + CELL_W / 2
      const cy   = my + M_HDR_H + M_DOW_H + rowD * CELL_H + CELL_H / 2

      let day: number
      let isGhost: boolean

      if (slot < firstDay) {
        day     = prevMonthDays - (firstDay - 1 - slot)
        isGhost = true
      } else if (slot < firstDay + daysInMonth) {
        day     = slot - firstDay + 1
        isGhost = false
      } else {
        day     = slot - firstDay - daysInMonth + 1
        isGhost = true
      }

      ctx.textAlign    = 'center'
      ctx.textBaseline = 'middle'

      if (isGhost) {
        ctx.fillStyle = colD === 0 ? 'rgba(249,115,22,0.22)' : 'rgba(0,0,0,0.20)'
        ctx.font      = `${Math.round(CELL_H * 0.40)}px ${SYS}`
        ctx.fillText(String(day), cx, cy)
        continue
      }

      const key    = dateKey(year, m, day)
      const mark   = stats.dayMap[key]
      const r      = CELL_H * 0.38               // ~7.6 — productive circle radius
      const numFs  = Math.round(CELL_H * 0.40)   // ~8  — regular day number
      const mNumFs = Math.round(CELL_H * 0.34)   // ~7  — number alongside emoji

      if (mark === 'productive') {
        // Filled purple circle + white gap ring + outer purple ring (matches MonthCard CSS box-shadow)
        ctx.fillStyle = PURPLE
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill()
        ctx.strokeStyle = CARD_BG
        ctx.lineWidth   = 2
        ctx.beginPath(); ctx.arc(cx, cy, r + 1.5, 0, Math.PI * 2); ctx.stroke()
        ctx.strokeStyle = 'rgba(124,58,237,0.68)'
        ctx.lineWidth   = 1.8
        ctx.beginPath(); ctx.arc(cx, cy, r + 3.5, 0, Math.PI * 2); ctx.stroke()
        ctx.fillStyle = WHITE
        ctx.font      = `bold ${numFs}px ${SYS}`
        ctx.fillText(String(day), cx, cy)

      } else if (mark === 'hyper') {
        // 🔥 centered, day number below (matches MonthCard top:65%)
        ctx.font = `${Math.round(CELL_H * 0.80)}px serif`
        ctx.fillText('🔥', cx, cy - 1)
        ctx.fillStyle = '#0a0a0a'
        ctx.font      = `bold ${mNumFs}px ${SYS}`
        ctx.fillText(String(day), cx, cy + Math.round(CELL_H * 0.32))

      } else if (mark === 'milestone') {
        // 🏆 centered, day number above (matches MonthCard top:37%)
        ctx.font = `${Math.round(CELL_H * 0.70)}px serif`
        ctx.fillText('🏆', cx, cy + 2)
        ctx.fillStyle = '#0a0a0a'
        ctx.font      = `bold ${mNumFs}px ${SYS}`
        ctx.fillText(String(day), cx, cy - Math.round(CELL_H * 0.28))

      } else if (mark === 'goal') {
        // 🎯 slightly above center, day number slightly below (matches MonthCard top:44%/52%)
        ctx.font = `${Math.round(CELL_H * 0.85)}px serif`
        ctx.fillText('🎯', cx, cy - 1)
        ctx.fillStyle = '#000000'
        ctx.font      = `bold ${mNumFs}px ${SYS}`
        ctx.fillText(String(day), cx - 1, cy + Math.round(CELL_H * 0.26))

      } else {
        ctx.fillStyle = colD === 0 ? 'rgba(249,115,22,0.75)' : 'rgba(0,0,0,0.55)'
        ctx.font      = `${numFs}px ${SYS}`
        ctx.fillText(String(day), cx, cy)
      }
    }
  }
  ctx.textBaseline = 'alphabetic'

  // ── Legend — enclosed rounded container ──
  ctx.fillStyle   = 'rgba(0,0,0,0.02)'
  drawRoundRect(ctx, PAD, legendY, CW - 2 * PAD, LEG_H, 12)
  ctx.fill()
  ctx.strokeStyle = 'rgba(0,0,0,0.07)'
  ctx.lineWidth   = 0.75
  drawRoundRect(ctx, PAD, legendY, CW - 2 * PAD, LEG_H, 12)
  ctx.stroke()

  type LegItem =
    | { type: 'productive'; label: string }
    | { type: 'emoji'; emoji: string; label: string }

  const LEG_ITEMS: LegItem[] = [
    { type: 'productive',                label: 'Productive Day'      },
    { type: 'emoji', emoji: '🔥', label: 'Hyper Productive Day' },
    { type: 'emoji', emoji: '🎯', label: 'Goal Achieved'        },
    { type: 'emoji', emoji: '🏆', label: 'Milestone'            },
  ]
  const legSlotW = (CW - 2 * PAD) / 4
  const legCY    = legendY + LEG_H / 2
  const legR     = 7

  ctx.font         = `11px ${SYS}`
  ctx.textBaseline = 'middle'

  LEG_ITEMS.forEach((item, i) => {
    const slotCX = PAD + i * legSlotW + legSlotW / 2
    const labelW = ctx.measureText(item.label).width
    const iconW  = item.type === 'productive' ? legR * 2 + 10 : 18
    const gap    = 6
    const groupW = iconW + gap + labelW
    const iconCX = slotCX - groupW / 2 + iconW / 2
    const textX  = slotCX - groupW / 2 + iconW + gap

    if (item.type === 'productive') {
      ctx.fillStyle = PURPLE
      ctx.beginPath(); ctx.arc(iconCX, legCY, legR, 0, Math.PI * 2); ctx.fill()
      ctx.strokeStyle = WHITE
      ctx.lineWidth   = 1.5
      ctx.beginPath(); ctx.arc(iconCX, legCY, legR + 1.2, 0, Math.PI * 2); ctx.stroke()
      ctx.strokeStyle = 'rgba(124,58,237,0.65)'
      ctx.lineWidth   = 1.2
      ctx.beginPath(); ctx.arc(iconCX, legCY, legR + 3, 0, Math.PI * 2); ctx.stroke()
    } else {
      ctx.font = `14px serif`
      ctx.textAlign = 'center'
      ctx.fillText(item.emoji, iconCX, legCY)
      ctx.font = `11px ${SYS}`
    }

    ctx.fillStyle = 'rgba(0,0,0,0.68)'
    ctx.font      = `11px ${SYS}`
    ctx.textAlign = 'left'
    ctx.fillText(item.label, textX, legCY)
  })

  ctx.textBaseline = 'alphabetic'
  ctx.textAlign    = 'center'

  // ── Footer divider ──
  ctx.strokeStyle = 'rgba(0,0,0,0.08)'
  ctx.lineWidth   = 1
  ctx.beginPath()
  ctx.moveTo(PAD + 40, footerDivY); ctx.lineTo(CW - PAD - 40, footerDivY)
  ctx.stroke()

  // ── Footer: logo + brand + tagline + motto ──
  drawLogoOrFallback((CW - FOOT_LOGO) / 2, footerLogoY, FOOT_LOGO)

  ctx.fillStyle = '#111111'
  ctx.font      = `bold 22px ${SYS}`
  ctx.fillText('Xpadite', CW / 2, footerBrandBaseY)

  ctx.fillStyle = 'rgba(0,0,0,0.52)'
  ctx.font      = `13px ${SYS}`
  ctx.fillText('Expedite your Productivity with Xpadite', CW / 2, footerLine1BaseY)

  // "A MORE PRODUCTIVE YOU" with decorative flanking lines
  ctx.font = `bold 10px ${SYS}`
  const motto  = 'A MORE PRODUCTIVE YOU'
  const mottoW = ctx.measureText(motto).width
  const lineLen = 44
  const lineY   = footerLine2BaseY - 3
  ctx.strokeStyle = 'rgba(124,58,237,0.30)'
  ctx.lineWidth   = 1
  ctx.beginPath()
  ctx.moveTo(CW / 2 - mottoW / 2 - 12 - lineLen, lineY)
  ctx.lineTo(CW / 2 - mottoW / 2 - 12, lineY)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(CW / 2 + mottoW / 2 + 12, lineY)
  ctx.lineTo(CW / 2 + mottoW / 2 + 12 + lineLen, lineY)
  ctx.stroke()
  ctx.fillStyle = 'rgba(124,58,237,0.55)'
  ctx.fillText(motto, CW / 2, footerLine2BaseY)

  return format === 'jpeg'
    ? canvas.toDataURL('image/jpeg', 0.92)
    : canvas.toDataURL('image/png')
}

// ─── Platform badge ───────────────────────────────────────────────────────────

function PlatformBadge({ p }: { p: Platform }) {
  return (
    <div
      style={{
        width: 36, height: 36, borderRadius: 10,
        background: p.bg,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: p.color,
        fontWeight: 700,
        fontSize: p.abbr.length > 1 ? 11 : 16,
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        flexShrink: 0,
      }}
    >
      {p.abbr}
    </div>
  )
}

// ─── Year Share Modal ─────────────────────────────────────────────────────────

export function YearShareModal({ year, onClose }: { year: number; onClose: () => void }) {
  const { calData, sessions, setToast } = useApp()
  const [sharing, setSharing]     = useState(false)
  const [panelAnim, setPanelAnim] = useState(false)

  useEffect(() => {
    const raf = requestAnimationFrame(() => setPanelAnim(true))
    return () => cancelAnimationFrame(raf)
  }, [])

  function closePanel() {
    setPanelAnim(false)
    setTimeout(onClose, 380)
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') closePanel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function handlePlatformShare(platformId: string) {
    if (sharing) return
    setSharing(true)
    try {
      const filename = `xpadite-${year}-year-progress.jpg`
      const uri      = await generateYearShareCardDataUri(calData, year, sessions)
      // Convert dataURI → File held in memory (no automatic download)
      const res  = await fetch(uri)
      const blob = await res.blob()
      const file = new File([blob], filename, { type: 'image/jpeg' })

      // Save to Gallery once, before any share action
      addGalleryItem({
        id:        `year-${Date.now()}`,
        type:      'year-share',
        createdAt: Date.now(),
        title:     `${year} Year Progress`,
        year,
        dataUri:   uri,
        source:    'Analytics',
        relatedDateLabel: String(year),
      } as GalleryItem)

      const result = await executeXpaditeShare(file, platformId, setToast)
      if (result !== 'cancelled') {
        silentDriveSync(uri, filename, 'Xpadite/Progress Reports/Yearly').catch(() => {})
        closePanel()
      }
    } finally {
      setSharing(false)
    }
  }

  async function handleCopyImage() {
    if (sharing) return
    setSharing(true)
    try {
      const uri  = await generateYearShareCardDataUri(calData, year, sessions, 'png')
      const res  = await fetch(uri)
      const blob = await res.blob()
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
      setToast('Year Progress card copied to clipboard ✓')
    } catch {
      setToast('Copy not supported — try Download instead')
    } finally {
      setSharing(false)
    }
  }

  async function handleDownload() {
    if (sharing) return
    setSharing(true)
    try {
      const filename = `xpadite-${year}-year-progress.jpg`
      const uri  = await generateYearShareCardDataUri(calData, year, sessions)
      const res  = await fetch(uri)
      const blob = await res.blob()
      triggerDownloadFromFile(new File([blob], filename, { type: 'image/jpeg' }))
      silentDriveSync(uri, filename, 'Xpadite/Progress Reports/Yearly').catch(() => {})
      setToast(`${year} Year Progress card downloaded ✓`)
    } finally {
      setSharing(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[55]"
      style={{
        background: panelAnim ? 'rgba(0,0,0,0.55)' : 'rgba(0,0,0,0)',
        transition: 'background 0.25s ease',
      }}
      onClick={closePanel}
    >
      <div
        className="absolute left-0 right-0 bottom-0 rounded-t-2xl shadow-2xl"
        style={{
          background:  '#111114',
          border:      '0.5px solid rgba(255,255,255,0.10)',
          transform:   panelAnim ? 'translateY(0)' : 'translateY(100%)',
          opacity:     panelAnim ? 1 : 0,
          transition:  'transform 0.38s cubic-bezier(0.34,1.4,0.64,1), opacity 0.22s ease',
          maxWidth:    480,
          margin:      '0 auto',
          paddingBottom: 'env(safe-area-inset-bottom, 8px)',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Drag handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div style={{ width: 36, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.15)' }} />
        </div>

        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-3"
          style={{ borderBottom: '0.5px solid rgba(255,255,255,0.07)' }}
        >
          <div>
            <p className="text-sm font-semibold text-white">Share {year} Year Progress</p>
            <p className="text-[10px] mt-0.5" style={{ color: 'rgba(255,255,255,0.4)' }}>
              Card saved to Gallery automatically
            </p>
          </div>
          <button
            onClick={closePanel}
            className="text-xs transition-colors"
            style={{ color: 'rgba(255,255,255,0.4)' }}
          >
            ✕
          </button>
        </div>

        {/* Platform + action grid */}
        <div className="grid grid-cols-4 gap-3 px-4 py-4">
          {PLATFORMS.map(p => (
            <button
              key={p.id}
              onClick={() => handlePlatformShare(p.id)}
              disabled={sharing}
              className="flex flex-col items-center gap-2 py-3 rounded-xl transition-all active:scale-95 disabled:opacity-40"
              style={{ background: 'rgba(255,255,255,0.05)', border: '0.5px solid rgba(255,255,255,0.08)' }}
            >
              <PlatformBadge p={p} />
              <div className="text-center" style={{ lineHeight: 1.2 }}>
                <p style={{ fontSize: 9, fontWeight: 600, color: 'rgba(255,255,255,0.85)' }}>{p.label}</p>
                {p.sublabel ? (
                  <p style={{ fontSize: 8, color: 'rgba(255,255,255,0.4)' }}>{p.sublabel}</p>
                ) : null}
              </div>
            </button>
          ))}

          {/* Copy Image */}
          <button
            onClick={handleCopyImage}
            disabled={sharing}
            className="flex flex-col items-center gap-2 py-3 rounded-xl transition-all active:scale-95 disabled:opacity-40"
            style={{ background: 'rgba(255,255,255,0.05)', border: '0.5px solid rgba(255,255,255,0.08)' }}
          >
            <div style={{ width: 36, height: 36, borderRadius: 10, background: '#059669', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg viewBox="0 0 16 16" fill="none" width="16" height="16">
                <rect x="5" y="1" width="8" height="10" rx="1.5" stroke="white" strokeWidth="1.5" />
                <rect x="2" y="4" width="8" height="10" rx="1.5" fill="#059669" stroke="white" strokeWidth="1.5" />
              </svg>
            </div>
            <div className="text-center" style={{ lineHeight: 1.2 }}>
              <p style={{ fontSize: 9, fontWeight: 600, color: 'rgba(255,255,255,0.85)' }}>Copy</p>
              <p style={{ fontSize: 8, color: 'rgba(255,255,255,0.4)' }}>Image</p>
            </div>
          </button>

          {/* Download JPG */}
          <button
            onClick={handleDownload}
            disabled={sharing}
            className="flex flex-col items-center gap-2 py-3 rounded-xl transition-all active:scale-95 disabled:opacity-40"
            style={{ background: 'rgba(255,255,255,0.05)', border: '0.5px solid rgba(255,255,255,0.08)' }}
          >
            <div style={{ width: 36, height: 36, borderRadius: 10, background: '#4f46e5', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg viewBox="0 0 16 16" fill="none" width="16" height="16">
                <path d="M8 2v9M4 7l4 5 4-5" stroke="white" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                <line x1="2" y1="14" x2="14" y2="14" stroke="white" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </div>
            <div className="text-center" style={{ lineHeight: 1.2 }}>
              <p style={{ fontSize: 9, fontWeight: 600, color: 'rgba(255,255,255,0.85)' }}>Download</p>
              <p style={{ fontSize: 8, color: 'rgba(255,255,255,0.4)' }}>JPG</p>
            </div>
          </button>
        </div>

        {sharing && (
          <p className="text-center text-[10px] pb-3" style={{ color: 'rgba(255,255,255,0.4)' }}>
            Generating year card…
          </p>
        )}
      </div>
    </div>
  )
}
