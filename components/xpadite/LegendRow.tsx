'use client'

export function LegendRow() {
  return (
    <div
      className="flex items-center justify-center gap-5 px-4 pb-3 flex-wrap"
      style={{ color: 'var(--xp-txt2)' }}
    >
      {/* Productive */}
      <div className="flex items-center gap-1.5 text-xs">
        <div className="w-3.5 h-3.5 rounded-full flex items-center justify-center flex-shrink-0" style={{ border: '2px solid #16a34a' }}>
          <div className="w-1.5 h-1.5 rounded-full bg-green-600" />
        </div>
        <span>Productive</span>
      </div>

      {/* Hyper productive */}
      <div className="flex items-center gap-1.5 text-xs">
        <span className="text-sm">🔥</span>
        <span>Hyper productive</span>
      </div>

      {/* Today */}
      <div className="flex items-center gap-1.5 text-xs">
        <div
          className="w-3.5 h-3.5 rounded-full flex items-center justify-center text-[7px] font-semibold flex-shrink-0"
          style={{ border: '2px solid var(--xp-acc)', color: 'var(--xp-acc)' }}
        >
          T
        </div>
        <span>Today</span>
      </div>

      {/* Streak */}
      <div className="flex items-center gap-1.5 text-xs">
        <div className="flex items-center gap-0 flex-shrink-0">
          <div className="w-2.5 h-2.5 rounded-full bg-green-600" style={{ border: '1.5px solid var(--xp-bg)' }} />
          <div className="w-2 h-0.5 bg-green-600" />
          <div className="w-2.5 h-2.5 rounded-full bg-green-600" style={{ border: '1.5px solid var(--xp-bg)' }} />
          <div className="w-2 h-0.5 bg-green-600" />
          <div className="w-2.5 h-2.5 rounded-full bg-green-600" style={{ border: '1.5px solid var(--xp-bg)' }} />
        </div>
        <span className="ml-1">Streak</span>
      </div>

      {/* Trophy milestone */}
      <div className="flex items-center gap-1.5 text-xs">
        <span className="text-sm">🏆</span>
        <span>Milestone</span>
      </div>
    </div>
  )
}
