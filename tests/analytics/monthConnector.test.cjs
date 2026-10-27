// Expanded monthly calendar: the purple connector between consecutive achievement days must be continuous after
// EVERY marker type (🎯→🏆, 🎯→🔥, 🎯→circle, 🎯→🎯 and the reverse). The geometry model reads its constants from
// MonthFullPage.tsx (not copies), so it fails if they regress. (A real-Chrome render of the component was also
// measured during development — see the v1.311 report; this file is the permanent regression guard.)
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const src = fs.readFileSync(path.join(__dirname, '..', '..', 'components/xpadite/MonthFullPage.tsx'), 'utf8')
const GAP = Number(/grid grid-cols-7 gap-x-(\d) /.exec(src)[1]) * 4              // tailwind gap-x-2 = 8px
const BASE_RIGHT = Number(/left: connEdge, right: (-\d+),/.exec(src)[1])            // right line overshoot past the cell (px)
const SHIFT = Number(/\.xp-goal-shift \{ transform: translateX\((-\d+)px\)/.exec(src)[1])
const CAP_L = Number(/\.xp-goal-conn-l \{ left: (\d+)px !important/.exec(src)[1])
const CAP_R = Number(/\.xp-goal-conn-r \{ right: (-\d+)px !important/.exec(src)[1])

// Distance (px) A's right line overlaps B's left line (positive = overlap, negative = gap).
function overlap({ aGoalOnly, bGoalOnly, desktop, W }) {
  const aEnd = W - (desktop && aGoalOnly ? CAP_R : BASE_RIGHT) + (desktop && aGoalOnly ? SHIFT : 0)
  const bStart = W + GAP + (desktop && bGoalOnly ? CAP_L + SHIFT : 0)
  return aEnd - bStart
}

for (const desktop of [true, false]) for (const W of [40, 63.7, 83.4, 120.25]) for (const aGoalOnly of [true, false]) for (const bGoalOnly of [true, false]) {
  test(`${desktop ? 'desktop' : 'mobile'} cell ${W}px  A=${aGoalOnly ? '🎯' : 'other'} → B=${bGoalOnly ? '🎯' : 'other'}: exactly 1px overlap (no gap, no doubled glow)`, () => {
    assert.equal(Math.round(overlap({ aGoalOnly, bGoalOnly, desktop, W }) * 1000) / 1000, 1)
  })
}

test('original bug: with the 6px desktop shift and no end caps a 🎯 followed by any non-🎯 left a 6px hole', () => {
  const before = (W = 83.4) => (W - -8 + SHIFT) - (W + GAP)       // right:-8, shifted, no caps
  assert.equal(before(), -6)
  assert.equal(CAP_R - BASE_RIGHT, SHIFT); assert.equal(CAP_L, -SHIFT)   // caps cancel the shift exactly
})

test('end caps apply to exactly the shifted (goal-only) cells, on desktop only, and to the connectors only', () => {
  assert.ok(/const goalOnly = !rawHyper && !rawMil && rawGoal/.test(src))
  assert.ok(/className=\{goalOnly \? 'xp-goal-conn-l' : undefined\}/.test(src) && /className=\{goalOnly \? 'xp-goal-conn-r' : undefined\}/.test(src))
  assert.ok(/@media \(min-width: 1024px\) \{[^}]*\.xp-goal-shift[\s\S]*?\.xp-goal-conn-l[\s\S]*?\.xp-goal-conn-r/.test(src))
  assert.ok(/\.xp-goal-emoji \{ transform: translate\(3px, -4px\)/.test(src), 'icon nudge untouched')
})

test('unchanged: colour, thickness, glow, layering, row/month boundary rules and clean-mode hiding', () => {
  assert.ok(/height: 2\.5, background: progressColor, boxShadow: connGlow, transform: 'translateY\(-50%\)', zIndex: 0, pointerEvents: 'none'/.test(src))
  assert.ok(/cell\.dow !== 0 && !!prevKey/.test(src) && /cell\.dow !== 6 && !!nextKey/.test(src))
  assert.ok(/const visStreak = !calendarClean && rawStreak/.test(src))
  assert.ok(/zIndex: 2, opacity: calendarClean/.test(src), 'markers stay above the line (z 2 vs 0)')
})
