import {context, settings} from '@devvit/web/server'

/**
 * Thin client for the SportyPlus backend callbacks. Used to bind this install to
 * a club (`pairSubreddit`) and to prove the install is still alive
 * (`sendHeartbeat`). Both are best-effort: a network failure is logged and
 * swallowed so a trigger or cron run never fails because SportyPlus is down.
 *
 * Config comes from app settings (`sportyApiBase`, `sportySharedSecret`) set in
 * Developer Settings — see `devvit.json`.
 */

const DEFAULT_API_BASE = 'https://api.sporty.plus'

export type SportyResult = {ok: boolean; status: number; body: unknown}

async function sportyConfig(): Promise<{base: string; secret: string}> {
  const base = (
    (await settings.get<string>('sportyApiBase')) || DEFAULT_API_BASE
  ).replace(/\/+$/, '')
  const secret = (await settings.get<string>('sportySharedSecret')) ?? ''
  return {base, secret}
}

/** Bind this subreddit install to the club that owns `pairingCode`. */
export async function pairSubreddit(
  pairingCode: string,
): Promise<SportyResult> {
  return post('/api/v3/social/reddit/devvit/pair', {
    pairingCode,
    subredditId: context.subredditId,
    subredditName: context.subredditName,
    appSlug: context.appSlug,
  })
}

/** Tell SportyPlus this install is still present and moderating. */
export async function sendHeartbeat(): Promise<SportyResult> {
  return post('/api/v3/social/reddit/devvit/heartbeat', {
    subredditId: context.subredditId,
    subredditName: context.subredditName,
  })
}

async function post(
  path: string,
  body: Readonly<Record<string, unknown>>,
): Promise<SportyResult> {
  const {base, secret} = await sportyConfig()
  try {
    const rsp = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Sporty-Secret': secret,
      },
      body: JSON.stringify(body),
    })
    const text = await rsp.text().catch(() => '')
    let parsed: unknown
    try {
      parsed = text ? JSON.parse(text) : null
    } catch {
      parsed = text
    }
    if (!rsp.ok) console.error(`sporty ${path}: HTTP ${rsp.status}; ${text}`)
    return {ok: rsp.ok, status: rsp.status, body: parsed}
  } catch (err) {
    console.error(`sporty ${path}: ${err instanceof Error ? err.message : err}`)
    return {ok: false, status: 0, body: null}
  }
}
