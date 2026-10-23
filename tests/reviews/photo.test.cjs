// Review profile-photo visibility: client contract, image privacy (EXIF stripped), route/migration guards. Mocks only.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const sharp = require('sharp')

const ROOT = path.resolve(__dirname, '..', '..')
const OUT = path.join(ROOT, 'node_modules', '.cache', 'xpadite-reviews-photo-tests')
fs.mkdirSync(OUT, { recursive: true })
function load(rel, name) {
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8')
  fs.writeFileSync(path.join(OUT, name + '.js'), ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText)
  return require(path.join(OUT, name + '.js'))
}
const C = load('lib/reviews/client.ts', 'client')
const P = load('lib/reviews/photo.ts', 'photo')
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const good = { rating: 5, title: 'Great', profession: 'Student', body: 'I really like how everything fits together.' }

function fakeSb(handler) {
  const calls = []
  return { calls, rpc: async (name, args) => { calls.push({ name, args }); return handler(args, calls.length) }, from: () => ({ select: cols => ({ maybeSingle: async () => handler({ select: cols }, 0) }) }) }
}
async function withFetch(impl, fn) {
  const prev = global.fetch; const calls = []
  global.fetch = async (url, init) => { calls.push({ url, init }); return impl() }
  try { return await fn(calls) } finally { global.fetch = prev }
}

test('submit: the photo choice is sent as p_show_photo (true and false), and the public copy is then synced', async () => {
  for (const showPhoto of [true, false]) {
    const sb = fakeSb(() => ({ data: { id: 'r1', status: 'published', show_profile_photo: showPhoto }, error: null }))
    await withFetch(async () => ({ ok: true }), async fetchCalls => {
      const res = await C.submitReview(sb, { ...good, showPhoto })
      assert.equal(sb.calls[0].args.p_show_photo, showPhoto)
      assert.equal(res.ok, true); assert.equal(res.photoSynced, true)
      assert.equal(fetchCalls.length, 1); assert.equal(fetchCalls[0].url, '/api/reviews/photo'); assert.equal(fetchCalls[0].init.method, 'POST')
      assert.equal(fetchCalls[0].init.body, undefined, 'the user is never sent — the server uses the session')
    })
  }
})

test('submit: when the choice is left unspecified nothing is sent and no photo sync happens', async () => {
  const sb = fakeSb(() => ({ data: { id: 'r1', status: 'published' }, error: null }))
  await withFetch(async () => ({ ok: true }), async fetchCalls => {
    const res = await C.submitReview(sb, good)
    assert.ok(!('p_show_photo' in sb.calls[0].args)); assert.equal(res.photoSynced, null); assert.equal(fetchCalls.length, 0)
  })
})

test('submit: a failed photo sync never loses the review — it is reported so the user can retry', async () => {
  const sb = fakeSb(() => ({ data: { id: 'r1', status: 'published', show_profile_photo: true }, error: null }))
  await withFetch(async () => ({ ok: false }), async () => {
    const res = await C.submitReview(sb, { ...good, showPhoto: true })
    assert.equal(res.ok, true); assert.equal(res.photoSynced, false)
  })
  await withFetch(async () => { throw new Error('offline') }, async () => {
    const res = await C.submitReview(sb, { ...good, showPhoto: true })
    assert.equal(res.ok, true); assert.equal(res.photoSynced, false)
  })
})

test('submit: database not yet on migration 020 → review still saved (without the photo choice), no sync attempted', async () => {
  const sb = fakeSb((args) => 'p_show_photo' in args
    ? { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.submit_review(p_show_photo) in the schema cache' } }
    : { data: { id: 'r1', status: 'published' }, error: null })
  await withFetch(async () => ({ ok: true }), async fetchCalls => {
    const res = await C.submitReview(sb, { ...good, showPhoto: true })
    assert.equal(res.ok, true); assert.equal(sb.calls.length, 2); assert.ok(!('p_show_photo' in sb.calls[1].args))
    assert.equal(res.photoSynced, null); assert.equal(fetchCalls.length, 0)
  })
})

test('submit: real errors are not retried (unverified stays unverified)', async () => {
  const sb = fakeSb(() => ({ data: null, error: { message: 'email_not_verified' } }))
  const res = await C.submitReview(sb, { ...good, showPhoto: true })
  assert.equal(res.ok, false); assert.equal(res.code, 'email_not_verified'); assert.equal(sb.calls.length, 1)
})

test('fetchMyReview: returns the saved photo preference; falls back cleanly before migration 020', async () => {
  const withCol = fakeSb(a => ({ data: { id: 'r', show_profile_photo: false }, error: null }))
  assert.equal((await C.fetchMyReview(withCol)).show_profile_photo, false)
  let n = 0
  const old = fakeSb(a => (n++ === 0 ? { data: null, error: { message: 'column reviews.show_profile_photo does not exist' } } : { data: { id: 'r', rating: 4 }, error: null }))
  const mine = await C.fetchMyReview(old)
  assert.equal(mine.rating, 4); assert.equal(mine.show_profile_photo, undefined)
})

test('photo copy: 256x256 WebP with ALL metadata (EXIF/GPS) removed and orientation applied', async () => {
  const src = await sharp({ create: { width: 640, height: 480, channels: 3, background: { r: 120, g: 60, b: 200 } } })
    .jpeg().withExif({ IFD0: { Copyright: 'SECRET-OWNER', ImageDescription: 'taken at home 45.5N 73.5W' } }).toBuffer()
  assert.ok((await sharp(src).metadata()).exif, 'fixture really carries EXIF')
  const out = await P.processReviewPhoto(src)
  const meta = await sharp(out).metadata()
  assert.equal(meta.format, 'webp'); assert.equal(meta.width, 256); assert.equal(meta.height, 256)
  assert.equal(meta.exif, undefined); assert.equal(meta.icc, undefined); assert.equal(meta.xmp, undefined)
  assert.ok(!out.toString('latin1').includes('SECRET-OWNER') && !out.toString('latin1').includes('45.5N'))
  assert.ok(out.length < 262144, 'fits the 256 KB bucket limit')
})

test('photo copy: rejects empty, oversized and non-image input', async () => {
  await assert.rejects(P.processReviewPhoto(Buffer.alloc(0)), /avatar_size/)
  await assert.rejects(P.processReviewPhoto(Buffer.alloc(P.MAX_AVATAR_BYTES + 1)), /avatar_size/)
  await assert.rejects(P.processReviewPhoto(Buffer.from('<svg onload=alert(1)></svg>')))
  await assert.rejects(P.processReviewPhoto(Buffer.from('not an image at all, just some text bytes')))
})

test('paths: public copy path matches the DB constraint; only the caller\'s own avatar folder is accepted', () => {
  const id = '123e4567-e89b-42d3-a456-426614174000'
  assert.match(P.reviewPhotoPath(id, 1760000000000), P.REVIEW_PHOTO_PATH_RE)
  assert.ok(!P.reviewPhotoPath(id).includes('user'), 'contains only the review id')
  for (const bad of ['../x/1760000000000.webp', `${id}/1.png`, 'avatars/x']) assert.ok(!P.REVIEW_PHOTO_PATH_RE.test(bad), bad)
  assert.equal(P.isOwnAvatarPath(`${id}/avatar.png`, id), true)
  for (const bad of [`other-user/avatar.png`, `${id}/../other/avatar.png`, 'https://evil.example/a.png', '', null, undefined, 42]) assert.equal(P.isOwnAvatarPath(bad, id), false, String(bad))
})

test('route: session user only, verified email, no request-supplied identity or path', () => {
  const s = read('app/api/reviews/photo/route.ts')
  assert.ok(/auth\.getUser\(\)/.test(s) && /email_confirmed_at/.test(s) && /status: 401/.test(s) && /status: 403/.test(s))
  assert.ok(!/request\.|req\.|\.json\(\)|formData|searchParams/.test(s.replace(/\/\*[\s\S]*?\*\//g, '')), 'route reads nothing from the request')
  assert.ok(/\.eq\('user_id', user\.id\)/.test(s) && /isOwnAvatarPath\(avatarPath, user\.id\)/.test(s))
  assert.ok(/if \(!review\.show_profile_photo\)/.test(s), 'consent OFF removes the public copy')
  assert.ok(!/show_profile_photo:\s*true/.test(s) && !/update\(\{\s*show_profile_photo/.test(s), 'the route can never switch consent on')
})

test('account deletion also removes the public review photo', () => {
  const s = read('app/api/account/delete/route.ts')
  assert.ok(/from\('review-photos'\)\.remove\(\[photoPath\]\)/.test(s))
  assert.ok(s.indexOf('review-photos') < s.indexOf('admin.auth.admin.deleteUser'))
})

test('modal: checkbox label, default ON, saved choice restored, choice submitted; other tabs untouched', () => {
  const s = read('components/xpadite/HelpFeedbackModal.tsx')
  assert.ok(s.includes('Display my profile photo with my review'))
  assert.ok(s.includes('Your XPadite profile photo will appear publicly alongside your review. Uncheck to keep it private.'))
  assert.ok(/useState\(true\)/.test(s.slice(s.indexOf('const [showPhoto'), s.indexOf('const [showPhoto') + 80)))
  assert.ok(s.includes('setShowPhoto(mine.show_profile_photo)') && /showPhoto, body: reviewBody/.test(s))
  const prof = s.indexOf('Profession (optional)'), box = s.indexOf('Display my profile photo'), body = s.indexOf('<Field label="Your review"')
  assert.ok(prof > 0 && prof < box && box < body, 'checkbox sits between Profession and Your review')
  assert.ok(s.includes("fetch('/api/support/submit'"))
})

test('migration 020: additive, conservative defaults, public bucket limits, no data loss', () => {
  const m = read('supabase/migrations/020_review_profile_photo.sql')
  assert.ok(/add column if not exists show_profile_photo boolean not null default false/.test(m), 'existing reviews stay private')
  assert.ok(/'review-photos', 'review-photos', true, 262144, array\['image\/webp'\]/.test(m))
  assert.ok(/drop function if exists public\.submit_review\(int, text, text, text, text\);/.test(m))
  assert.ok(/p_show_photo boolean default null/.test(m) && /coalesce\(p_show_photo, case when v_found then v_existing\.show_profile_photo else false end\)/.test(m))
  assert.ok(/case when show_profile_photo then profile_photo_path else null end as photo_path/.test(m))
  assert.ok(/^begin;/m.test(m) && /^commit;/m.test(m) && /security definer set search_path = ''/.test(m))
  assert.ok(/revoke all on function public\.submit_review\(int, text, text, text, text, boolean\) from public, anon/.test(m))
  const code = m.split('\n').filter(l => !l.trim().startsWith('--')).join('\n')
  const outside = code.replace(/create or replace function public\.submit_review\([\s\S]*?\n\$\$;/, '')
  assert.ok(!/\bdelete\s+from\b|\btruncate\b|\bdrop\s+table\b|\bdrop\s+column\b|\bupdate\s+public\.reviews\b/i.test(outside))
  assert.ok(!/create policy/i.test(code), 'no new policies: clients still cannot write')
})
