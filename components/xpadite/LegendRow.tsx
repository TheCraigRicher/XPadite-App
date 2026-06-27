'use client'

import { ReactNode } from 'react'

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
              background: '#16a34a',
              boxShadow: '0 0 0 2px rgba(22,163,74,0.25)',
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

      <Tip content="Today — the current date">
        <div className="flex items-center gap-1.5 text-xs cursor-default">
          <div
            className="w-4 h-4 rounded-full flex items-center justify-center text-[7px] font-semibold flex-shrink-0"
            style={{ border: '2px solid var(--xp-acc)', color: 'var(--xp-acc)' }}
          >
            T
          </div>
          <span>Today</span>
        </div>
      </Tip>

      <Tip content="Streak — consecutive productive days connected in a chain">
        <div className="flex items-center gap-1.5 text-xs cursor-default">
          <div className="flex items-center flex-shrink-0">
            <div className="w-3 h-3 rounded-full bg-green-600" style={{ boxShadow: '0 0 0 1.5px rgba(22,163,74,0.3)' }} />
            <div className="w-3 h-0.5 bg-green-600" />
            <div className="w-3 h-3 rounded-full bg-green-600" style={{ boxShadow: '0 0 0 1.5px rgba(22,163,74,0.3)' }} />
            <div className="w-3 h-0.5 bg-green-600" />
            <div className="w-3 h-3 rounded-full bg-green-600" style={{ boxShadow: '0 0 0 1.5px rgba(22,163,74,0.3)' }} />
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
