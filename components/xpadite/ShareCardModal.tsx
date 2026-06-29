'use client'

import { useState, useCallback, useMemo, useEffect } from 'react'
import { useApp } from './AppContext'
import { getMonthStats, MONTHS, APP_YEAR } from './utils'
import { addGalleryItem } from './GalleryModal'
import type { GalleryItem } from './GalleryModal'

function getPerformanceLevel(rate: number): { label: string; emoji: string; color: string } {
  if (rate >= 90) return { label: 'Elite Mode', emoji: '🔥', color: '#ef4444' }
  if (rate >= 75) return { label: 'Advanced', emoji: '⚡', color: '#f97316' }
  if (rate >= 60) return { label: 'Average', emoji: '📈', color: '#a3e635' }
  if (rate >= 40) return { label: 'Normal', emoji: '🎯', color: '#22d3ee' }
  return { label: 'Getting Started', emoji: '✨', color: '#94a3b8' }
}

function getMotivationalMessage(
  stats: ReturnType<typeof getMonthStats>,
  monthName: string
): string {
  const { completionRate, hyperDays, milestoneDays, goalDays, productiveDays } = stats
  if (completionRate >= 90)
    return `An extraordinary month. ${hyperDays} fire days, ${milestoneDays} milestones. You are in elite territory — keep building on this momentum.`
  if (completionRate >= 75)
    return `A strong month in ${monthName}. ${goalDays} goals hit, ${hyperDays} fire days lit. Advanced performers push through — you're on that path.`
  if (completionRate >= 60)
    return `Solid consistency in ${monthName} with ${productiveDays} productive days. Keep showing up — that's how compounding works.`
  if (completionRate >= 40)
    return `${monthName} had its challenges, but you showed up ${productiveDays} days. Every day you track is a brick in the foundation.`
  return `${monthName} is a reminder that tomorrow is a new opportunity. Start small, stay consistent, and watch the streak grow.`
}

function drawRoundRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number
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

export async function generateShareCardDataUri(
  month: number,
  stats: ReturnType<typeof getMonthStats>
): Promise<string> {
  const canvas = document.createElement('canvas')
  canvas.width = 800
  canvas.height = 420
  const ctx = canvas.getContext('2d')!

  const monthName = MONTHS[month]
  const perf = getPerformanceLevel(stats.completionRate)
  const message = getMotivationalMessage(stats, monthName)

  // Background gradient
  const grad = ctx.createLinearGradient(0, 0, 0, 420)
  grad.addColorStop(0, '#0d0d14')
  grad.addColorStop(1, '#1a0a2e')
  ctx.fillStyle = grad
  drawRoundRect(ctx, 0, 0, 800, 420, 16)
  ctx.fill()

  // Purple radial glow — top-left
  const radGlow = ctx.createRadialGradient(0, 0, 0, 0, 0, 300)
  radGlow.addColorStop(0, 'rgba(124,58,237,0.28)')
  radGlow.addColorStop(1, 'rgba(124,58,237,0)')
  ctx.fillStyle = radGlow
  ctx.fillRect(0, 0, 800, 420)

  // Left accent bar
  ctx.fillStyle = '#7c3aed'
  drawRoundRect(ctx, 0, 0, 5, 420, 3)
  ctx.fill()

  // Brand text
  ctx.font = '600 11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
  ctx.fillStyle = 'rgba(167,139,250,0.7)'
  ctx.textAlign = 'left'
  ctx.fillText('XPADITE', 24, 30)

  // Performance badge (top-right)
  ctx.font = '700 10px sans-serif'
  ctx.fillStyle = perf.color
  ctx.textAlign = 'right'
  ctx.fillText(`${perf.label.toUpperCase()}`, 776, 30)

  // Month name — large centered
  ctx.textAlign = 'center'
  ctx.font = '800 54px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
  ctx.fillStyle = '#ffffff'
  ctx.fillText(monthName.toUpperCase(), 400, 108)

  // Year
  ctx.font = '400 18px sans-serif'
  ctx.fillStyle = 'rgba(255,255,255,0.3)'
  ctx.fillText(String(APP_YEAR), 400, 136)

  // Completion percentage
  ctx.font = '800 70px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
  ctx.fillStyle = '#a78bfa'
  ctx.fillText(`${stats.completionRate}%`, 400, 220)

  ctx.font = '500 11px sans-serif'
  ctx.fillStyle = 'rgba(255,255,255,0.35)'
  ctx.fillText('COMPLETION RATE', 400, 240)

  // Stats chips
  const chips = [
    { label: 'Days', value: String(stats.productiveDays) },
    { label: 'Hyper', value: String(stats.hyperDays) },
    { label: 'Milestones', value: String(stats.milestoneDays) },
    { label: 'Goals', value: String(stats.goalDays) },
  ]
  const chipW = 138
  const chipH = 46
  const chipGap = 14
  const totalChipW = chips.length * chipW + (chips.length - 1) * chipGap
  const chipStartX = (800 - totalChipW) / 2

  chips.forEach((chip, i) => {
    const cx = chipStartX + i * (chipW + chipGap)
    const cy = 264
    ctx.fillStyle = 'rgba(255,255,255,0.06)'
    drawRoundRect(ctx, cx, cy, chipW, chipH, 10)
    ctx.fill()
    ctx.strokeStyle = 'rgba(255,255,255,0.1)'
    ctx.lineWidth = 0.5
    drawRoundRect(ctx, cx, cy, chipW, chipH, 10)
    ctx.stroke()

    ctx.font = '700 18px sans-serif'
    ctx.fillStyle = '#ffffff'
    ctx.textAlign = 'center'
    ctx.fillText(chip.value, cx + chipW / 2, cy + 20)
    ctx.font = '400 9px sans-serif'
    ctx.fillStyle = 'rgba(255,255,255,0.4)'
    ctx.fillText(chip.label, cx + chipW / 2, cy + 36)
  })

  // Divider
  ctx.strokeStyle = 'rgba(255,255,255,0.07)'
  ctx.lineWidth = 0.5
  ctx.beginPath()
  ctx.moveTo(32, 328)
  ctx.lineTo(768, 328)
  ctx.stroke()

  // Motivational message (word-wrapped)
  ctx.font = '400 13px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
  ctx.fillStyle = 'rgba(255,255,255,0.5)'
  ctx.textAlign = 'center'
  const words = message.split(' ')
  const maxLineW = 680
  let line = ''
  let lineY = 354
  const lineH = 20
  for (const word of words) {
    const test = line ? `${line} ${word}` : word
    if (ctx.measureText(test).width > maxLineW && line) {
      ctx.fillText(line, 400, lineY)
      line = word
      lineY += lineH
    } else {
      line = test
    }
  }
  if (line) ctx.fillText(line, 400, lineY)

  // Footer
  ctx.fillStyle = 'rgba(255,255,255,0.03)'
  ctx.fillRect(0, 398, 800, 22)
  ctx.font = '400 9px sans-serif'
  ctx.fillStyle = 'rgba(255,255,255,0.18)'
  ctx.textAlign = 'center'
  ctx.fillText('xpadite.app  ·  v1.0.2  ·  Track your days. Own your year.', 400, 413)

  return canvas.toDataURL('image/png')
}

interface ShareCardModalProps {
  month: number
  onClose: () => void
}

export function ShareCardModal({ month, onClose }: ShareCardModalProps) {
  const { calData } = useApp()
  const [dataUri, setDataUri] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const [saved, setSaved] = useState(false)

  const stats = useMemo(() => getMonthStats(calData, APP_YEAR, month), [calData, month])
  const perf = getPerformanceLevel(stats.completionRate)

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const handleGenerate = useCallback(async () => {
    setGenerating(true)
    setSaved(false)
    try {
      const uri = await generateShareCardDataUri(month, stats)
      setDataUri(uri)
    } finally {
      setGenerating(false)
    }
  }, [month, stats])

  function handleDownload() {
    if (!dataUri) return
    const a = document.createElement('a')
    a.href = dataUri
    a.download = `xpadite-${MONTHS[month].toLowerCase()}-${APP_YEAR}.png`
    a.click()
  }

  function handleSaveToGallery() {
    if (!dataUri || saved) return
    const item: GalleryItem = {
      id: 'card-' + Date.now(),
      type: 'month-share',
      createdAt: Date.now(),
      title: `${MONTHS[month]} ${APP_YEAR}`,
      month,
      year: APP_YEAR,
      dataUri,
      stats: {
        productiveDays: stats.productiveDays,
        totalDays: stats.totalDays,
        hyperDays: stats.hyperDays,
        milestoneDays: stats.milestoneDays,
        goalDays: stats.goalDays,
        completionRate: stats.completionRate,
      },
    }
    addGalleryItem(item)
    setSaved(true)
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center p-4 pt-12 overflow-y-auto"
      style={{ background: 'rgba(0,0,0,0.7)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-[520px] rounded-2xl shadow-2xl overflow-hidden mb-8"
        style={{ background: 'var(--xp-card)', border: '0.5px solid var(--xp-bdr2)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: '0.5px solid var(--xp-bdr)' }}
        >
          <div>
            <h2 className="text-sm font-semibold" style={{ color: 'var(--xp-txt)' }}>
              📤 Share — {MONTHS[month]} {APP_YEAR}
            </h2>
            <p className="text-[10px] mt-0.5" style={{ color: 'var(--xp-txt3)' }}>
              Generate a polished share card
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-sm transition-colors hover:text-red-400"
            style={{ color: 'var(--xp-txt3)' }}
          >
            × Close
          </button>
        </div>

        {/* Preview */}
        <div className="p-5">
          {dataUri ? (
            <img src={dataUri} alt="Share card preview" className="w-full rounded-xl shadow-lg" />
          ) : (
            /* HTML preview card — shown before generation */
            <div
              className="w-full rounded-xl overflow-hidden relative"
              style={{
                background: 'linear-gradient(160deg, #0d0d14 0%, #1a0a2e 100%)',
                border: '0.5px solid rgba(255,255,255,0.08)',
                padding: '22px 22px 18px',
              }}
            >
              <div
                style={{
                  position: 'absolute', left: 0, top: 0, bottom: 0, width: 4,
                  background: '#7c3aed', borderRadius: '4px 0 0 4px',
                }}
              />
              <div
                style={{
                  position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
                  background: 'radial-gradient(ellipse at 0% 0%, rgba(124,58,237,0.22) 0%, transparent 60%)',
                  pointerEvents: 'none',
                }}
              />
              <div className="flex items-start justify-between mb-2">
                <p style={{ fontSize: 10, color: 'rgba(167,139,250,0.7)', fontWeight: 600, letterSpacing: '0.1em' }}>
                  XPADITE
                </p>
                <p style={{ fontSize: 9, color: perf.color, fontWeight: 700 }}>
                  {perf.emoji} {perf.label.toUpperCase()}
                </p>
              </div>
              <p style={{ fontSize: 24, fontWeight: 800, color: '#fff', marginBottom: 1 }}>
                {MONTHS[month].toUpperCase()}
              </p>
              <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.28)', marginBottom: 10 }}>
                {APP_YEAR}
              </p>
              <p style={{ fontSize: 36, fontWeight: 900, color: '#a78bfa', lineHeight: 1 }}>
                {stats.completionRate}%
              </p>
              <p style={{ fontSize: 8, color: 'rgba(255,255,255,0.35)', marginBottom: 12 }}>
                COMPLETION RATE
              </p>
              <div className="flex gap-2 flex-wrap">
                {[
                  { l: '✅ Days', v: stats.productiveDays },
                  { l: '🔥 Hyper', v: stats.hyperDays },
                  { l: '🏆 Miles', v: stats.milestoneDays },
                  { l: '🎯 Goals', v: stats.goalDays },
                ].map(chip => (
                  <div
                    key={chip.l}
                    className="flex flex-col items-center px-3 py-1.5 rounded-lg"
                    style={{
                      background: 'rgba(255,255,255,0.06)',
                      border: '0.5px solid rgba(255,255,255,0.1)',
                      minWidth: 50,
                    }}
                  >
                    <p style={{ fontSize: 14, fontWeight: 700, color: '#fff' }}>{chip.v}</p>
                    <p style={{ fontSize: 7, color: 'rgba(255,255,255,0.38)' }}>{chip.l}</p>
                  </div>
                ))}
              </div>
              <p style={{ fontSize: 8, color: 'rgba(255,255,255,0.15)', marginTop: 14 }}>
                xpadite.app · v1.0.2
              </p>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2 mt-4">
            <button
              onClick={handleGenerate}
              disabled={generating}
              className="flex-1 py-2.5 rounded-xl text-xs font-semibold text-white transition-all hover:opacity-85 disabled:opacity-50"
              style={{ background: '#7c3aed' }}
            >
              {generating ? '⏳ Generating…' : dataUri ? '🔄 Regenerate' : '✨ Generate Share Card'}
            </button>

            {dataUri && (
              <>
                <button
                  onClick={handleDownload}
                  className="px-4 py-2.5 rounded-xl text-xs font-medium transition-all hover:opacity-85"
                  style={{
                    background: 'var(--xp-bg3)',
                    border: '0.5px solid var(--xp-bdr)',
                    color: 'var(--xp-txt2)',
                  }}
                >
                  ⬇ PNG
                </button>
                <button
                  onClick={handleSaveToGallery}
                  disabled={saved}
                  className="px-4 py-2.5 rounded-xl text-xs font-medium transition-all hover:opacity-85 disabled:opacity-60"
                  style={{
                    background: 'var(--xp-bg3)',
                    border: '0.5px solid var(--xp-bdr)',
                    color: saved ? '#4ade80' : 'var(--xp-txt2)',
                  }}
                >
                  {saved ? '✓ Saved' : '🖼 Save'}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
