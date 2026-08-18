# usepurq.com

The Purq marketing site: a landing page, the two pages App Review requires, and
one Cloudflare Pages Function that records waitlist signups.

Static HTML. No build step, no framework, no bundler. Open `public/index.html`
in a browser and you are looking at production.

```
public/
  index.html      landing page + waitlist form
  privacy.html    ⚠️ draft — needs counsel review before App Store submission
  support.html    App Review's required support URL
  icon.svg
functions/
  api/waitlist.js Pages Function — POST /api/waitlist
test/
  waitlist.test.js
waitlist.sql      run once in Supabase
```

---

## Why this exists

App Review requires a privacy policy URL and a support URL, and both must say
exactly what the app's Privacy Nutrition Label and App Review Notes say. A
mismatch between the three is a rejection. Those two pages are launch blockers.
The landing page is the optional part.

---

## Running it

```bash
npm test          # the Function's tests
npx wrangler pages dev public --port 8788
```

Use `wrangler`, not a plain static server. `wrangler pages dev` is what actually
runs `functions/` — a static server returns 404 on `/api/waitlist` and the form
looks broken for reasons that have nothing to do with the form. No Cloudflare
login is needed; it is all local workerd.

With no `SUPABASE_*` set it answers 503. That is the honest path, and it is
exactly what a visitor sees if the secrets ever go missing in production.

### Tests

`node:test`, no dependencies, no `npm install`. The whole point of this repo is
that it has no toolchain, and the one piece of logic in it should not drag a
test framework in to change that.

The fake Supabase in `test/waitlist.test.js` models PostgREST's real conflict
resolution rather than just recording calls. That matters: the bug these tests
were written for was a conflict target that silently failed to resolve, and a
stub that always returned 201 would have passed against the broken version.

---

## URLs — use the extensionless form

Pages canonicalises `/privacy.html` to `/privacy` with a 308. Both work, but the
redirect costs a round trip on every internal click, and **these are the two URLs
that go into App Store Connect**:

| Field              | Value                          |
| ------------------ | ------------------------------ |
| Privacy Policy URL | `https://usepurq.com/privacy`  |
| Support URL        | `https://usepurq.com/support`  |

Every internal link already uses the extensionless form. Keep it that way.

---

## Deploy

### 1. Create the table

Supabase → SQL Editor → paste `waitlist.sql` → run.

The table carries a plain `unique (email)`, **not** an index on `lower(email)`.
PostgREST resolves `Prefer: resolution=merge-duplicates` against the columns
named in `?on_conflict=`, and it can only name real columns — an expression
index is unreachable that way, so the merge silently falls back to the primary
key, which is a fresh uuid on every insert and never conflicts. The second
signup then hits the unique index directly, raises 23505, and the visitor is
shown an error for joining twice.

The Function lowercases before it sends, which is what preserves
case-insensitivity without an expression index. The two belong together.
Changing either alone breaks the upsert, and it breaks invisibly.

### 2. Enable the Supabase Data API

The table is safe with it on, because `waitlist.sql` turns RLS on and adds **no
policies**: nothing can read or write it through the Data API. The Pages
Function uses the service role key, which bypasses RLS. The publishable key can
do nothing with this table.

Keep "Automatically expose new tables" **off**, so tables added later don't get
published by accident.

### 3. Connect Pages

Cloudflare dashboard → Workers & Pages → Create → Pages → Connect to Git →
`rangasatvik/Purq-web`.

| Setting                | Value          |
| ---------------------- | -------------- |
| Production branch      | `main`         |
| Build command          | _(leave empty)_ |
| Build output directory | `public`       |
| Root directory         | _(leave empty)_ |

Pages picks up `functions/` automatically from the repository root.

### 4. Environment variables

Settings → Environment variables → Production:

| Name                   | Type      | Value                       |
| ---------------------- | --------- | --------------------------- |
| `SUPABASE_URL`         | Plaintext | `https://<ref>.supabase.co` |
| `SUPABASE_SERVICE_KEY` | **Secret** | the service role key       |

Set the type to **Secret**, not Plaintext. A service role key is root on the
database.

### 5. Custom domain

Pages → Custom domains → add `usepurq.com` and `www.usepurq.com`.

### 6. Create the support mailbox

`support@usepurq.com` — Cloudflare → Email Routing → forward to a real inbox.
**This address is shipped inside the iOS app** on the account-deletion failure
path, so it has to resolve.

---

## Before submitting to the App Store

- [ ] Counsel reviews `privacy.html`
- [ ] Privacy page, Privacy Nutrition Label and App Review Notes all say the same thing
- [ ] Remove the ⚠️ draft banner from `privacy.html`
- [ ] Move the privacy page from future to present tense — see below
- [ ] Add the App Store badge to the hero and swap the waitlist CTA for a download link

### The privacy page is deliberately in two halves

The page describes what this website holds **today** — a waitlist address, a
country code, a referrer, and nothing else — and then, separately, what the app
will collect **when it ships**.

That split exists because the first draft described the app as though it had
already shipped, and several of its claims were not true of any code that
existed: on-device camera processing (there is no camera code), hashed passwords
(there is no auth), and crash reporting and usage analytics (there is no
reporter and no analytics SDK). A privacy policy that misdescribes real
behaviour is worse than one that is merely late.

One document rather than two, because the failure mode being guarded against is
a mismatch between the privacy page, the Nutrition Label and the Review Notes —
and a second document is just a fourth artifact to keep in sync.

At submission, the second half becomes present tense and the first half goes
away.

---

## Notes

**No merchant logos anywhere on this site.** App Store guideline 5.2 — the rule
applies to marketing as much as to the app, and this is the surface a brand's
legal team is most likely to see. Merchant names as plain text only.

**The phone mockup is hand-drawn HTML**, not a screenshot, so it cannot drift
from a build or show a UI that does not exist. Replace it with real screenshots
once there are some.

**The waitlist is honest about failure.** If Supabase is unreachable the visitor
is told, rather than shown a success state over a dropped signup. The tests pin
that: missing env vars must produce a 503 with a message and no `ok`, never a
false success.

**The logo's ink strokes are load-bearing.** Cream on marigold is 1.60:1 and the
cream head is 1.68:1 — both far under the 3:1 that WCAG 1.4.11 asks of a
graphical object. The 5px ink outline on every shape is what supplies that
boundary. It reads as a style choice and is not one. There is a comment in
`index.html` saying so, because this is exactly the kind of thing a tidy-up
deletes.

**Accessibility.** Every foreground/background pair on all three pages clears
4.5:1 (3:1 for large text), verified against rendered computed styles rather
than the source. Every interactive target is at least 44×44. Focus is visible on
everything, and switches to marigold on the two dark surfaces where ink would be
invisible. `prefers-reduced-motion` is honoured.
