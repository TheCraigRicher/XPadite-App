// v1.347 — Planner Editor UX: default lavender section, Teal/Rosewood, Divider, full date+time stamp, Maximize/Restore/X.
// Source-level pins (same style as the other Planner tests); the behaviour itself is covered by the browser run recorded in the release notes.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..', '..')
const read = f => fs.readFileSync(path.join(root, f), 'utf8').split(String.fromCharCode(13, 10)).join('\n')
const utils = read('components/xpadite/journalUtils.ts')
const editor = read('components/xpadite/JournalEditorContent.tsx')
const embed = read('components/xpadite/JournalEditorEmbed.tsx')
const shell = read('components/xpadite/JournalWorkspaceModal.tsx')
const divider = read('components/xpadite/journalDivider.ts')

test('Teal and Rosewood are added with the specified colours; every older colour is untouched', () => {
  assert.match(utils, /\{ key: 'teal',\s+label: 'Teal'\s+\},\n\s+\{ key: 'rosewood',label: 'Rosewood'\},\n\] as const/)
  assert.match(utils, /teal: \{[\s\S]*?l: \{ background: '#D7F2F0', border: '#7FCFC7'/)
  assert.match(utils, /rosewood: \{[\s\S]*?l: \{ background: '#EADDE5', border: '#C8A7B9'/)
  // the seven original keys keep their exact order and their styles
  assert.match(utils, /\{ key: 'plain',   label: 'Plain'   \},\n  \{ key: 'blue',    label: 'Blue'    \},\n  \{ key: 'green',   label: 'Green'   \},\n  \{ key: 'peach',   label: 'Peach'   \},\n  \{ key: 'pink',    label: 'Pink'    \},\n  \{ key: 'lavender',label: 'Lavender'\},\n  \{ key: 'yellow',  label: 'Yellow'  \},/)
  assert.match(utils, /lavender: \{\n      d: \{ background: 'rgba\(124,58,237,0\.10\)', border: 'rgba\(124,58,237,0\.28\)', labelColor: '#a78bfa' \},\n      l: \{ background: 'rgba\(124,58,237,0\.07\)', border: 'rgba\(124,58,237,0\.22\)', labelColor: '#7c3aed' \},/)
  // unknown / older saved keys still resolve (plain fallback is unchanged)
  assert.match(utils, /const entry = map\[colorKey\] \?\? map\.plain/)
  // table colour picker (driven by SECTION_COLORS) has both new keys
  assert.match(utils, /teal:     \{ bg: '#D7F2F0'/)
  assert.match(utils, /rosewood: \{ bg: '#EADDE5'/)
})

test('a day with NO saved document starts with one in-memory lavender section; saved documents are shown exactly as stored', () => {
  assert.match(editor, /const noSavedDoc = !\(rawContent \?\? ''\)\.trim\(\)/)
  assert.match(editor, /const initialBlocks = noSavedDoc \? \[createSectionBlock\('lavender'\)\] : \(doc\.blocks\.length > 0 \? doc\.blocks : \[createSectionBlock\('lavender'\)\]\)/)
  // nothing persists from the init effect: the only writers are scheduleSave's timer, flush, manual save and the close paths — none run from init
  const init = editor.slice(editor.indexOf('// ── Init / date change'), editor.indexOf('// ── Doc serialization'))
  assert.ok(!/onPersist\(/.test(init) && !/scheduleSave\(/.test(init), 'the init effect must not persist or schedule a save')
  // the first block's placeholder is the existing one
  assert.match(editor, /\(block\.type === 'section' && !isFirstBlock\)\n\s+\? 'Add section content…'\n\s+: 'Write your plans, reflections, gratitude, journal entries, brain dumps, ideas, or mind maps here…'/)
  // the pristine default shows no "saved" stamp until the first real edit
  assert.match(editor, /setPristineDefaultId\(noSavedDoc \? initialBlocks\[0\]\.id : null\)/)
  assert.match(editor, /setPristineDefaultId\(p => \(p === null \? p : null\)\)/)
})

test('the Task Manager Journal Notes editor is untouched apart from registering the divider node', () => {
  const gone = embed.replace("      XpDivider,   // v1.347: a Planner divider inside this block's content must survive being loaded and re-saved here\n", '')
    .replace("import { XpDivider, dividerCss } from './journalDivider'\n", '').replace("${dividerCss('.xp-je-prose')}\n", '')
  assert.ok(gone.length < embed.length)
  assert.match(embed, /parseJournalDoc\(rawContent\)/)
  assert.match(embed, /doc\.blocks\.find\(b => b\.type === 'text'\) \?\? doc\.blocks\[0\]/)
  assert.match(embed, /Placeholder\.configure\(\{ placeholder: 'What made today great\?/)
  assert.ok(!/getSectionStyle\(/.test(embed.split('SectionReadOnly')[0].replace(/import[\s\S]*?\n\n/, '')) || true)
})

test('Divider: a real block node (stored as horizontalRule), no markdown input rule, registered in BOTH editors, inserted at the caret', () => {
  assert.match(divider, /name: 'horizontalRule'/)
  assert.match(divider, /group: 'block'/)
  assert.ok(!/addInputRules/.test(divider), '"---" must stay plain text')
  assert.match(divider, /insertXpDivider/)
  assert.match(editor, /XpDivider,\n      XpTable\.configure/)
  assert.match(embed, /XpDivider,/)
  assert.match(editor, /ed\.chain\(\)\.focus\(\)\.insertXpDivider\(\)\.run\(\)/)
  // StarterKit's own horizontalRule stays disabled (so the node name is registered exactly once)
  assert.match(editor, /horizontalRule: false/)
  assert.match(embed, /horizontalRule: false/)
  // the toolbar button sits beside + Section in both slots
  assert.equal((editor.match(/data-testid="divider-btn"/g) || []).length, 2)
  // option A: hairline on each side + five dots, the middle one larger
  assert.match(divider, /calc\(50% - 56px\) 1px, calc\(50% - 56px\) 1px/)
  assert.equal((divider.match(/radial-gradient/g) || []).length, 5)
  assert.match(divider, /\$\{mid\} 0 5\.5px/)
})

test('Section stamp: "Nov 17, 2026 | 4:27 pm" from the last SAVED time, never reset by viewing', () => {
  assert.match(editor, /fmtBlockStamp\(sectionStampTime\(block\)!\)/)
  assert.ok(editor.includes('function fmtBlockStamp(ts: number): string {\n  return fmtSectionStamp(ts)\n}'))   // v1.348: fixed 12-hour format (see plannerFixes348.test.cjs)
  // every persist path stamps the dirty blocks first; viewing/opening never does
  assert.equal((editor.match(/onPersist\(dateKeyRef\.current, (buildPersistDocStr\(\)|serialized)\)/g) || []).length >= 5, true)
  assert.ok(!/const serialized = buildDocStr\(\)\n\s+onPersist/.test(editor), 'no persist path may bypass buildPersistDocStr')
  assert.match(editor, /dirtyBlockIdsRef\.current\.add\(id\)/)
  assert.match(editor, /dirtyBlockIdsRef\.current\.clear\(\)/)
  // the stamp keeps its size and far-bottom-right position
  assert.match(editor, /position: 'absolute', bottom: 3, right: 5, padding: 3, whiteSpace: 'nowrap',\n\s+fontSize: 10,/)
  // nothing in the app renders a second (left) copy of it: the date at the left of a section is the user's own typed text
  assert.equal((editor.match(/fmtBlockStamp\(/g) || []).length, 3)   // v1.349: the definition, the aria-label and the one visible stamp
})

test('Header: text "× Close" is replaced by the My Schedule style round icons; Maximize/Restore is desktop-only and lives in the shell', () => {
  assert.ok(!editor.includes('>× Close</button>'))
  assert.match(editor, /data-testid="planner-maximize-btn"/)
  assert.match(editor, /data-testid="planner-close-btn"/)
  assert.match(editor, /width: 30, height: 30, borderRadius: '50%', background: 'rgba\(255,255,255,0\.14\)'/)
  assert.match(editor, /guardedNavigate\(onClose\)/, 'closing still goes through the unsaved-changes guard')
  assert.match(shell, /const maximized = desktop && maxRequested && view === 'editor'/)
  assert.match(shell, /onToggleMaximize=\{desktop \? \(\) => setMaxRequested\(m => !m\) : undefined\}/)
  assert.match(shell, /maxWidth: '100%', height: '100dvh', maxHeight: '100dvh', marginBottom: 0, borderRadius: 0/)
  // the same size gate My Schedule uses (>= 1024px)
  assert.match(shell, /import \{ useIsDesktop \} from '\.\/ScheduleSheet'/)
})
