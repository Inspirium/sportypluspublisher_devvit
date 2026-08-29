import {once} from 'node:events'
import type {IncomingMessage, ServerResponse} from 'node:http'
import {context, reddit, redis, settings} from '@devvit/web/server'
import type {
  PartialJsonValue,
  TriggerResponse,
  UiResponse,
} from '@devvit/web/shared'
import {
  Endpoint,
  EndpointMethod,
  type ErrorRsp,
  type GetCounterRsp,
  type IncCounterReq,
  type IncCounterRsp,
  type PublishReq,
  type PublishRsp,
} from '../shared/api.ts'
import {dbGetCounter, dbIncCounter} from './db.ts'
import {pairSubreddit, sendHeartbeat} from './sporty.ts'

/** Replay cache TTL for `/external/publish` idempotency keys. */
const PUBLISH_TTL_MS = 7 * 24 * 60 * 60 * 1000

type AnyRsp =
  | GetCounterRsp
  | IncCounterRsp
  | PublishRsp
  | UiResponse
  | TriggerResponse
  | ErrorRsp

export async function onReq(
  reqMsg: IncomingMessage,
  rspMsg: ServerResponse,
): Promise<void> {
  try {
    await route(reqMsg, rspMsg)
  } catch (err) {
    const msg = `server error; ${err instanceof Error ? err.stack : err}`
    console.error(msg)
    writeJson<ErrorRsp>(500, {error: msg, status: 500}, rspMsg)
  }
}

async function route(
  reqMsg: IncomingMessage,
  rspMsg: ServerResponse,
): Promise<void> {
  const endpoint = reqMsg.url?.slice(1).split('?')[0] as Endpoint
  const method = EndpointMethod[endpoint]

  let rsp: AnyRsp
  if (method !== reqMsg.method) {
    rsp = {error: 'not found', status: 404}
  } else {
    switch (endpoint) {
      case Endpoint.GetCounter:
        rsp = await routeGetCounter()
        break
      case Endpoint.IncCounter:
        rsp = await routeInc(reqMsg)
        break
      case Endpoint.ExternalPublish:
        rsp = await routeExternalPublish(reqMsg)
        break
      case Endpoint.OnMenuNewPost:
        rsp = await routeMenuNewPost()
        break
      case Endpoint.OnMenuLink:
        rsp = await routeMenuLink()
        break
      case Endpoint.OnAppInstall:
        rsp = await routeAppInstall()
        break
      case Endpoint.OnCronHeartbeat:
        rsp = await routeHeartbeat()
        break
      default:
        endpoint satisfies never
        rsp = {error: 'not found', status: 404}
        break
    }
  }

  writeJson<PartialJsonValue>('status' in rsp ? rsp.status : 200, rsp, rspMsg)
}

async function routeGetCounter(): Promise<GetCounterRsp> {
  const t3 = context.postId
  if (!t3) throw Error('no t3')
  return {count: await dbGetCounter(t3)}
}

async function routeInc(reqMsg: IncomingMessage): Promise<IncCounterRsp> {
  const t3 = context.postId
  if (!t3) throw Error('no t3')
  const req = await readJson<IncCounterReq>(reqMsg)
  return {count: await dbIncCounter(t3, req.amount)}
}

/**
 * Submit a post to this install's subreddit on behalf of the SportyPlus
 * backend. Authenticated by the Devvit managed token (enforced by the platform
 * for a `global`-scoped `/external/` endpoint) plus our own shared secret.
 * Idempotent on `idempotencyKey`.
 */
async function routeExternalPublish(
  reqMsg: IncomingMessage,
): Promise<PublishRsp | ErrorRsp> {
  const secret = (await settings.get<string>('sportySharedSecret')) ?? ''
  if (!secret || header(reqMsg, 'x-sporty-secret') !== secret) {
    return {error: 'forbidden', status: 403}
  }

  let req: PublishReq
  try {
    req = await readJson<PublishReq>(reqMsg)
  } catch {
    return {error: 'invalid JSON body', status: 400}
  }

  if (!req.idempotencyKey || !req.title?.trim()) {
    return {error: 'idempotencyKey and title are required', status: 400}
  }
  const body = req.body?.trim()
  const url = req.url?.trim()
  if (!body && !url) {
    return {error: 'one of body or url is required', status: 400}
  }

  const cacheKey = `pub:${req.idempotencyKey}`
  const cached = await redis.get(cacheKey)
  if (cached) return JSON.parse(cached) as PublishRsp

  const common = {
    subredditName: context.subredditName,
    title: req.title,
    flairId: req.flairId,
  }
  let post
  try {
    post = body
      ? await reddit.submitPost({...common, text: body})
      : await reddit.submitPost({...common, url: url as string})
  } catch (err) {
    const msg = err instanceof Error ? err.message : `${err}`
    console.error(`publish failed for r/${context.subredditName}: ${msg}`)
    // Let the SportyPlus adapter classify: 5xx → retry, everything else → fail.
    return {error: `reddit rejected the submission: ${msg}`, status: 502}
  }

  const result: PublishRsp = {postId: post.id, url: post.url}
  await redis.set(cacheKey, JSON.stringify(result), {
    expiration: new Date(Date.now() + PUBLISH_TTL_MS),
  })
  return result
}

async function routeMenuNewPost(): Promise<UiResponse> {
  const post = await reddit.submitCustomPost({title: context.appSlug})
  return {
    showToast: {text: `Post ${post.id} created.`, appearance: 'success'},
    navigateTo: post.url,
  }
}

/** Mod-facing: re-send the pairing code and report the link status. */
async function routeMenuLink(): Promise<UiResponse> {
  const code = (await settings.get<string>('sportyPairingCode'))?.trim()
  if (!code) {
    return {
      showToast: {
        text: 'No SportyPlus pairing code set. Add one in this app’s subreddit settings.',
        appearance: 'neutral',
      },
    }
  }

  const res = await pairSubreddit(code)
  if (res.ok) {
    return {
      showToast: {
        text: `r/${context.subredditName} is linked to SportyPlus.`,
        appearance: 'success',
      },
    }
  }
  return {
    showToast: {
      text:
        res.status === 422
          ? 'That pairing code is invalid or already used. Generate a new one in SportyPlus.'
          : 'Could not reach SportyPlus. Try again shortly.',
      appearance: 'neutral',
    },
  }
}

async function routeAppInstall(): Promise<TriggerResponse> {
  const code = (await settings.get<string>('sportyPairingCode'))?.trim()
  if (code) await pairSubreddit(code)
  return {}
}

async function routeHeartbeat(): Promise<TriggerResponse> {
  await sendHeartbeat()
  return {}
}

function header(reqMsg: IncomingMessage, name: string): string | undefined {
  const v = reqMsg.headers[name]
  return Array.isArray(v) ? v[0] : v
}

async function readJson<T>(reqMsg: IncomingMessage): Promise<T> {
  const chunks: Uint8Array[] = []
  reqMsg.on('data', chunk => chunks.push(chunk))
  await once(reqMsg, 'end')
  return JSON.parse(`${Buffer.concat(chunks)}`)
}

function writeJson<T extends PartialJsonValue>(
  status: number,
  json: Readonly<T>,
  rsp: ServerResponse,
): void {
  const body = JSON.stringify(json)
  const len = Buffer.byteLength(body)
  rsp.writeHead(status, {
    'Content-Length': len,
    'Content-Type': 'application/json',
  })
  rsp.end(body)
}
