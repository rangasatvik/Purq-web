/**
 * Worker entry point.
 *
 * Static assets are served by the runtime *before* this handler runs — see the
 * `assets` block in wrangler.jsonc — so anything arriving here missed every
 * file in public/. That means the routing below only has to care about the API,
 * and a request for a page that does not exist falls through to a plain 404.
 *
 * This replaced a Pages Function (`functions/api/waitlist.js`). The logic is
 * unchanged; only the entry shape differs, because a Worker with static assets
 * routes by path itself rather than by file location.
 */

import { handleWaitlist } from './waitlist.js'

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url)

    if (pathname === '/api/waitlist') {
      if (request.method !== 'POST') {
        // A clear answer rather than the asset router's 404, so a misdirected
        // GET says what the endpoint actually wants.
        return new Response('Method not allowed', { status: 405, headers: { Allow: 'POST' } })
      }
      return handleWaitlist(request, env)
    }

    return new Response('Not found', { status: 404 })
  },
}
