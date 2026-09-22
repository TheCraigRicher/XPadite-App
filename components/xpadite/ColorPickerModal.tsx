'use client'

// ── Compact Google-style HSV color picker ───────────────────────────────────
// Saturation/brightness field + one hue slider + one hex field. No RGB/HSL/HEX
// tab system, by design. Reuses whatever color the caller already has — the
// existing Activity.color string field accepts any hex value, so this needs
// no schema change and no separate rendering path for "custom" colors.

import { useEffect, useRef, useState } from 'react'
import { normalizeHexColor as normalizeHex } from './utils'

// ── Color math ────────────────────────────────────────────────────────────

function hsvToRgb(h: number, s: number, v: number): { r: number; g: number; b: number } {
  s /= 100; v /= 100
  const c = v * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = v - c
  let r = 0, g = 0, b = 0
  if (h < 60)       { r = c; g = x; b = 0 }
  else if (h < 120) { r = x; g = c; b = 0 }
  else if (h < 180) { r = 0; g = c; b = x }
  else if (h < 240) { r = 0; g = x; b = c }
  else if (h < 300) { r = x; g = 0; b = c }
  else              { r = c; g = 0; b = x }
  return { r: Math.round((r + m) * 255), g: Math.round((g + m) * 255), b: Math.round((b + m) * 255) }
}

function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')
}

function hsvToHex(h: number, s: number, v: number): string {
  const { r, g, b } = hsvToRgb(h, s, v)
  return rgbToHex(r, g, b)
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = hex.trim().replace(/^#/, '').match(/^([0-9a-fA-F]{6})$/)
  if (!m) return null
  const n = parseInt(m[1], 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

function rgbToHsv(r: number, g: number, b: number): { h: number; s: number; v: number } {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min
  let h = 0
  if (d !== 0) {
    if (max === r)      h = 60 * (((g - b) / d) % 6)
    else if (max === g) h = 60 * ((b - r) / d + 2)
    else                h = 60 * ((r - g) / d + 4)
  }
  if (h < 0) h += 360
  return { h, s: max === 0 ? 0 : (d / max) * 100, v: max * 100 }
}

function hexToHsv(hex: string): { h: number; s: number; v: number } {
  const rgb = hexToRgb(hex)
  if (!rgb) return { h: 262, s: 70, v: 93 } // falls back to XPadite purple if the seed color is malformed
  return rgbToHsv(rgb.r, rgb.g, rgb.b)
}

function isValidHex(hex: string): boolean {
  return /^#?[0-9a-fA-F]{6}$/.test(hex.trim())
}

// ── Component ────────────────────────────────────────────────────────────

interface ColorPickerModalProps {
  initialColor: string
  onCancel: () => void
  onApply: (hex: string) => void
}

export function ColorPickerModal({ initialColor, onCancel, onApply }: ColorPickerModalProps) {
  const [{ h, s, v }, setHsv] = useState(() => hexToHsv(initialColor))
  // Holds the raw typed text only while it's an unresolved/invalid hex value;
  // null means "just show the picker's current color" — no effect needed to
  // keep the field in sync when the user drags the saturation/hue controls.
  const [hexDraft, setHexDraft] = useState<string | null>(null)
  const [dragging, setDragging] = useState<'sat' | 'hue' | null>(null)

  const satRef = useRef<HTMLDivElement>(null)
  const hueRef = useRef<HTMLDivElement>(null)

  const currentHex = hsvToHex(h, s, v)
  const hexError = hexDraft !== null
  const hexInput = hexDraft ?? normalizeHex(currentHex)

  function updateFromSatPoint(clientX: number, clientY: number) {
    const rect = satRef.current?.getBoundingClientRect()
    if (!rect) return
    const x = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    const y = Math.min(1, Math.max(0, (clientY - rect.top) / rect.height))
    setHsv(prev => ({ ...prev, s: x * 100, v: (1 - y) * 100 }))
  }

  function updateFromHuePoint(clientX: number) {
    const rect = hueRef.current?.getBoundingClientRect()
    if (!rect) return
    const x = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    setHsv(prev => ({ ...prev, h: x * 360 }))
  }

  useEffect(() => {
    if (!dragging) return
    function onMove(e: PointerEvent) {
      if (dragging === 'sat') updateFromSatPoint(e.clientX, e.clientY)
      else updateFromHuePoint(e.clientX)
    }
    function onUp() { setDragging(null) }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp) }
  }, [dragging])

  function handleHexChange(value: string) {
    if (isValidHex(value)) {
      setHexDraft(null)
      setHsv(hexToHsv(normalizeHex(value)))
    } else {
      setHexDraft(value)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[95] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.55)' }}
      onClick={e => { e.stopPropagation(); onCancel() }}
    >
      <div
        className="w-full max-w-[300px] rounded-2xl p-4"
        style={{ background: 'var(--xp-card)', border: '0.5px solid var(--xp-bdr2)', boxShadow: '0 24px 64px rgba(0,0,0,0.32)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Saturation / brightness field */}
        <div
          ref={satRef}
          onPointerDown={e => { e.preventDefault(); setDragging('sat'); updateFromSatPoint(e.clientX, e.clientY) }}
          className="relative w-full rounded-xl touch-none select-none"
          style={{
            height: 160,
            background: `linear-gradient(to top, #000, rgba(0,0,0,0)), linear-gradient(to right, #fff, hsl(${h}, 100%, 50%))`,
            cursor: 'crosshair',
          }}
        >
          <div
            className="absolute pointer-events-none"
            style={{
              left: `${s}%`, top: `${100 - v}%`,
              width: 16, height: 16, borderRadius: '50%',
              transform: 'translate(-50%, -50%)',
              border: '2px solid white', boxShadow: '0 0 0 1px rgba(0,0,0,0.35), 0 1px 4px rgba(0,0,0,0.4)',
              background: currentHex,
            }}
          />
        </div>

        {/* Hue slider */}
        <div
          ref={hueRef}
          onPointerDown={e => { e.preventDefault(); setDragging('hue'); updateFromHuePoint(e.clientX) }}
          className="relative w-full rounded-full touch-none select-none mt-3"
          style={{
            height: 16,
            background: 'linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)',
            cursor: 'pointer',
          }}
        >
          <div
            className="absolute pointer-events-none top-1/2"
            style={{
              left: `${(h / 360) * 100}%`,
              width: 20, height: 20, borderRadius: '50%',
              transform: 'translate(-50%, -50%)',
              border: '2.5px solid white', boxShadow: '0 0 0 1px rgba(0,0,0,0.35), 0 1px 4px rgba(0,0,0,0.4)',
              background: `hsl(${h}, 100%, 50%)`,
            }}
          />
        </div>

        {/* Preview + hex field */}
        <div className="flex items-center gap-2.5 mt-3.5">
          <div
            className="flex-shrink-0 rounded-full"
            style={{ width: 32, height: 32, background: currentHex, border: '0.5px solid var(--xp-bdr2)', boxShadow: '0 0 0 2px var(--xp-card), 0 0 0 3.5px rgba(0,0,0,0.06)' }}
          />
          <div className="flex-1 min-w-0">
            <label className="block text-[9.5px] font-semibold mb-1" style={{ color: 'var(--xp-txt3)' }}>Current Color</label>
            <input
              type="text"
              value={hexInput}
              onChange={e => handleHexChange(e.target.value)}
              maxLength={7}
              spellCheck={false}
              className="w-full px-2.5 py-1.5 rounded-lg text-[12.5px] font-mono outline-none uppercase"
              style={{
                background: 'var(--xp-bg3)',
                border: `0.5px solid ${hexError ? '#dc2626' : 'var(--xp-bdr2)'}`,
                color: 'var(--xp-txt)',
              }}
            />
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2.5 mt-4">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 py-2 rounded-lg text-xs font-medium transition-opacity hover:opacity-70"
            style={{ background: 'var(--xp-bg)', color: 'var(--xp-txt2)', border: '0.5px solid var(--xp-bdr2)' }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onApply(currentHex)}
            disabled={hexError}
            className="flex-1 py-2 rounded-lg text-xs font-semibold text-white disabled:opacity-40 transition-opacity hover:opacity-85"
            style={{ background: 'linear-gradient(135deg, #7c3aed, #6d28d9)' }}
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  )
}
