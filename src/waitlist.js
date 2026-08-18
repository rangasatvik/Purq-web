/**
 * POST /api/waitlist — the waitlist signup handler.
 *
 * Runs server-side, so the Supabase key never reaches the browser. Writes to a
 * `waitlist` table via the Data API using the service role key.
 *
 * Secrets (Workers → purq-web → Settings → Variables and Secrets):
 *   SUPABASE_URL          https://<ref>.supabase.co
 *   SUPABASE_SERVICE_KEY  service role key — SECRET, never a plain variable
 *
 * See README.md for why the Supabase Data API is enabled for this project.
 */

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })

export async function handleWaitlist(request, env) {
  let body
  try {
    body = await request.json()
  } catch {
    return json({ error: 'Malformed request.' }, 400)
  }

  // Honeypot: a real person never fills a field they cannot see. Return 200 so
  // a bot learns nothing from the response, but write nothing.
  if (body.website) return json({ ok: true })

  const email = String(body.email ?? '')
    .trim()
    .toLowerCase()
  if (!EMAIL.test(email) || email.length > 254) {
    return json({ error: "That email doesn't look right — mind checking it?" }, 400)
  }

  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
    // Fail loudly in the logs, softly to the visitor. A silently dropped
    // signup is worse than an honest error.
    console.error('waitlist: SUPABASE_URL or SUPABASE_SERVICE_KEY is unset')
    return json({ error: 'Signups are briefly unavailable. Try again shortly.' }, 503)
  }

  // ?on_conflict=email names the target for the upsert below. Without it
  // PostgREST infers the primary key — a fresh uuid per insert, which never
  // collides — and a repeat signup raises 23505 instead of merging. The column
  // must carry a real unique constraint for this to resolve; see waitlist.sql.
  const url = `${env.SUPABASE_URL}/rest/v1/waitlist?on_conflict=email`

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      // Idempotent by email: a second signup updates rather than erroring,
      // so someone who forgets they already joined isn't shown a failure.
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify([
      {
        email,
        source: 'landing',
        // Cloudflare gives us these free; useful for knowing where signups
        // came from without any tracking script.
        country: request.headers.get('cf-ipcountry') ?? null,
        referrer: (request.headers.get('referer') ?? '').slice(0, 500) || null,
      },
    ]),
  })

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    console.error('waitlist: supabase insert failed', res.status, detail.slice(0, 500))
    return json({ error: 'Something broke on our end. Try again in a minute?' }, 502)
  }

  return json({ ok: true })
}
