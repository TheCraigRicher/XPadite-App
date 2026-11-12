// v1.338 — Task Manager freezing: regression tests for each confirmed root cause. The same scenarios were driven in a real browser
// (mobile / tablet / desktop viewports, touch taps) against the shipped build; this file guards the implementation contract and
// runs the page-scroll-lock logic for real.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const ROOT = path.resolve(__dirname, '..', '..')
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/^﻿/, '').replace(/\r\n/g, '\n')
const app = read('components/xpadite/XpaditeApp.tsx')
const dm = read('components/xpadite/DayModal.tsx')

// ── 1. Two windows were rendered with the SAME React key (the date): React then duplicates / drops children ─────────────────────
test('the Task Manager and the Daily Dashboard never share a React key (that duplicated the Task Manager after Back)', () => {
  assert.match(app, /<DayModal\s+key=\{`day-\$\{modalDay\.key\}`\}/)
  assert.match(app, /<DayFullPageModal\s+key=\{`dash-\$\{dashboardDay\.key\}`\}/)
  assert.ok(!/key=\{modalDay\.key\}|key=\{dashboardDay\.key\}/.test(app), 'the bare date key (same string for both) is gone')
})

// ── 2. Escape belongs to the screen on top ───────────────────────────────────────────────────────────────────────────────────────
test('Escape on the dashboard no longer also closes the Task Manager underneath', () => {
  assert.match(app, /closeIntent=\{dayModalCloseIntent\}\s+suspended=\{!!dashboardDay\}/)
  assert.match(dm, /suspended\?: boolean/)
  assert.match(dm, /if \(e\.key !== 'Escape' \|\| suspendedRef\.current\) return/)
})

// ── 3. Save / Save and Close: never silently ignored, never waits forever ────────────────────────────────────────────────────
test('a second Save / Save and Close joins the save in flight, and the wait for the server is bounded', () => {
  const i = dm.indexOf('const persistRef = useRef'), j = dm.indexOf('async function handleMainSave')
  const block = dm.slice(i, j)
  assert.ok(i > 0 && j > i)
  assert.match(block, /if \(persistRef\.current\) return persistRef\.current/, 'joins instead of returning false')
  assert.ok(!/if \(saveBusyRef\.current\) return false/.test(dm), 'the silent no-op is gone')
  assert.match(block, /Promise\.race\(\[flushDays\(\), slow\]\)/)
  assert.match(dm, /const SAVE_WAIT_MS = \d+/)
  assert.match(block, /Still saving/)
  assert.match(block, /finally \{[\s\S]*clearTimeout\(timer\)[\s\S]*persistRef\.current = null[\s\S]*saveBusyRef\.current = false/, 'busy state is always released')
})

// ── 4. A dismissed window can never act later ────────────────────────────────────────────────────────────────────────────────
test('async continuations and close timers are cancelled on unmount and re-check that the window is still mounted', () => {
  assert.match(dm, /const mountedRef = useRef\(true\)/)
  assert.match(dm, /return \(\) => \{ mountedRef\.current = false; timers\.forEach\(clearTimeout\); timers\.clear\(\) \}/)
  const close = dm.slice(dm.indexOf('function doClose()'), dm.indexOf('function attemptClose()'))
  assert.match(close, /if \(closingRef\.current \|\| !mountedRef\.current\) return/)
  assert.match(close, /later\(\(\) => onCloseRef\.current\(\), 210\)/)
  assert.ok(!/setTimeout\(onClose, 210\)/.test(dm), 'no raw timer holding a stale onClose closure')
  for (const fn of ['handleMainSave', 'handleSaveAndClose']) {
    const body = dm.slice(dm.indexOf(`async function ${fn}`), dm.indexOf(`async function ${fn}`) + 520)
    assert.match(body, /\|\| !mountedRef\.current\) return/, fn + ' stops if the window is gone')
    assert.match(body, /later\(/, fn + ' uses the cancellable timer')
  }
})
test('a window that goes away reports "not dirty" so the parent guard can never keep a stale unsaved flag', () => {
  assert.match(dm, /useEffect\(\(\) => \(\) => \{ onDirtyChangeRef\.current\?\.\(false\) \}, \[\]\)/)
})

// ── 5. Listeners that were attached after cleanup had already run ────────────────────────────────────────────────────────────
test('the dropdowns cancel their delayed outside-click listener on cleanup (no listener left on the document)', () => {
  assert.equal((dm.match(/const t = setTimeout\(\(\) => document\.addEventListener\('mousedown', onOutside\), 10\)/g) || []).length, 2)
  assert.equal((dm.match(/return \(\) => \{ clearTimeout\(t\); document\.removeEventListener\('mousedown', onOutside\) \}/g) || []).length, 2)
  assert.ok(!/^\s*setTimeout\(\(\) => document\.addEventListener\('mousedown', onOutside\), 10\)$/m.test(dm), 'no un-cancelled registration remains')
})

// ── 6. The page scroll lock — executed for real ──────────────────────────────────────────────────────────────────────────────
function loadLockHook() {
  const code = ts.transpileModule(read('components/xpadite/useLockBodyScroll.ts'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
  const effects = []                                                    // every mounted component's effect cleanup
  const style = { overflow: '', position: '', top: '', left: '', width: '' }
  const win = { innerWidth: 390, scrollY: 0, scrollTo() {} }
  const sandbox = {
    exports: {}, module: { exports: {} },
    require: m => { if (m === 'react') return { useEffect: fn => { effects.push(fn()) } }; throw new Error('unexpected import ' + m) },
    window: win, document: { body: { style } }, navigator: { userAgent: 'test', platform: 'Win32', maxTouchPoints: 0 },
  }
  vm.runInNewContext(code, sandbox); const hook = (sandbox.module.exports.useLockBodyScroll ? sandbox.module.exports : sandbox.exports).useLockBodyScroll
  return { hook, effects, style, win }
}
const locked = s => s.overflow === 'hidden'

test('scroll lock: one modal locks the page and releases it (unchanged behaviour)', () => {
  const { hook, effects, style } = loadLockHook()
  hook(); assert.ok(locked(style)); effects[0](); assert.equal(style.overflow, ''); assert.equal(style.position, '')
})
test('scroll lock: overlapping modals closing in ANY order always leave the page unlocked (used to freeze the page)', () => {
  for (const order of [[0, 1], [1, 0]]) {
    const { hook, effects, style } = loadLockHook()
    hook(); hook(); assert.ok(locked(style))
    effects[order[0]](); assert.ok(locked(style), 'still locked while the other modal is open')
    effects[order[1]](); assert.equal(style.overflow, '', 'order ' + order + ': released after the last one'); assert.equal(style.position, '')
  }
})
test('scroll lock: three overlapping modals, same-render unmount, and a double release are all safe', () => {
  const { hook, effects, style } = loadLockHook()
  hook(); hook(); hook()
  effects[1](); effects[1]()                                            // double release of the same modal must not under-count
  assert.ok(locked(style)); effects[0](); assert.ok(locked(style)); effects[2](); assert.equal(style.overflow, '')
  hook(); assert.ok(locked(style), 'can lock again afterwards'); effects[3](); assert.equal(style.overflow, '')
})
test('scroll lock: tablet/desktop (>=640px) uses the full freeze and restores everything, in any order', () => {
  const { hook, effects, style, win } = loadLockHook(); win.innerWidth = 1024; win.scrollY = 120
  hook(); hook(); assert.equal(style.position, 'fixed'); assert.equal(style.top, '-120px')
  effects[0](); assert.equal(style.position, 'fixed'); effects[1]()
  assert.equal(style.position, ''); assert.equal(style.overflow, ''); assert.equal(style.top, ''); assert.equal(style.width, '')
})

// ── 7. Taps during the close animation ───────────────────────────────────────────────────────────────────────────────────────────
test('a second tap on Cancel during the fade is absorbed (it used to fall through and open an unrelated day)', () => {
  const root = dm.slice(dm.indexOf('const visible = isMounted && !isClosing'), dm.indexOf('{/* Purple ambient glow'))
  assert.ok(!/pointerEvents: isClosing/.test(root), 'the closing window no longer switches pointer events off')
  assert.match(dm, /hands control back after 1\.5s/)
})

// ── 8. The toast sat on top of Cancel / Save ─────────────────────────────────────────────────────────────────────────────────────
test('a toast never swallows taps meant for the screen under it (only its own ✕ takes input)', () => {
  const css = read('app/globals.css')
  const rule = css.slice(css.indexOf('.xp-toast-wrapper {'), css.indexOf('@media (max-width: 639px)', css.indexOf('.xp-toast-wrapper {')))
  assert.match(rule, /z-index: 200;[\s\S]*pointer-events: none;/)
  assert.match(rule, /\.xp-toast-wrapper button \{ pointer-events: auto; \}/)
})

// ── 9. Escape belongs to the top-most layer (final audit) ────────────────────────────────────────────────────────────────────────
function loadEscapeLayers() {
  const code = ts.transpileModule(read('components/xpadite/escapeLayers.ts'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
  const mounted = []; const listeners = new Set()
  const sandbox = {
    exports: {}, module: { exports: {} },
    require: m => { if (m === 'react') return { useRef: v => ({ current: v }), useEffect: fn => { mounted.push(fn) } }; throw new Error('unexpected import ' + m) },
    window: { addEventListener: (t, f) => { if (t === 'keydown') listeners.add(f) }, removeEventListener: (t, f) => { listeners.delete(f) } },
  }
  vm.runInNewContext(code, sandbox)
  const api = sandbox.module.exports.useEscapeLayer ? sandbox.module.exports : sandbox.exports
  // "mount" a component using the hook: run its effect now, return its cleanup
  const mount = (active, onEscape) => {                              // run every effect the hook registered, return the layer's cleanup
    const before = mounted.length; api.useEscapeLayer(active, onEscape)
    const cleanups = mounted.slice(before).map(fn => fn()).filter(Boolean)
    return cleanups.length ? () => cleanups.forEach(c => c()) : undefined
  }
  const press = key => listeners.forEach(f => f({ key }))
  return { api, mount, press, listeners }
}
test('escape layers: a layer is counted while it is open and removed when it closes or unmounts (never leaks)', () => {
  const { api, mount } = loadEscapeLayers()
  assert.equal(api.hasEscapeLayer(), false)
  const a = mount(true), b = mount(true); assert.equal(api.hasEscapeLayer(), true)
  a(); assert.equal(api.hasEscapeLayer(), true, 'one layer still open'); b(); assert.equal(api.hasEscapeLayer(), false)
  assert.equal(mount(false), undefined, 'an inactive layer registers nothing')
  assert.equal(api.hasEscapeLayer(), false)
})
test('escape layers: a layer with its own close handler gets Escape (and only Escape); one without adds no handler of its own', () => {
  const { mount, press, listeners, api } = loadEscapeLayers()
  let closed = 0; const off = mount(true, () => { closed++ })
  press('Enter'); assert.equal(closed, 0); press('Escape'); assert.equal(closed, 1)
  off(); press('Escape'); assert.equal(closed, 1, 'no handler left after it closed'); assert.equal(listeners.size, 0)
  const off2 = mount(true); press('Escape'); assert.equal(api.hasEscapeLayer(), true); off2()
})
test('escape layers: the answer is the state when asked, so a layer that closes itself first can not make the window underneath close too', () => {
  const { api, mount, press } = loadEscapeLayers()
  const asked = []
  const off = mount(true, () => { off() })                        // the dropdown closes itself on Escape...
  asked.push(api.hasEscapeLayer())                                // ...the window underneath decided BEFORE (capture phase): a layer was open
  press('Escape'); asked.push(api.hasEscapeLayer())
  assert.deepEqual(asked, [true, false])
})
test('every nested layer in the Task Manager announces itself; the Task Manager decides top-down in the capture phase', () => {
  const need = { 'DayModal.tsx': 10, 'TransferTaskModal.tsx': 1, 'SendToPlannerModal.tsx': 1, 'ReminderModal.tsx': 1, 'attachmentUtils.tsx': 2 }
  for (const [f, n] of Object.entries(need)) assert.equal((read('components/xpadite/' + f).match(/useEscapeLayer\(/g) || []).length, n, f)
  const esc = dm.slice(dm.indexOf("if (e.key !== 'Escape' || suspendedRef.current) return"), dm.indexOf('}, [hasDirtyChanges, onClose, showCloseDialog, pendingDeleteId])'))
  const order = ['hasEscapeLayer()', 'if (showCloseDialog)', 'if (pendingDeleteId)', 'if (hasDirtyChanges)'].map(s => esc.indexOf(s))
  assert.ok(order.every(i => i >= 0) && order.every((v, i) => i === 0 || v > order[i - 1]), 'nested layer, then prompt, then delete-confirm, then close: ' + order)
  assert.match(esc, /addEventListener\('keydown', onKey, true\)/); assert.match(esc, /removeEventListener\('keydown', onKey, true\)/)
  for (const s of ['useEscapeLayer(true)   // a layer that deliberately ignores Escape', 'useEscapeLayer(isEditing)', 'useEscapeLayer(addingTask)', 'useEscapeLayer(emojiOpen', 'useEscapeLayer(showPopover']) assert.ok(dm.includes(s), s)
})

// ── 10. Save and Close / Cancel under failures (final audit) ─────────────────────────────────────────────────────────────────────
test('the toast can not cover Cancel / Save, and a failed save keeps the edit', () => {
  assert.match(read('app/globals.css'), /\.xp-toast-wrapper \{[\s\S]*?pointer-events: none;/)
  assert.ok(dm.includes("if (res === 'slow')") && dm.includes('kept on this device'), 'a slow/failed save never drops the edit')
})

// ── 11. Unsaved-changes state follows what the server has confirmed (v1.338 follow-up) ────────────────────────────────────────────
test('the sync queue tells windows when a day is confirmed, without updating state inside the queue/updater', () => {
  const ctx = read('components/xpadite/AppContext.tsx')
  assert.match(ctx, /subscribeDaySync: \(listener: \(\) => void\) => \(\) => void/)
  assert.match(ctx, /isDayUnsynced: \(key: string\) => boolean/)
  assert.match(ctx, /onUnsyncedChange: keys => \{\s*\/\/[^\n]*\n\s*queueMicrotask\(\(\) => daySyncListenersRef\.current\.forEach\(fn => \{ try \{ fn\(\) \} catch \{\} \}\)\)/, 'listeners run in a microtask')
  assert.match(ctx, /const isDayUnsynced = useCallback\(\(key: string\) => daySync\.hasUnsynced\(key\), \[daySync\]\)/)
  assert.match(ctx, /resolveDayConflict, subscribeDaySync, isDayUnsynced,/, 'exposed on the context')
})
test('a save that was not confirmed is adopted as saved only once the server confirms it — and only that version', () => {
  const i = dm.indexOf('const pendingSaveRef'), j = dm.indexOf('async function handleMainSave')
  const b = dm.slice(i, j)
  assert.ok(i > 0 && j > i)
  const adopt = b.slice(b.indexOf('function adoptConfirmedSave'), b.indexOf('const adoptRef'))
  assert.match(adopt, /if \(!asked \|\| !mountedRef\.current \|\| isDayUnsynced\(dateKey\)\) return/, 'nothing happens while the day is still queued / in flight / failed, or after unmount')
  assert.match(adopt, /openSnapshotRef\.current = asked/, 'the baseline becomes exactly what the user asked to save — not whatever was typed afterwards')
  assert.match(adopt, /setBaselineTick\(n => n \+ 1\)/, 'the dirty state is recomputed')
  assert.match(b, /useEffect\(\(\) => subscribeDaySync\(\(\) => adoptRef\.current\(\)\), \[subscribeDaySync\]\)/, 'subscribed, and unsubscribed on unmount')
  assert.match(b, /const asked: DayData = JSON\.parse\(JSON\.stringify\(dayDataRef\.current\)\)/, 'snapshot taken when Save is pressed')
  assert.match(b, /if \(res === true\) pendingSaveRef\.current = null\s*\n\s*else \{ pendingSaveRef\.current = asked; adoptRef\.current\(\) \}/, 'cleared on a confirmed save, kept (and checked at once) otherwise')
  assert.ok(!/hasDirtyChanges[\s\S]{0,40}isDayUnsynced/.test(dm), 'a background auto-sync alone never clears the warning: only an explicit Save that was awaiting confirmation does')
})

// ── 12. The embedded journal editor owns Escape while it is being used ──────────────────────────────────────────────────────────
test('the embedded journal editor: emoji picker and the focused text field are Escape layers (IME composition respected)', () => {
  const je = read('components/xpadite/JournalEditorEmbed.tsx')
  assert.match(je, /import \{ useEscapeLayer \} from '\.\/escapeLayers'/)
  assert.match(je, /useEscapeLayer\(showEmoji, \(\) => setShowEmoji\(false\)\)/)
  assert.match(je, /useEscapeLayer\(editorFocused, e => \{ if \(!e\.isComposing\) editor\?\.commands\.blur\(\) \}\)/)
  assert.match(je, /onFocus: \(\) => setEditorFocused\(true\),\s*onBlur: \(\) => setEditorFocused\(false\),/)
  // the camera and the photo lightbox it opens were already layers
  assert.ok(/useEscapeLayer\(true\)/.test(read('components/xpadite/attachmentUtils.tsx')))
})
test('escape layers: the handler receives the key event (so a layer can respect IME composition)', () => {
  const { mount, press } = loadEscapeLayers()
  const seen = []; mount(true, e => seen.push(e.key))
  press('Escape'); assert.deepEqual(seen, ['Escape'])
  assert.match(read('components/xpadite/escapeLayers.ts'), /onEscape\?: \(e: KeyboardEvent\) => void/)
})
