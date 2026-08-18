# web — the usepurq.com landing site

> ### 🔴 This is no longer where the site deploys from
>
> The site now lives in its own repo, **<https://github.com/rangasatvik/Purq-web>**,
> and Cloudflare Pages builds from there. That repo's root is `web/`'s contents:
> `public/`, `functions/`, `test/`, `waitlist.sql`.
>
> It was split out because Pages deploys one repo, and pointing it at a private
> monorepo means the deploy source is the app's source — including this file's
> vendor pricing and roadmap. The public repo carries only the site.
>
> **Editing this copy does not change usepurq.com.** Either delete this
> directory and let `Purq-web` be the single source, or treat this as a mirror
> and push both. Do not leave it ambiguous — two copies of a live site is how
> a fix ships to the wrong one. `make web` and `make test-web` still run against
> this copy.
>
> The notes below stay here because they cite `CLAUDE.md` and internal
> milestones, which is exactly what should not be in the public repo. The public
> `README.md` carries the deploy instructions in a form safe to publish.

---

Static HTML plus one Cloudflare Pages Function. No build step, no framework, no npm install. Open `public/index.html` in a browser to see it.

```
web/
  public/           served as static assets, straight from disk
    index.html      landing page + waitlist form
    privacy.html    ⚠️ draft, needs counsel review before submission
    support.html    App Review's required support URL
    icon.svg
  src/
    index.js        Worker entry — routes /api/waitlist, 404s the rest
    waitlist.js     the signup handler
  test/
    waitlist.test.js
  wrangler.jsonc    Worker + static-assets config
  waitlist.sql      run once in Supabase
```

**This is a Worker with static assets, not a Pages project.** It used to be
Pages; see "Why this is a Worker" below. Static assets are served _before_ the
Worker runs, so `/`, `/privacy` and `/support` never reach `src/index.js` —
only `/api/waitlist` and genuine misses do.

## Running it

```bash
make web        # localhost:8787, waitlist endpoint included
make test-web   # the endpoint's tests
```

`make web` runs `wrangler dev`, which is the same runtime as production. A plain
static server returns 404 on `/api/waitlist` and the form looks broken for
reasons that have nothing to do with the form. No Cloudflare login is needed —
it is all local workerd. With no `SUPABASE_*` set it answers 503, which is the
honest path and exactly what a visitor sees if the secrets go missing in
production.

Tests use `node:test` rather than vitest, so the suite itself adds no
dependency and `npm test` runs with nothing installed. `wrangler` is a pinned
devDependency because deploys should not float to whatever version npx happens
to fetch. `make test` runs these first, ahead of the API and iOS suites,
because they take a second and need no simulator.

## URLs — use the extensionless form

Pages canonicalises `/privacy.html` to `/privacy` with a 308. Both work, but the
redirect costs a round trip on every internal click, and **these are the two URLs
that go into App Store Connect**:

| Field              | Value                         |
| ------------------ | ----------------------------- |
| Privacy Policy URL | `https://usepurq.com/privacy` |
| Support URL        | `https://usepurq.com/support` |

Every internal link already uses the extensionless form. Keep it that way.

---

## Why this exists now

Not just marketing. **App Review requires a privacy policy URL and a support URL** (`CLAUDE.md` §6), and both must say exactly what the app's Privacy Nutrition Label and App Review Notes say. Those two pages are launch blockers; the landing page is the part that's optional.

---

## Deploy

### 1. Create the table

Supabase → SQL Editor → paste `waitlist.sql` → run. Staging project for now.

The table carries a plain `unique (email)`, **not** an index on `lower(email)`.
PostgREST resolves `Prefer: resolution=merge-duplicates` against the columns
named in `?on_conflict=`, and it can only name real columns — an expression
index is unreachable that way, so a repeat signup would raise 23505 and the
visitor would be shown an error for joining twice. The Function lowercases
before it sends, which is what preserves case-insensitivity. The two belong
together; changing either alone breaks the upsert silently.

### 2. Enable the Data API

⚠️ **This reverses the advice in `SETUP.md`, deliberately.** That said to disable the Data API because the iOS app never uses it — still true. The waitlist is the one thing that does.

Supabase → Settings → Data API → enable. The table is safe because `waitlist.sql` turns RLS on and adds **no policies**: nothing can read or write it through the Data API. The Pages Function uses the service role key, which bypasses RLS. The publishable key can do nothing with this table.

Keep "Automatically expose new tables" **off**, so app tables added later don't get published by accident.

### 3. Connect Pages

Cloudflare dashboard → Workers & Pages → Create → Pages → Connect to Git → `rangasatvik/Purq`.

| Setting                | Value           |
| ---------------------- | --------------- |
| Production branch      | `main`          |
| Build command          | _(leave empty)_ |
| Build output directory | `web/public`    |
| Root directory         | _(leave empty)_ |

Pages picks up `web/functions/` automatically as long as the root directory is the repo root.

### 4. Environment variables

Workers & Pages → `purq-web` → Settings → Variables and Secrets:

| Name                   | Type       | Value                       |
| ---------------------- | ---------- | --------------------------- |
| `SUPABASE_URL`         | Plaintext  | `https://<ref>.supabase.co` |
| `SUPABASE_SERVICE_KEY` | **Secret** | the service role key        |

Set the type to **Secret**, not Plaintext. A service role key is root on the database.

### 5. Custom domain

Pages → Custom domains → add `usepurq.com` and `www.usepurq.com`. DNS is one click since the domain is already on Cloudflare.

### 6. Create the support mailbox

`support@usepurq.com` — Cloudflare → Email Routing → forward to your personal inbox. **This address is shipped in the iOS app** on the account-deletion failure path, so it has to resolve.

---

## Before submitting to the App Store

- [ ] Counsel reviews `privacy.html`
- [ ] Privacy page, Privacy Nutrition Label and App Review Notes all say the same thing — a mismatch between the three is a rejection
- [ ] Remove the ⚠️ draft banner from `privacy.html`
- [ ] Rewrite the privacy page's tense (see below) — it currently describes an unreleased app in the future, and at submission it has to describe a shipped one in the present
- [ ] Add the App Store badge to the landing hero and swap the waitlist CTA for a download link

### The privacy page describes two different things, deliberately

Audited 2026-08-17. The page as first drafted described the app as if it had
shipped, and four of its claims were not true of any code that exists:

| Claim                                                              | Reality when checked                                                                                                                                                |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Camera images are processed on your device"                       | No camera code at all — no `AVCapture`, no `VisionKit`, no `NSCameraUsageDescription`. M9 is unbuilt.                                                               |
| "Passwords are stored hashed"                                      | No auth exists. No bcrypt/argon2/scrypt anywhere. Removed rather than future-tensed: naming a mechanism before S4 picks one is a promise made by the wrong session. |
| "Basic app diagnostics — crash reports and aggregate usage counts" | No crash reporter, no analytics SDK. Nothing is collected.                                                                                                          |
| The card-linked paragraph                                          | No CLO partner signed (`CLAUDE.md` §8 Q4). Removed.                                                                                                                 |

Three claims _were_ true and stayed: no merchant credentials anywhere, no mail
scope of any kind, and no `CoreLocation` reference or `NSLocation*` key in
`ios/Info.plist`. `Purq Pile → Delete account` is also the real path and the
real label (`PurqPileScreen.swift`).

The page is now one document in two halves — what this website holds **today**
(a waitlist address, a country code, a referrer, and nothing else), then what
the app will collect **when it ships**. One document rather than two, because
§6's failure mode is a mismatch between the privacy page, the Nutrition Label
and the Review Notes, and a second document is a fourth artifact to keep in
sync. At submission the second half becomes present tense and the first half
goes away.

## Why this is a Worker

It began as a Pages project and was migrated on 2026-08-18.

Connecting the GitHub repo through the current dashboard produces a _Worker_
build, not a Pages Git integration — which briefly left two different things
called `purq-web`: a Pages project serving the site correctly, and a Worker
serving the same pages with no `/api/waitlist` at all. The dashboard showed the
Worker, which is why it refused to accept environment variables ("Variables
cannot be added to a Worker that only has static assets") while the endpoint
was demonstrably running elsewhere.

Rather than keep a Pages project that Git could not deploy to, the Function
moved to a Worker fetch handler. Cloudflare is steering everything toward
Workers with static assets anyway, so this is the direction of travel, and now
one name means one thing.

Two behaviours changed in the move, both minor and both deliberate:

- `/privacy.html` now redirects with **307** instead of Pages' 308. Only
  matters to anyone hitting the `.html` form directly; every internal link
  already uses the extensionless path.
- Path routing is now code (`src/index.js`) rather than file layout. That is
  why the test suite grew a `routing` block — a thing the filesystem used to
  guarantee is now a branch that can regress.

## Notes

**No merchant logos anywhere on this site.** `CLAUDE.md` §6 — the rule applies to marketing as much as to the app, and this is the surface a brand's legal team is most likely to see. Merchant names as plain text only.

**The phone mockup is hand-drawn HTML**, not a screenshot, so it can't drift from a build or show a UI that doesn't exist. Replace it with real screenshots once there are some.

**The waitlist is honest about failure.** If Supabase is unreachable the visitor is told, rather than being shown a success state over a dropped signup. `web/test/waitlist.test.js` pins that: missing env vars must produce a 503 with a message and no `ok`, never a false success.

**The logo's ink strokes are load-bearing.** Cream on marigold is 1.60:1 and the
cream head is 1.68:1 — both far under the 3:1 WCAG 1.4.11 asks of a graphical
object. The 5px ink outline on every shape is what supplies that boundary. It
reads as a style choice and is not one; there is a comment in `index.html`
saying so, because this is exactly what a tidy-up deletes.
