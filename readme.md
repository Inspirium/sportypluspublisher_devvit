# sportypluspublisher

A [Devvit](https://developers.reddit.com/) app that lets the **SportyPlus** backend publish
announcements to a club's subreddit. A club's moderators install this app in their subreddit
and paste a pairing code from SportyPlus admin → Social; the SportyPlus backend then calls
the app's `/external/publish` endpoint to submit posts as the app's bot account.

No Reddit Data API access is involved. See `adr/0004` in the `Inspirium/sporty` repo.

## How it works

- **`/external/publish`** (`server.externalEndpoints`, `global` scope) — the SportyPlus
  `RedditDevvitAdapter` POSTs `{ idempotencyKey, title, body | url }` with the Devvit managed
  token as a bearer and the shared secret in `X-Sporty-Secret`. The server submits a self or
  link post to the install's subreddit and caches the result in Redis, keyed on
  `idempotencyKey`, so the caller's retries never double-post.
- **Pairing** — `onAppInstall` (and the "SportyPlus: link status" mod menu action) read the
  `sportyPairingCode` subreddit setting and call
  `POST {sportyApiBase}/api/v3/social/reddit/devvit/pair` to bind the install to a club.
- **Heartbeat** — an hourly scheduler task pings SportyPlus so a removed install can be
  detected.

## Settings

| Setting | Scope | Purpose |
|---|---|---|
| `sportySharedSecret` | global (secret) | Must match `DEVVIT_SHARED_SECRET` in the SportyPlus backend. |
| `sportyApiBase` | global | Callback base URL. `https://api.staging.sporty.plus` for playtest. |
| `sportyPairingCode` | subreddit | The code from SportyPlus admin → Social → Connect Reddit. |

A `global` managed token (Developer Settings → API) authenticates `/external/publish`; give it
to the backend as `DEVVIT_MANAGED_TOKEN`.

## Commands

- `npm run playtest [r/sub]` — build, upload, install on Reddit, watch for changes.
- `npm run build` — bundle the server (`dist/server/index.js`).
- `npm test` — typecheck, lint, unit tests, build.
- `npm run format` — fix lints and formatting.
- `npm run publish` — clean, build, upload, file an app-review request.
