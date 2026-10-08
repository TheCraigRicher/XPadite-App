'use client'

import { ReactNode } from 'react'
import { useApp } from './AppContext'
import { hexToRgba, resolveProgressColor } from './utils'

function Tip({ content, children, className }: { content: string; children: ReactNode; className?: string }) {
  return (
    <div className={`relative group/tip flex items-center${className ? ` ${className}` : ''}`}>
      {children}
      <div
        className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2.5 px-2.5 py-1.5 rounded-lg text-[10px] font-medium text-white bg-gray-900 whitespace-nowrap pointer-events-none z-50 opacity-0 group-hover/tip:opacity-100 transition-opacity duration-200"
        role="tooltip"
      >
        {content}
        <div className="absolute top-full left-1/2 -translate-x-1/2 w-0 h-0 border-4 border-transparent border-t-gray-900" />
      </div>
    </div>
  )
}

// XPadite's signature "Productive" indicator — a solid progress-color dot
// with a soft ring, the same dot used inline below and throughout the app's
// calendar/legend surfaces. Exported so other dashboards (Analytics, Monthly
// Dashboard) can reuse the exact visual instead of approximating it with emoji.
export function ProductiveDot({ color, size = 16 }: { color: string; size?: number }) {
  return (
    <div
      className="rounded-full flex-shrink-0"
      style={{ width: size, height: size, background: color, boxShadow: `0 0 0 2px ${hexToRgba(color, 0.25)}` }}
    />
  )
}

// `compactMobile` is opt-in and changes ONLY the sub-sm layout: two
// explicit, independently-centered rows (Productive/Hyper/Milestone, then
// Streak/Goals) instead of natural flex-wrap. At sm+ it renders byte-
// identical markup/order to the default — every existing caller (e.g. the
// main Calendar page) that doesn't pass this prop is completely unaffected,
// on every breakpoint including mobile.
export function LegendRow({ compactMobile = false }: { compactMobile?: boolean } = {}) {
  const { progressColor: _rawColor, isDark } = useApp()
  const progressColor = resolveProgressColor(_rawColor, isDark)

  const items = (
    <>
      <Tip className={compactMobile ? 'sm:order-1' : undefined} content="Productive Day — you stayed focused and made progress">
        <div className="flex items-center gap-1.5 text-xs cursor-default">
          <div
            className="w-4 h-4 rounded-full flex-shrink-0"
            style={{
              background: progressColor,
              boxShadow: `0 0 0 2px ${hexToRgba(progressColor, 0.25)}`,
            }}
          />
          <span className="whitespace-nowrap">Productive</span>
        </div>
      </Tip>

      <Tip className={compactMobile ? 'sm:order-2' : undefined} content="Hyper Productive — an exceptional day of peak performance">
        <div className="flex items-center gap-1.5 text-xs cursor-default">
          <span className="text-base leading-none">🔥</span>
          <span className="whitespace-nowrap">Hyper productive</span>
        </div>
      </Tip>

      <Tip className={compactMobile ? 'sm:order-4' : undefined} content="Milestone — you hit a major goal or achievement worth celebrating">
        <div className="flex items-center gap-1.5 text-xs cursor-default">
          <span className="text-base leading-none">🏆</span>
          <span className="whitespace-nowrap">Milestone</span>
        </div>
      </Tip>

      <Tip className={compactMobile ? 'sm:order-3' : undefined} content="Streak — consecutive productive days connected in a chain">
        <div className="flex items-center gap-1.5 text-xs cursor-default">
          <div className="flex items-center flex-shrink-0">
            <div className="w-3 h-3 rounded-full" style={{ background: progressColor, boxShadow: `0 0 0 1.5px ${hexToRgba(progressColor, 0.3)}` }} />
            <div className="w-3 h-0.5" style={{ background: progressColor }} />
            <div className="w-3 h-3 rounded-full" style={{ background: progressColor, boxShadow: `0 0 0 1.5px ${hexToRgba(progressColor, 0.3)}` }} />
            <div className="w-3 h-0.5" style={{ background: progressColor }} />
            <div className="w-3 h-3 rounded-full" style={{ background: progressColor, boxShadow: `0 0 0 1.5px ${hexToRgba(progressColor, 0.3)}` }} />
          </div>
          <span className="whitespace-nowrap">Streak</span>
        </div>
      </Tip>

      <Tip className={compactMobile ? 'sm:order-5' : undefined} content="Goals Accomplished — you achieved a target you set for yourself">
        <div className="flex items-center gap-1.5 text-xs cursor-default">
          <span className="text-base leading-none">🎯</span>
          <span className="whitespace-nowrap">Goals Accomplished</span>
        </div>
      </Tip>
    </>
  )

  if (!compactMobile) {
    return (
      <div className="flex items-center justify-center gap-5 px-4 pb-3 flex-wrap" style={{ color: 'var(--xp-txt2)' }}>
        {items}
      </div>
    )
  }

  // Mobile (below sm): two explicit, independently-centered rows —
  // Productive/Hyper/Milestone, then Streak/Goals — via two grouping
  // wrappers. At sm+ both wrappers become `display:contents` (they vanish
  // structurally) so the 5 items become direct children of this single
  // flex-wrap row again, exactly as the default; `sm:order-*` above
  // restores the original Productive/Hyper/Streak/Milestone/Goals visual
  // sequence despite the DOM now grouping Milestone next to Hyper for
  // mobile's sake.
  return (
    <div
      className="flex flex-col items-center gap-2 px-4 pb-3 sm:flex-row sm:flex-wrap sm:justify-center sm:gap-5"
      style={{ color: 'var(--xp-txt2)' }}
    >
      <div className="flex items-center justify-center gap-3 sm:contents">
        <Tip className="sm:order-1" content="Productive Day — you stayed focused and made progress">
          <div className="flex items-center gap-1.5 text-xs cursor-default">
            <div
              className="w-4 h-4 rounded-full flex-shrink-0"
              style={{
                background: progressColor,
                boxShadow: `0 0 0 2px ${hexToRgba(progressColor, 0.25)}`,
              }}
            />
            <span className="whitespace-nowrap">Productive</span>
          </div>
        </Tip>

        <Tip className="sm:order-2" content="Hyper Productive — an exceptional day of peak performance">
          <div className="flex items-center gap-1.5 text-xs cursor-default">
            <span className="text-base leading-none">🔥</span>
            <span className="whitespace-nowrap">Hyper productive</span>
          </div>
        </Tip>

        <Tip className="sm:order-4" content="Milestone — you hit a major goal or achievement worth celebrating">
          <div className="flex items-center gap-1.5 text-xs cursor-default">
            <span className="text-base leading-none">🏆</span>
            <span className="whitespace-nowrap">Milestone</span>
          </div>
        </Tip>
      </div>

      <div className="flex items-center justify-center gap-4 sm:contents">
        <Tip className="sm:order-3" content="Streak — consecutive productive days connected in a chain">
          <div className="flex items-center gap-1.5 text-xs cursor-default">
            <div className="flex items-center flex-shrink-0">
              <div className="w-3 h-3 rounded-full" style={{ background: progressColor, boxShadow: `0 0 0 1.5px ${hexToRgba(progressColor, 0.3)}` }} />
              <div className="w-3 h-0.5" style={{ background: progressColor }} />
              <div className="w-3 h-3 rounded-full" style={{ background: progressColor, boxShadow: `0 0 0 1.5px ${hexToRgba(progressColor, 0.3)}` }} />
              <div className="w-3 h-0.5" style={{ background: progressColor }} />
              <div className="w-3 h-3 rounded-full" style={{ background: progressColor, boxShadow: `0 0 0 1.5px ${hexToRgba(progressColor, 0.3)}` }} />
            </div>
            <span className="whitespace-nowrap">Streak</span>
          </div>
        </Tip>

        <Tip className="sm:order-5" content="Goals Accomplished — you achieved a target you set for yourself">
          <div className="flex items-center gap-1.5 text-xs cursor-default">
            <span className="text-base leading-none">🎯</span>
            <span className="whitespace-nowrap">Goals Accomplished</span>
          </div>
        </Tip>
      </div>
    </div>
  )
}
