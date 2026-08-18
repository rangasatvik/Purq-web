/**
 * Tests for the waitlist Pages Function.
 *
 * Uses node:test, not vitest, on purpose. `web/` has no package.json and no
 * npm install by design (see web/README.md) — the site is static and the one
 * piece of logic in it should not drag a test framework into that directory.
 * Node 22 ships the runner and assertions, so this file needs nothing.
 *
 *   node --test web/test/
 *
 * The fake Supabase below models PostgREST's actual upsert behaviour rather
 * than just recording calls, because the bug this suite exists to catch was a
 * conflict target that silently didn't resolve. A stub that always says 201
 * would have passed against the broken version.
 */

import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

import { onRequestPost, onRequest } from '../functions/api/waitlist.js'

const ENV = { SUPABASE_URL: 'https://stub.supabase.co', SUPABASE_SERVICE_KEY: 'service-role-key' }

/** Rows the fake Supabase has accepted, in order. */
let rows
/** Every fetch the function made, for asserting on headers and URL. */
let calls
/** Set to a status code to make the next Supabase call fail with it. */
let forceStatus

/**
 * Stand-in for PostgREST.
 *
 * The important part is the conflict handling. PostgREST resolves
 * `Prefer: resolution=merge-duplicates` against the columns named in
 * `?on_conflict=`; with no such parameter it falls back to inferring the
 * primary key. `id` defaults to a fresh uuid on every insert, so that
 * inference never matches an existing row and the write reaches the unique
 * constraint on `email`, which raises 23505 -> HTTP 409.
 *
 * Modelling that is what makes the duplicate-signup test meaningful.
 */
function fakeSupabase(url, init) {
  calls.push({ url, init })

  if (forceStatus) {
    return Promise.resolve(new Response('upstream exploded', { status: forceStatus }))
  }

  const parsed = new URL(url)
  const onConflict = parsed.searchParams.get('on_conflict')
  const merging = (init.headers.Prefer ?? '').includes('resolution=merge-duplicates')
  const [incoming] = JSON.parse(init.body)

  const existing = rows.findIndex((r) => r.email === incoming.email)
  if (existing !== -1) {
    // A duplicate. It only merges when the caller named `email` as the target.
    if (merging && onConflict === 'email') {
      rows[existing] = { ...rows[existing], ...incoming }
      return Promise.resolve(new Response(null, { status: 201 }))
    }
    return Promise.resolve(
      new Response(
        JSON.stringify({
          code: '23505',
          message: 'duplicate key value violates unique constraint "waitlist_email_key"',
        }),
        { status: 409 },
      ),
    )
  }

  rows.push(incoming)
  return Promise.resolve(new Response(null, { status: 201 }))
}

/** Build a POST the way the landing page's script does. */
const post = (body, headers = {}) =>
  new Request('https://usepurq.com/api/waitlist', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })

beforeEach(() => {
  rows = []
  calls = []
  forceStatus = null
  globalThis.fetch = fakeSupabase
})

describe('POST /api/waitlist', () => {
  test('a valid email returns 200 and writes one row', async () => {
    const res = await onRequestPost({ request: post({ email: 'vik@example.com' }), env: ENV })

    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), { ok: true })
    assert.equal(rows.length, 1)
    assert.equal(rows[0].email, 'vik@example.com')
    assert.equal(rows[0].source, 'landing')
  })

  test('the honeypot returns 200 but writes nothing', async () => {
    const res = await onRequestPost({
      request: post({ email: 'bot@example.com', website: 'http://spam.example' }),
      env: ENV,
    })

    // 200 so a bot learns nothing from the response…
    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), { ok: true })
    // …but nothing reached the database, and Supabase was never called at all.
    assert.equal(rows.length, 0)
    assert.equal(calls.length, 0)
  })

  test('a malformed email returns 400 with the friendly message', async () => {
    const res = await onRequestPost({ request: post({ email: 'not-an-email' }), env: ENV })

    assert.equal(res.status, 400)
    const body = await res.json()
    assert.match(body.error, /doesn't look right/)
    assert.equal(rows.length, 0)
  })

  test('an over-long email returns 400 even though it is well formed', async () => {
    const email = `${'a'.repeat(250)}@example.com`
    const res = await onRequestPost({ request: post({ email }), env: ENV })

    assert.equal(res.status, 400)
    assert.equal(rows.length, 0)
  })

  test('a malformed JSON body returns 400 rather than throwing', async () => {
    const res = await onRequestPost({ request: post('{not json'), env: ENV })

    assert.equal(res.status, 400)
    assert.equal((await res.json()).error, 'Malformed request.')
  })

  test('missing env vars return 503 and never a false success', async () => {
    for (const env of [{}, { SUPABASE_URL: ENV.SUPABASE_URL }, { SUPABASE_SERVICE_KEY: 'k' }]) {
      const res = await onRequestPost({ request: post({ email: 'vik@example.com' }), env })

      assert.equal(res.status, 503, `env ${JSON.stringify(env)} should be 503`)
      const body = await res.json()
      // The visitor is told. The one outcome worse than an error here is a
      // success state over a signup that went nowhere.
      assert.match(body.error, /briefly unavailable/)
      assert.equal(body.ok, undefined)
    }
    assert.equal(calls.length, 0)
  })

  test('the same email twice returns 200 both times and leaves one row', async () => {
    const first = await onRequestPost({ request: post({ email: 'twice@example.com' }), env: ENV })
    const second = await onRequestPost({ request: post({ email: 'twice@example.com' }), env: ENV })

    assert.equal(first.status, 200)
    assert.equal(second.status, 200, 'a repeat signup must not surface an error')
    assert.deepEqual(await second.json(), { ok: true })
    assert.equal(rows.length, 1)
  })

  test('the upsert names email as the conflict target', async () => {
    // Regression guard. Without ?on_conflict=email, PostgREST infers the
    // primary key, the merge never resolves, and the duplicate test above
    // starts returning 502 to a visitor who did nothing wrong.
    await onRequestPost({ request: post({ email: 'vik@example.com' }), env: ENV })

    const { url, init } = calls[0]
    assert.equal(new URL(url).searchParams.get('on_conflict'), 'email')
    assert.match(init.headers.Prefer, /resolution=merge-duplicates/)
  })

  test('the address is trimmed and lowercased before it is stored', async () => {
    // Case-insensitivity depends on this, because the table now has a plain
    // unique(email) rather than an index on lower(email).
    await onRequestPost({ request: post({ email: '  ViK@Example.COM  ' }), env: ENV })
    assert.equal(rows[0].email, 'vik@example.com')

    const res = await onRequestPost({ request: post({ email: 'VIK@EXAMPLE.COM' }), env: ENV })
    assert.equal(res.status, 200)
    assert.equal(rows.length, 1, 'different casing must not create a second row')
  })

  test('a Supabase failure returns 502 and an honest message', async () => {
    forceStatus = 500
    const res = await onRequestPost({ request: post({ email: 'vik@example.com' }), env: ENV })

    assert.equal(res.status, 502)
    assert.match((await res.json()).error, /broke on our end/)
  })

  test('the service key is sent to Supabase and never returned to the browser', async () => {
    const res = await onRequestPost({ request: post({ email: 'vik@example.com' }), env: ENV })

    assert.equal(calls[0].init.headers.apikey, ENV.SUPABASE_SERVICE_KEY)
    assert.doesNotMatch(await res.text(), /service-role-key/)
  })

  test('responses are marked no-store', async () => {
    const res = await onRequestPost({ request: post({ email: 'vik@example.com' }), env: ENV })
    assert.equal(res.headers.get('Cache-Control'), 'no-store')
  })

  test('cf-ipcountry and referer are recorded, and referer is capped', async () => {
    await onRequestPost({
      request: post(
        { email: 'vik@example.com' },
        { 'cf-ipcountry': 'GB', referer: `https://ref.example/${'x'.repeat(600)}` },
      ),
      env: ENV,
    })

    assert.equal(rows[0].country, 'GB')
    assert.equal(rows[0].referrer.length, 500)
  })

  test('absent cf headers become null rather than empty strings', async () => {
    await onRequestPost({ request: post({ email: 'vik@example.com' }), env: ENV })

    assert.equal(rows[0].country, null)
    assert.equal(rows[0].referrer, null)
  })
})

describe('other methods', () => {
  test('GET returns 405 with an Allow header', async () => {
    const res = await onRequest({
      request: new Request('https://usepurq.com/api/waitlist', { method: 'GET' }),
      env: ENV,
    })

    assert.equal(res.status, 405)
    assert.equal(res.headers.get('Allow'), 'POST')
  })

  test('onRequest still handles POST, passing env through', async () => {
    // Pages runs the method-specific handler when there is one, but onRequest
    // delegates as well — and it destructures only `request`, so this is the
    // test that catches env being dropped on the way through.
    const res = await onRequest({ request: post({ email: 'vik@example.com' }), env: ENV })

    assert.equal(res.status, 200)
    assert.equal(rows.length, 1)
  })
})
