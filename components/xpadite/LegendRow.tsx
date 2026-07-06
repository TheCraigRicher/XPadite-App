'use client'

import { ReactNode } from 'react'
import { useApp } from './AppContext'
import { hexToRgba } from './utils'

function Tip({ content, children }: { content: string; children: ReactNode }) {
  return (
    <div className="relative group/tip flex items-center">
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

export function LegendRow() {
  const { progressColor } = useApp()
  return (
    <div
      className="flex items-center justify-center gap-5 px-4 pb-3 flex-wrap"
      style={{ color: 'var(--xp-txt2)' }}
    >
      <Tip content="Productive Day — you stayed focused and made progress">
        <div className="flex items-center gap-1.5 text-xs cursor-default">
          <div
            className="w-4 h-4 rounded-full flex-shrink-0"
            style={{
              background: progressColor,
              boxShadow: `0 0 0 2px ${hexToRgba(progressColor, 0.25)}`,
            }}
          />
          <span>Productive</span>
        </div>
      </Tip>

      <Tip content="Hyper Productive — an exceptional day of peak performance">
        <div className="flex items-center gap-1.5 text-xs cursor-default">
          <span className="text-base leading-none">🔥</span>
          <span>Hyper productive</span>
        </div>
      </Tip>

      <Tip content="Streak — consecutive productive days connected in a chain">
        <div className="flex items-center gap-1.5 text-xs cursor-default">
          <div className="flex items-center flex-shrink-0">
            <div className="w-3 h-3 rounded-full" style={{ background: progressColor, boxShadow: `0 0 0 1.5px ${hexToRgba(progressColor, 0.3)}` }} />
            <div className="w-3 h-0.5" style={{ background: progressColor }} />
            <div className="w-3 h-3 rounded-full" style={{ background: progressColor, boxShadow: `0 0 0 1.5px ${hexToRgba(progressColor, 0.3)}` }} />
            <div className="w-3 h-0.5" style={{ background: progressColor }} />
            <div className="w-3 h-3 rounded-full" style={{ background: progressColor, boxShadow: `0 0 0 1.5px ${hexToRgba(progressColor, 0.3)}` }} />
          </div>
          <span>Streak</span>
        </div>
      </Tip>

      <Tip content="Milestone — you hit a major goal or achievement worth celebrating">
        <div className="flex items-center gap-1.5 text-xs cursor-default">
          <span className="text-base leading-none">🏆</span>
          <span>Milestone</span>
        </div>
      </Tip>
    </div>
  )
}
