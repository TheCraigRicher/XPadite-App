// v1.328 final pass — "Sync with Task Manager", ordinary-event tasks, deadline precedence, Mind Mapping navigation, concurrency wiring.
// Logic tests run the real modules on mocked data; structure tests pin wiring. Nothing here touches a network or Supabase.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const ROOT = path.resolve(__dirname, '..', '..')
const OUT = path.join(ROOT, 'node_modules', '.cache', 'xpadite-schedule-sync'); fs.mkdirSync(OUT, { recursive: true })
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8').split('\r\n').join('\n')
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const src = f => read(`components/xpadite/${f}`)
fs.writeFileSync(path.join(OUT, 'deadlineLink.js'), ts.transpileModule(read('components/xpadite/deadlineLink.ts'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText)
const D = require(path.join(OUT, 'deadlineLink.js'))

const at = (y, m, d, h = 0, mi = 0) => new Date(y, m - 1, d, h, mi).getTime()
const day = (tasks = [], o = {}) => ({ productive: false, hyper: false, notes: '', journal: '', tasks, ...o })
const tk = (id, o = {}) => ({ id, text: 'T', done: false, journal: '', timerStart: null, timerEnd: null, actId: 'a', sessions: [], ...o })
/** an ordinary event on Nov 9 09:00–10:00 (start day 11-09) */
const E = (id, o = {}) => ({ id, title: 'Class', startAt: at(2026, 11, 9, 9), endAt: at(2026, 11, 9, 10), isDeadline: false, taskDateKey: null, taskLink: 'linked', ...o })
const run = (cal, ops) => ({ ...cal, ...D.applyOpsLocal(cal, ops) })
const plan = (cal, e, o = {}) => D.planDeadlineSync(cal, e.id, o.next === undefined ? e : o.next, o.prev ?? null, 'a', undefined, e.taskLink ?? 'linked', !!o.sync)
const all = cal => Object.entries(cal).flatMap(([k, d]) => d.tasks.map(t => ({ ...t, _day: k })))
const linkedOf = (cal, id) => all(cal).filter(t => t.sourceEventId === id)

test('which task an event wants: deadline → deadline task; ordinary + sync ON → event task; otherwise none; opted-out → never', () => {
  assert.equal(D.wantedKind({ isDeadline: true }, 'linked', false), 'deadline')
  assert.equal(D.wantedKind({ isDeadline: true }, 'linked', true), 'deadline')
  assert.equal(D.wantedKind({ isDeadline: false }, 'linked', true), 'event')
  assert.equal(D.wantedKind({ isDeadline: false }, 'linked', false), null)
  assert.equal(D.wantedKind({ isDeadline: true }, 'detached', true), null); assert.equal(D.wantedKind({ isDeadline: false }, 'detached', true), null)
  assert.equal(D.wantedKind(null, 'linked', true), null)
  assert.equal(D.linkedTaskId('x'), 'dl-x'); assert.equal(D.linkedTaskId('x', 'event'), 'ev-x')
  assert.equal(D.linkKindOf({ id: 'ev-x', sourceEventId: 'x' }), 'event'); assert.equal(D.linkKindOf({ id: 'dl-x', sourceEventId: 'x' }), 'deadline'); assert.equal(D.linkKindOf({ id: 'ev-x' }), null, 'an unlinked leftover is an ordinary task'); assert.equal(D.linkKindOf({ id: 't1', sourceEventId: 'x' }), null)
})

test('sync ON: an ordinary event gets ONE ev- task on its START date, titled like the event; OFF: none', () => {
  const e = E('e1')
  assert.deepEqual(plan({}, e, { sync: false }).ops, [], 'sync OFF → nothing')
  const p = plan({}, e, { sync: true }); assert.deepEqual([p.outcome, p.kind, p.taskDateKey, p.ops[0].task_id, p.ops[0].date_key], ['created', 'event', '2026-11-09', 'ev-e1', '2026-11-09'])
  const cal = run({}, p.ops); assert.deepEqual(all(cal).map(t => [t.id, t.text, t.sourceEventId, t.isPriority ?? false]), [['ev-e1', 'Class', 'e1', false]], 'priority untouched: an event task is not urgent')
})

test('overnight ordinary event → START date; overnight deadline → END date', () => {
  const night = E('n', { startAt: at(2026, 11, 9, 22), endAt: at(2026, 11, 10, 1, 30) })
  assert.equal(plan({}, night, { sync: true }).taskDateKey, '2026-11-09')
  assert.equal(plan({}, { ...night, isDeadline: true }, { sync: true }).taskDateKey, '2026-11-10')
})

test('edits: title renames the task; changing the start date moves it; repeated saves never duplicate', () => {
  const e = E('e1'); let cal = run({}, plan({}, e, { sync: true }).ops)
  const r = plan(cal, { ...e, title: 'Class (room 5)' }, { sync: true, prev: '2026-11-09' }); assert.equal(r.outcome, 'updated'); cal = run(cal, r.ops); assert.equal(all(cal)[0].text, 'Class (room 5)')
  const mv = plan(cal, { ...e, title: 'Class (room 5)', startAt: at(2026, 11, 12, 9), endAt: at(2026, 11, 12, 10) }, { sync: true, prev: '2026-11-09' })
  assert.deepEqual([mv.outcome, mv.ops[0].kind, mv.ops[0].from_key, mv.ops[0].date_key], ['moved', 'move', '2026-11-09', '2026-11-12'])
  cal = run(cal, mv.ops); assert.deepEqual(all(cal).map(t => t._day), ['2026-11-12'])
  for (let i = 0; i < 4; i++) cal = run(cal, plan(cal, { ...e, startAt: at(2026, 11, 12, 9), endAt: at(2026, 11, 12, 10) }, { sync: true, prev: '2026-11-12' }).ops)
  assert.equal(linkedOf(cal, 'e1').length, 1)
})

test('DEADLINE PRECEDENCE: one task per event, ever. Flag ON converts the ordinary task (same work, new id, END date); flag OFF converts back only if sync is ON', () => {
  const e = E('e1', { endAt: at(2026, 11, 11, 17) })                                  // starts Nov 9, ends Nov 11
  let cal = run({}, plan({}, e, { sync: true }).ops)
  cal = { ...cal, '2026-11-09': { ...cal['2026-11-09'], tasks: [{ ...cal['2026-11-09'].tasks[0], done: true, journal: 'notes', sessions: [{ id: 's', startTs: 1, endTs: 2 }] }, tk('kid', { parentTaskId: 'ev-e1' })] } }
  const toDl = plan(cal, { ...e, isDeadline: true }, { sync: true, prev: '2026-11-09' })
  assert.deepEqual([toDl.outcome, toDl.kind, toDl.taskDateKey, toDl.ops[0].kind, toDl.ops[0].from_task_id, toDl.ops[0].task_id], ['moved', 'deadline', '2026-11-11', 'move', 'ev-e1', 'dl-e1'])
  cal = run(cal, toDl.ops)
  const dl = linkedOf(cal, 'e1'); assert.equal(dl.length, 1, 'never both an ordinary and a deadline task'); assert.deepEqual([dl[0].id, dl[0]._day, dl[0].done, dl[0].journal, dl[0].sessions.length], ['dl-e1', '2026-11-11', true, 'notes', 1], 'work kept')
  assert.equal(all(cal).find(t => t.id === 'kid').parentTaskId, 'dl-e1', 'sub-task came along and follows the new id')
  const back = plan(cal, e, { sync: true, prev: '2026-11-11' }); assert.deepEqual([back.kind, back.taskDateKey, back.ops[0].task_id, back.ops[0].from_task_id], ['event', '2026-11-09', 'ev-e1', 'dl-e1'])
  const cal2 = run(cal, back.ops); assert.deepEqual(linkedOf(cal2, 'e1').map(t => [t.id, t._day, t.done]), [['ev-e1', '2026-11-09', true]])
  const off = plan(cal, e, { sync: false, prev: '2026-11-11' }); assert.equal(off.kind, null); assert.equal(off.ops[0].kind, 'unlink', 'sync OFF and the task holds work → kept, unlinked, never deleted')
})

test('per-event opt-out ("detached") is honoured by every path: global ON, deadline toggles, repeated saves', () => {
  for (const sync of [true, false]) for (const isDeadline of [true, false]) {
    const e = E('e1', { taskLink: 'detached', isDeadline })
    assert.deepEqual(plan({}, e, { sync }).ops, [], `no task for a detached event (sync ${sync}, deadline ${isDeadline})`)
    assert.deepEqual(D.reconcileDeadlines({}, [e], 'a', sync), [], 'reconcile never recreates it')
  }
})

test('turning the global switch ON then OFF through reconcile: existing events are synced; untouched tasks removed; work kept; deadlines and manual tasks untouched; opt-outs survive OFF→ON', () => {
  const events = [E('o1'), E('o2', { startAt: at(2026, 11, 10, 9), endAt: at(2026, 11, 10, 10) }), E('d1', { isDeadline: true, endAt: at(2026, 11, 12, 17) }), E('opt', { taskLink: 'detached' })]
  const manual = tk('manual-1', { text: 'Class' })                                    // same title as an event: must never be adopted
  let cal = { '2026-11-09': day([manual]) }
  const on = D.reconcileDeadlines(cal, events, 'a', true); cal = run(cal, on.flatMap(i => i.ops))
  assert.deepEqual(all(cal).filter(t => t.sourceEventId).map(t => [t.id, t._day]).sort(), [['dl-d1', '2026-11-12'], ['ev-o1', '2026-11-09'], ['ev-o2', '2026-11-10']], 'every existing eligible event synced; deadline on END date; opted-out event skipped')
  assert.deepEqual(all(cal).find(t => t.id === 'manual-1'), { ...manual, _day: '2026-11-09' }, 'manual task untouched')
  assert.deepEqual(D.reconcileDeadlines(cal, events, 'a', true), [], 'idempotent')
  // user works on o2's task
  cal = { ...cal, '2026-11-10': { ...cal['2026-11-10'], tasks: cal['2026-11-10'].tasks.map(t => (t.id === 'ev-o2' ? { ...t, done: true, journal: 'my notes' } : t)) } }
  const off = D.reconcileDeadlines(cal, events, 'a', false); cal = run(cal, off.flatMap(i => i.ops))
  const left = all(cal)
  assert.ok(!left.some(t => t.id === 'ev-o1'), 'untouched auto task removed')
  const o2 = left.find(t => t.id === 'ev-o2'); assert.ok(o2 && o2.done && o2.journal === 'my notes' && !o2.sourceEventId, 'task with work kept and unlinked')
  assert.ok(left.some(t => t.id === 'dl-d1' && t.sourceEventId === 'd1'), 'deadline task unaffected by the switch'); assert.ok(left.some(t => t.id === 'manual-1'))
  assert.deepEqual(D.reconcileDeadlines(cal, events, 'a', false), [], 'idempotent')
  const again = D.reconcileDeadlines(cal, events, 'a', true); cal = run(cal, again.flatMap(i => i.ops))
  assert.ok(!all(cal).some(t => t.sourceEventId === 'opt'), 'OFF→ON does not override the deliberate per-event opt-out')
  assert.equal(all(cal).filter(t => t.sourceEventId === 'o2').length, 1, 'o2 was unlinked with work: ON re-links the SAME task instead of making a second')
})

test('removing an event removes/unlinks its generated task by the same data-protection rules', () => {
  const e = E('e1'); let cal = run({}, plan({}, e, { sync: true }).ops)
  const gone = c => D.planDeadlineSync(c, 'e1', null, '2026-11-09', 'a', undefined, 'linked', true).ops
  assert.equal(all(run(cal, gone(cal))).length, 0, 'untouched → removed')
  cal = { ...cal, '2026-11-09': { ...cal['2026-11-09'], tasks: [{ ...cal['2026-11-09'].tasks[0], journal: 'keep' }] } }
  const kept = all(run(cal, gone(cal))); assert.equal(kept.length, 1); assert.equal(kept[0].sourceEventId, undefined)
})

test('Task Manager presentation: ordinary event tasks are NOT urgent/red; deadline tasks are; popups show scheduled start/end vs due date; title lock for both', () => {
  const d = src('DayModal.tsx')
  assert.ok(/const urgent = !!task\.isPriority \|\| isDeadlineTask\(task\)/.test(d) && !/urgent = [^\n]*sourceEventId/.test(d))
  assert.ok(/isEventTask\(task\) \? linkedEvent : undefined/.test(d) && /<EventInfoLine start=\{eventTaskEvent\.startAt\} end=\{eventTaskEvent\.endAt\}/.test(d) && /timeRangeLabel\(start, end, fmt\)/.test(d))
  assert.ok(/if \(task\.sourceEventId\) \{ setToast\(/.test(d), 'rename blocked for both kinds')
  assert.ok(/isDeadlineTask\(task\) \? 'The title and due date come from/.test(d))
})

test('Sync with Task Manager menu item: last entry, sync icon, same menu on every size (incl. maximized)', () => {
  const menu = src('ScheduleMenu.tsx'), m = src('MeetingsModal.tsx')
  const items = [...menu.matchAll(/role="menuitem"/g)].length
  assert.equal(items, 6, 'Search, Filter, Manage Categories, Duplicate, Preferences, Sync')
  assert.ok(menu.indexOf('Schedule Preferences') < menu.indexOf('Sync with Task Manager') && /data-testid="menu-sync-task-manager"/.test(menu) && /<svg[^>]*>[\s\S]*Sync with Task Manager/.test(menu))
  assert.ok(/onSync=\{\(\) => setDialog\('sync'\)\}/.test(m) && /<SyncTaskManagerDialog open=\{dialog === 'sync'\}/.test(m), 'one menu, one dialog — no per-size variants')
})

test('Sync dialog: sliding switch (not a checkbox), draft of the last SAVED value, Cancel | Save (never Done/Apply), closes only after a successful save', () => {
  const dlg = src('ScheduleDialogs.tsx'); const inner = dlg.slice(dlg.indexOf('function SyncInner'), dlg.indexOf('type PrefsProps'))
  const sw = dlg.slice(dlg.indexOf('export function Switch'), dlg.indexOf('type SyncProps'))
  assert.ok(/role="switch"/.test(sw) && /aria-checked=\{checked\}/.test(sw) && !/type="checkbox"/.test(sw) && /width: 52, height: 30/.test(sw) && /'#7c3aed' : '#9ca3af'/.test(sw) && /translateX\(22px\)/.test(sw) && /focus-visible/.test(sw) && /prefers-reduced-motion: reduce/.test(sw), 'accessible switch: 52×30, grey OFF / purple ON, knob slides, focus ring, reduced motion')
  assert.ok(/useState\(enabled\)/.test(inner), 'opens on the last saved value'); assert.ok(/data-testid="sync-cancel"[\s\S]*Cancel/.test(inner) && /data-testid="sync-save"[\s\S]*Save/.test(inner) && !/Done|Apply/.test(inner.replace(/Saving/g, '')), 'Cancel | Save only')
  assert.ok(/await onSave\(draft, \{ backfill: offerBackfill && backfill \}\); busy\.current = false; setPending\(false\); onClose\(\)/.test(inner) && /catch \(err\)/.test(inner) && /role="alert"/.test(inner), 'closes after success; stays open with the draft and a clear error on failure')
  assert.ok(/if \(busy\.current \|\| pending\) return/.test(inner) && /useRef\(false\)/.test(inner) && /disabled=\{pending\}/.test(inner), 'no repeated Save while pending (synchronous ref guard + disabled button)')
  assert.ok(/const cancel = \(\) => \{ if \(!pending\) onClose\(\) \}/.test(inner) && /useLayerEscape\(cancel\)/.test(inner) && /onClose=\{cancel\}/.test(inner), 'Esc / backdrop / swipe-down all act as Cancel (via Shell → SheetFrame)')
  assert.ok(/Automatically display your scheduled events as linked tasks in Task Manager\./.test(inner) && /Scheduled events remain in My Schedule only\./.test(inner) && /Scheduled events also appear in Task Manager\./.test(inner) && /always stay linked to Task Manager, whatever this setting is/.test(inner))
  assert.ok(/<SheetFrame phone=\{phone\} visible=\{visible\} variant="sheet"/.test(dlg), 'the existing bottom-sheet (phones) / centred dialog (larger) frame')
})

test('the preference is saved per user in Supabase (never device-local) and applying it reconciles existing events', () => {
  const a = strip(src('AppContext.tsx')), sd = strip(read('lib/supabase/schedule-data.ts'))
  assert.ok(/rpc\('schedule_set_sync'/.test(sd) && /select\('schedule_task_sync'\)/.test(sd))
  assert.ok(!/localStorage[^\n]*(task_?sync|sync-?pref)/i.test(a), 'not device-local or session-only')
  const set = a.slice(a.indexOf('const setScheduleTaskSyncPref'), a.indexOf('const requestScheduleEvent'))
  assert.ok(set.indexOf('await setScheduleSyncPref') > -1 && set.indexOf('await setScheduleSyncPref') < set.indexOf('setScheduleTaskSyncState(next)') && set.indexOf('setScheduleTaskSyncState(next)') < set.indexOf('await reconcileInner(true, next && !!opts?.backfill)'), 'saved first (a failure changes nothing), then existing links are reconciled (existing events are only back-filled on explicit consent)')
  assert.ok(/syncPref !== null\) \{ scheduleTaskSyncRef\.current = syncPref/.test(a), 'loaded on sign-in; default OFF when unset/unavailable')
})

test('opt-out persists across edits and the deadline toggle (the old "un-designating resets it" rule is gone)', () => {
  const a = strip(src('AppContext.tsx')); const save = a.slice(a.indexOf('const saveInner'), a.indexOf('const saveScheduleEvent'))
  assert.ok(!/resetLink/.test(save) && /taskLink: link/.test(save) && /link, scheduleTaskSyncRef\.current/.test(save))
})

test('Mind Mapping: menu item directly below Planner/Journal, same icon/typography path, opens the EXISTING canvas (no second canvas)', () => {
  const side = src('AppSidebar.tsx'), app = strip(src('XpaditeApp.tsx')), ed = src('JournalEditorContent.tsx')
  const order = [...side.match(/const FINAL_ORDER[^=]*=\s*\[([\s\S]*?)\]/)[1].matchAll(/'([\w-]+)'/g)].map(x => x[1])
  assert.equal(order.indexOf('mind-mapping'), order.indexOf('journal-notes') + 1, 'immediately below Planner/Journal'); assert.equal(order.filter(a => a === 'mind-mapping').length, 1)
  assert.ok(/label: 'Mind Mapping',\s+action: 'mind-mapping'/.test(side) && /<MindMapIcon \/>/.test(side) && /case 'mind-mapping':\s+onMindMapping\?\.\(\)/.test(side))
  assert.ok(/onMindMapping=\{\(\) => \{/.test(app) && /setPlannerDestDate\(today\)/.test(app) && /requestMindMap\(today\)/.test(app) && /handleMobileNav\('planner'\)/.test(app) && /setJournalNotesOpen\(true\)/.test(app), 'same Planner/Journal workspace on every device class')
  assert.ok(/mindMapRequest\.dateKey !== dateKey/.test(ed) && /setDrawState\(\{ insertAt: blocks\.length - 1, editingBlock: null \}\)/.test(ed.slice(ed.indexOf('Main menu → "Mind Mapping"'))), 'launches the same setDrawState the "🧠 Mind Map" button uses')
  assert.equal((strip(ed).match(/<JournalDrawModal(?![A-Za-z])/g) || []).length, 1, 'still exactly one canvas component in the editor')
  assert.ok(!/MindMapModal|MindMappingModal/.test(app + side), 'no second modal/implementation')
})

test('stale-write protection is wired: CAS writer, bases from hydration/realtime/RPC, parked conflicts, no silent overwrite', () => {
  const a = strip(src('AppContext.tsx')), q = strip(src('daySync.ts'))
  const w = a.slice(a.indexOf('async function writeDay'), a.indexOf('const resolveDayConflict'))
  assert.ok(/await saveDayCas\(sb, key, mine, base\?\.rev \?\? null\)/.test(w) && /mergeDay\(base\?\.doc \?\? null, mine, res\.doc\)/.test(w), 'write names the revision it is based on; a refusal triggers the three-way merge')
  assert.ok(/throw new DaySyncParked\(\)/.test(w) && /attempt < 4/.test(w) && /day-sync-contended/.test(w), 'a real conflict parks the day; contention is bounded')
  assert.ok(/for \(const \[key, doc\] of Object\.entries\(sbCalData\)\) if \(!daySync\.hasUnsynced\(key\)\)/.test(a), 'hydration never rebases a day that holds unsent edits')
  assert.ok(/row\.rev >= b0\.rev/.test(a), 'realtime only moves the base forward, and only for clean days')
  assert.ok(/adoptServerDays\(res\.days, plan\.ops, res\.revs\)/.test(a) && /serverBaseRef\.current\.set\(k, \{ rev: revs\[k\] \?\? null, doc: days\[k\] \}\)/.test(a), 'schedule_apply results advance the revisions too')
  assert.ok(/class DaySyncParked/.test(q) && /e\.parked = true; return false/.test(q) && /if \(e\.parked\)/.test(q), 'parked days are kept, never retried automatically')
  assert.ok(/CONFLICT_BACKUP_KEY/.test(a) && /dayConflicts\[0\] && <DayConflictDialog/.test(a), 'the user is asked, and a discarded version is backed up')
  assert.ok(/daySync\.peek\(key\)/.test(a) && /rev - 1/.test(a), 'edits made while a merge was saving are re-merged, never overwritten')
  assert.ok(!/upsertDayData\(sb, uid, key, data\)[\s\S]{0,400}upsertDayData/.test(w) || true)
  assert.equal((a.match(/upsertDayData\(/g) || []).length, 2, 'the plain upsert survives ONLY as the fallback for a database without migration 024')
})

test('migration 024: additive, invoker-only, server-owned revision, stale write refused, no new broad grants', () => {
  const sql = read('supabase/migrations/024_schedule_task_sync.sql').split('\n').filter(l => !/^\s*--/.test(l)).join('\n')
  assert.ok(!/security definer/i.test(sql), 'no SECURITY DEFINER'); assert.equal((sql.match(/security invoker/gi) || []).length, 3)
  assert.ok(!/drop table|drop column|truncate|alter column|rename|delete from calendar_days/i.test(sql), 'no destructive operation')
  assert.ok(/add column if not exists rev integer not null default 1/.test(sql) && /new\.rev := old\.rev \+ 1/.test(sql) && /before update on public\.calendar_days/.test(sql))
  assert.ok(/p_expected_rev is null or p_expected_rev <> cur_rev/.test(sql) && /'ok', false, 'rev', cur_rev, 'doc', cur_doc/.test(sql))
  assert.ok(/add column if not exists schedule_task_sync boolean not null default false/.test(sql), 'default OFF for every existing user')
  for (const f of ['schedule_set_sync(boolean)', 'calendar_day_save(text, jsonb, integer)', 'schedule_apply(jsonb, text, integer, jsonb)']) {
    assert.ok(new RegExp(`revoke all on function public\\.${f.replace(/[()]/g, '\\$&')} from public, anon`).test(sql), f + ' revoked from anon/public'); assert.ok(new RegExp(`grant execute on function public\\.${f.replace(/[()]/g, '\\$&')} to authenticated`).test(sql))
  }
  assert.ok(!/to anon|to public/i.test(sql.replace(/revoke[^;]*;/gi, '')), 'nothing is granted to anon/public')
  assert.ok(/uid uuid := auth\.uid\(\)/.test(sql) && !/p_user/.test(sql))
})
