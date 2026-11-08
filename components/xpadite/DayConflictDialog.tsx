'use client'

// ── "This day changed on another device" (v1.328 stale-write protection) ─────────────────────────────────────────────
// Shown only when the SAME field of the SAME task (or the same day field) was changed differently on two devices, or one device deleted a
// task the other edited. Everything that CAN be merged already was; this asks about the rest. Nothing is saved for that day until the user
// chooses. Choosing "the other device's version" keeps a backup of this device's version in this browser.

import { useEffect, useRef } from 'react'
import type { DayData } from './types'
import type { MergeConflict } from './dayMerge'

export interface DayConflictView { key: string; mine: DayData; theirs: DayData | null; theirsRev: number; conflicts: MergeConflict[] }

function dayLabel(key: string): string {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
}

export function DayConflictDialog({ conflict, others, onChoose }: { conflict: DayConflictView; others: number; onChoose: (c: 'mine' | 'theirs') => void }) {
  const firstRef = useRef<HTMLButtonElement>(null)
  useEffect(() => { firstRef.current?.focus() }, [conflict.key])
  const shown = conflict.conflicts.slice(0, 6)
  return (
    <div className="fixed inset-0 flex items-center justify-center p-4" style={{ zIndex: 100000, background: 'rgba(0,0,0,0.55)' }} data-testid="day-conflict">
      <div role="alertdialog" aria-modal="true" aria-labelledby="xp-dayconf-title" aria-describedby="xp-dayconf-desc" className="w-full"
        style={{ maxWidth: 400, background: 'var(--xp-card)', border: '0.5px solid var(--xp-bdr2)', borderRadius: 16, padding: '20px 18px', boxShadow: '0 20px 50px rgba(0,0,0,0.4)' }}>
        <p id="xp-dayconf-title" className="text-[15px] font-bold mb-1" style={{ color: 'var(--xp-txt)' }}>This day changed on another device</p>
        <p id="xp-dayconf-desc" className="text-[12.5px] mb-2" style={{ color: 'var(--xp-txt2)' }}>
          {dayLabel(conflict.key)} was edited here and on another device at the same time. Everything that could be combined was; these changes clash, so nothing was saved yet:
        </p>
        <ul className="text-[12px] mb-3 pl-4 list-disc" style={{ color: 'var(--xp-txt)' }} data-testid="day-conflict-list">
          {shown.map((c, i) => <li key={i} className="break-words">{c.label}</li>)}
          {conflict.conflicts.length > shown.length && <li>…and {conflict.conflicts.length - shown.length} more</li>}
        </ul>
        <div className="flex flex-col gap-2">
          <button ref={firstRef} type="button" data-testid="day-conflict-mine" onClick={() => onChoose('mine')} className="text-[13px] font-semibold text-white"
            style={{ padding: '10px 12px', borderRadius: 10, background: '#7c3aed' }}>Keep my version</button>
          <button type="button" data-testid="day-conflict-theirs" onClick={() => onChoose('theirs')} className="text-[13px] font-medium"
            style={{ padding: '10px 12px', borderRadius: 10, background: 'var(--xp-bg3)', border: '0.5px solid var(--xp-bdr2)', color: 'var(--xp-txt)' }}>Use the other device&rsquo;s version</button>
        </div>
        <p className="text-[11px] mt-3" style={{ color: 'var(--xp-txt3)' }}>
          &ldquo;Keep my version&rdquo; replaces the other device&rsquo;s changes to this day. &ldquo;Use the other device&rsquo;s version&rdquo; drops yours (a copy is kept on this device).
          {others > 0 ? ` ${others} more day${others === 1 ? '' : 's'} need${others === 1 ? 's' : ''} a decision after this.` : ''}
        </p>
      </div>
    </div>
  )
}
