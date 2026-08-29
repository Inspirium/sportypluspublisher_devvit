---
status: accepted
date: 2026-08-29
---

# The SportyPlus Reddit publisher is a server-only Devvit app driven by an external endpoint

Origin decision: `Inspirium/sporty` `adr/0004` — SportyPlus publishes club announcements to
Reddit through a first-party Devvit app instead of the Data API OAuth flow, because Devvit
Web `0.14`'s `server.externalEndpoints` gives a server-to-server publish path and every club
already moderates its own subreddit. This ADR records the decisions specific to *this* repo.

## Server-only, no custom-post surface

The app was scaffolded from the Devvit `bare` template and then **stripped to the server
only**: no `src/client`, no `public/*.html`, no `post.entrypoints`, no counter/game demo. It
publishes plain **self or link posts** via `reddit.submitPost` — there is no interactive
Devvit post, so there is nothing to render.

- `devvit.json` `post` block removed; `marketingAssets.icon` is the only static asset.
- If interactive posts are wanted later (`adr/0004` "start with text, plan for more"), a
  `post` entrypoint and a client are added back — the publish contract already carries a
  `url` field and could carry a `postKind`.

## One `global`-scoped external endpoint, two auth layers

`server.externalEndpoints.publish` → `POST /external/publish`, `scopes: ["global"]`. Every
call from the SportyPlus backend (`RedditDevvitAdapter`) carries **both**:

1. `Authorization: bearer devvit_at_…` — a **managed token** created in the app's Developer
   Settings (web dashboard, not CLI). The Devvit platform checks this before the handler
   runs; it is what `global` scope requires.
2. `X-Sporty-Secret: …` — our own secret, a `settings.global` value (`devvit settings set
   sportySharedSecret`), checked inside the handler.

Two layers because they fail independently and rotate independently: the managed token is a
Reddit-issued credential we don't fully control; the shared secret lets us bind the payload
and cut off a caller without touching Reddit. `settings.global` (not `subreddit`) so it is
one value for the whole app, set by us.

## Idempotency in Redis, keyed on the caller's id

The handler stores `pub:{idempotencyKey} → {postId, url}` for 7 days, where `idempotencyKey`
is the SportyPlus `social_post_targets.id`. A replay returns the stored result instead of
submitting again, so `PublishToChannelJob`'s retries never double-post. `permissions.redis`
is enabled for this and nothing else.

## Pairing: install-time subreddit setting → callback

A club binds its subreddit to its SportyPlus club with a one-time code:

1. Club admin generates the code in SportyPlus admin → Social → Connect Reddit.
2. A subreddit moderator installs the app and pastes the code into the `sportyPairingCode`
   **subreddit setting**.
3. `onAppInstall` (and a "link status" mod menu action, as a fallback if the field was left
   blank) reads the code + `context.subredditId`/`subredditName` and `POST`s to
   `{sportyApiBase}/api/v3/social/reddit/devvit/pair`. SportyPlus validates the code and
   upserts the `reddit` channel.

An hourly `scheduler` task pings `/heartbeat` so SportyPlus can detect a removed install
(there is no `onAppUninstall` trigger). Outbound HTTP is allowlisted to `api.sporty.plus` and
`api.staging.sporty.plus` only.

## Posts are authored by the app's bot account

`reddit.submitPost` runs as the app account (`u/sportypluspublisher`), not the installing
user — Devvit has no "post as an external connected user" capability. Accepted in `adr/0004`
as the trade-off for not needing Data API access. Announcements to a club's own subreddit
from a clearly-named bot is a common pattern.

## Status

- Uploaded to the App Directory (`devvit upload`) — owner-visible, installable only to test
  subreddits < 200 members.
- **Blocked on Reddit approving use of the experimental `global` external-endpoints
  feature.** `server.externalEndpoints` is marked `[experimental]` in the config schema and
  minting a managed token / calling `/external/` from outside needs Reddit to enable it for
  the app. `devvit publish` (app review, so any club can install) is filed after that and
  after playtesting.
- Everything else is built and tested on both sides (this repo: `npm test`; backend:
  `pest`), gated off in the backend with `SOCIAL_REDDIT_ENABLED=false`.
