# App Directory listing — sportypluspublisher

Copy for the Developer Portal listing at
https://developers.reddit.com/apps/sportypluspublisher. Keep this in sync when the
portal copy changes.

---

## App account name

`sportypluspublisher` (fixed — this is the bot account that authors posts)

## Display name

SportyPlus Publisher

## Tagline (one line)

Cross-post your club's announcements from SportyPlus straight to your subreddit.

## Category

Mod Tools / Utilities

## Short description (~1–2 sentences)

SportyPlus Publisher lets a racket-sports club publish its announcements — tournament
sign-ups, results, news — from the SportyPlus club-management platform to the club's own
subreddit, without leaving SportyPlus. A moderator installs the app, links it to the club
with a one-time code, and every announcement the club sends from SportyPlus is posted here
automatically.

## Full description (markdown)

**For racket-sports clubs that run their community on Reddit.**

[SportyPlus](https://www.sporty.plus) is a club-management platform for tennis, padel and
pickleball clubs. This app connects a club's SportyPlus account to its subreddit so
announcements written once in SportyPlus are published to Reddit automatically.

### How it works

1. A subreddit moderator installs the app.
2. In the app's subreddit settings, the moderator pastes a one-time pairing code shown in
   **SportyPlus → Admin → Social → Connect Reddit**. This links the subreddit to that club.
3. When a club admin publishes an announcement in SportyPlus and selects Reddit as a
   destination, SportyPlus calls this app and it submits the post to your subreddit.

Posts are authored by the **u/sportypluspublisher** account. The app never reads or moderates
your subreddit's content — it only submits the posts your club sends.

### What it accesses and why

- **Submit posts** to the subreddit it is installed in — its only purpose.
- **Outbound HTTP** to `api.sporty.plus` (and `api.staging.sporty.plus` for testing) — to
  confirm the pairing code, report that the install is still active, and receive nothing
  else. No other domains.
- **Redis** — stores the id of each post it creates for a short time so a retried request
  never posts the same announcement twice.

### Who it's for

Clubs already using SportyPlus. If your club doesn't use SportyPlus, this app does nothing
on its own — there is no content to publish.

## Review notes (for the Reddit reviewer)

- Commercial, multi-tenant: SportyPlus is a paid SaaS; each customer club installs this app
  in the subreddit it moderates.
- The app exposes one `global`-scoped external endpoint, `/external/publish`, called only by
  the SportyPlus backend, authenticated with a Devvit managed token **and** a separate shared
  secret configured as an app setting.
- All posts originate from a deliberate "publish" action a club admin takes inside SportyPlus.
  There is no automated posting, scraping, or cross-posting of third-party content.
- Privacy policy: TODO — confirm the live URL (likely https://www.sporty.plus/privacy).

## Support

- Website: https://www.sporty.plus
- Contact: TODO — set a support address / URL before submitting for review.
