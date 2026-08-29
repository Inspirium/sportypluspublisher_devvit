import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import type {AddressInfo, Server} from 'node:net'
import {after, before, beforeEach, test} from 'node:test'
import {
  type Context,
  reddit,
  redis,
  runWithContext,
  settings,
} from '@devvit/web/server'
import {
  Endpoint,
  type ErrorRsp,
  type PublishReq,
  type PublishRsp,
} from '../shared/api.ts'
import {onReq} from './server.ts'

let server: Server
let serverURL: string
const redisValues = new Map<string, string>()
const settingsValues = new Map<string, string>()

type FetchCall = {url: string; init: RequestInit | undefined}
let fetchCalls: FetchCall[] = []
let fetchResponder: (url: string) => Response = () =>
  new Response('{"ok":true}', {status: 200})

let submitPostCalls: unknown[] = []
let submitPostImpl: (opts: {title: string}) => {id: string; url: string} =
  opts => ({
    id: `t3_${opts.title.length}`,
    url: 'https://reddit.com/r/test/comments/abc',
  })

const orig = {
  redisGet: redis.get.bind(redis),
  redisSet: redis.set.bind(redis),
  settingsGet: settings.get.bind(settings),
  submitPost: reddit.submitPost.bind(reddit),
  fetch: globalThis.fetch,
}

before(async () => {
  redis.get = async key => redisValues.get(key)
  redis.set = async (key, value) => {
    redisValues.set(key, value)
    return 'OK'
  }
  settings.get = (async (name: string) =>
    settingsValues.get(name)) as unknown as typeof settings.get
  reddit.submitPost = (async (opts: {title: string}) => {
    submitPostCalls.push(opts)
    return submitPostImpl(opts)
  }) as unknown as typeof reddit.submitPost
  // Intercept only calls to the SportyPlus API; let the test's own requests to
  // the local server through to the real fetch.
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString()
    if (!url.includes('sporty.plus')) return orig.fetch(input, init)
    fetchCalls.push({url, init})
    return fetchResponder(url)
  }) as typeof fetch

  server = createServer(async (req, rsp) => {
    await runWithContext(
      {
        appName: 'sportypluspublisher',
        appSlug: 'sportypluspublisher',
        subredditId: 't5_abc',
        subredditName: 'sportypluspublish_dev',
        postId: 't3_123',
        userId: 't2_123',
        username: 'username',
      } as unknown as Context,
      () => onReq(req, rsp),
    )
  })
  await new Promise<void>(resolve => {
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const info = server.address() as AddressInfo
  serverURL = `http://127.0.0.1:${info.port}`
})

after(async () => {
  redis.get = orig.redisGet
  redis.set = orig.redisSet
  settings.get = orig.settingsGet
  reddit.submitPost = orig.submitPost
  globalThis.fetch = orig.fetch
  if (!server.listening) return
  await new Promise<void>((resolve, reject) => {
    server.close(err => (err ? reject(err) : resolve()))
  })
})

beforeEach(() => {
  redisValues.clear()
  settingsValues.clear()
  fetchCalls = []
  submitPostCalls = []
  fetchResponder = () => new Response('{"ok":true}', {status: 200})
  submitPostImpl = opts => ({
    id: `t3_${opts.title.length}`,
    url: 'https://reddit.com/r/test/comments/abc',
  })
})

test('wrong method', async () => {
  const rsp = await fetch(`${serverURL}/${Endpoint.ExternalPublish}`)
  assert.equal(rsp.status, 404)
  assert.deepEqual<ErrorRsp>(await rsp.json(), {
    error: 'not found',
    status: 404,
  })
})

test('404', async () => {
  const rsp = await fetch(serverURL)
  assert.equal(rsp.status, 404)
  assert.deepEqual<ErrorRsp>(await rsp.json(), {
    error: 'not found',
    status: 404,
  })
})

function onlySportyCall(): FetchCall {
  assert.equal(fetchCalls.length, 1)
  const call = fetchCalls[0]
  assert.ok(call)
  return call
}

async function publish(
  req: Partial<PublishReq>,
  headers: Record<string, string> = {'x-sporty-secret': 'sekret'},
): Promise<Response> {
  return fetch(`${serverURL}/${Endpoint.ExternalPublish}`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json', ...headers},
    body: JSON.stringify(req),
  })
}

test('publish: submits a self post to the install subreddit', async () => {
  settingsValues.set('sportySharedSecret', 'sekret')
  const rsp = await publish({
    idempotencyKey: 'tgt-1',
    title: 'Tournament open',
    body: 'Sign-ups are live.',
  })
  assert.equal(rsp.status, 200)
  const out = (await rsp.json()) as PublishRsp
  assert.equal(out.postId, 't3_15')
  assert.equal(submitPostCalls.length, 1)
  assert.deepEqual(submitPostCalls[0], {
    subredditName: 'sportypluspublish_dev',
    title: 'Tournament open',
    flairId: undefined,
    text: 'Sign-ups are live.',
  })
})

test('publish: submits a link post when url is given and body is absent', async () => {
  settingsValues.set('sportySharedSecret', 'sekret')
  await publish({
    idempotencyKey: 'tgt-2',
    title: 'News',
    url: 'https://club.sporty.plus/news/1',
  })
  assert.deepEqual(submitPostCalls[0], {
    subredditName: 'sportypluspublish_dev',
    title: 'News',
    flairId: undefined,
    url: 'https://club.sporty.plus/news/1',
  })
})

test('publish: wrong secret is forbidden', async () => {
  settingsValues.set('sportySharedSecret', 'sekret')
  const rsp = await publish(
    {idempotencyKey: 'x', title: 't', body: 'b'},
    {'x-sporty-secret': 'nope'},
  )
  assert.equal(rsp.status, 403)
  assert.equal(submitPostCalls.length, 0)
})

test('publish: no configured secret is forbidden', async () => {
  const rsp = await publish({idempotencyKey: 'x', title: 't', body: 'b'})
  assert.equal(rsp.status, 403)
})

test('publish: replay with same idempotencyKey does not submit twice', async () => {
  settingsValues.set('sportySharedSecret', 'sekret')
  const first = (await (
    await publish({idempotencyKey: 'dupe', title: 'One', body: 'b'})
  ).json()) as PublishRsp
  const second = (await (
    await publish({idempotencyKey: 'dupe', title: 'One', body: 'b'})
  ).json()) as PublishRsp
  assert.deepEqual(first, second)
  assert.equal(submitPostCalls.length, 1)
})

test('publish: missing title or content is a 400', async () => {
  settingsValues.set('sportySharedSecret', 'sekret')
  assert.equal((await publish({idempotencyKey: 'a', title: 'ok'})).status, 400)
  assert.equal((await publish({idempotencyKey: 'a', body: 'b'})).status, 400)
})

test('publish: a reddit failure is a 502 for the caller to classify', async () => {
  settingsValues.set('sportySharedSecret', 'sekret')
  submitPostImpl = () => {
    throw new Error('SUBREDDIT_RATELIMIT')
  }
  const rsp = await publish({idempotencyKey: 'f', title: 't', body: 'b'})
  assert.equal(rsp.status, 502)
})

test('onAppInstall: posts the pairing code to SportyPlus when one is set', async () => {
  settingsValues.set('sportyPairingCode', 'SPRT-7F3K')
  settingsValues.set('sportyApiBase', 'https://api.staging.sporty.plus')
  const rsp = await fetch(`${serverURL}/${Endpoint.OnAppInstall}`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: '{}',
  })
  assert.equal(rsp.status, 200)
  const call = onlySportyCall()
  assert.equal(
    call.url,
    'https://api.staging.sporty.plus/api/v3/social/reddit/devvit/pair',
  )
  const sent = JSON.parse((call.init?.body as string) ?? '{}')
  assert.deepEqual(sent, {
    pairingCode: 'SPRT-7F3K',
    subredditId: 't5_abc',
    subredditName: 'sportypluspublish_dev',
    appSlug: 'sportypluspublisher',
  })
})

test('onAppInstall: no pairing code means no callback', async () => {
  const rsp = await fetch(`${serverURL}/${Endpoint.OnAppInstall}`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: '{}',
  })
  assert.equal(rsp.status, 200)
  assert.equal(fetchCalls.length, 0)
})

test('heartbeat cron pings SportyPlus', async () => {
  const rsp = await fetch(`${serverURL}/${Endpoint.OnCronHeartbeat}`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: '{}',
  })
  assert.equal(rsp.status, 200)
  assert.match(
    onlySportyCall().url,
    /\/api\/v3\/social\/reddit\/devvit\/heartbeat$/,
  )
})
