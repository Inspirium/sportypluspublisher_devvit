import type {T3} from '@devvit/web/shared'

/** Generic error detail for all responses. */
export type ErrorRsp = {error: string; status: number}

/** The current counter state for this post. */
export type GetCounterRsp = {count: number}

/** Increment the post counter by a signed amount. */
export type IncCounterReq = {amount: number}
export type IncCounterRsp = {count: number}

/**
 * Submit a post to the subreddit this app is installed in. Called by the
 * SportyPlus backend (`RedditDevvitAdapter`) over `/external/`. The subreddit is
 * not a parameter — it is fixed by the install and read from `context`.
 *
 * `idempotencyKey` is the SportyPlus `social_post_targets.id`; a replay with the
 * same key returns the original result instead of creating a second post, so the
 * Laravel job's retries are safe.
 *
 * Exactly one of `body` (self/text post, markdown) or `url` (link post) drives
 * the post kind. `body` wins if both are present.
 */
export type PublishReq = {
  idempotencyKey: string
  title: string
  body?: string
  url?: string
  flairId?: string
}
export type PublishRsp = {postId: T3; url: string}

export type Endpoint = (typeof Endpoint)[keyof typeof Endpoint]
export const Endpoint = {
  GetCounter: 'api/counter',
  IncCounter: 'api/counter/inc',
  ExternalPublish: 'external/publish',
  OnAppInstall: 'internal/on/app/install',
  OnMenuNewPost: 'internal/on/menu/new-post',
  OnMenuLink: 'internal/on/menu/link',
  OnCronHeartbeat: 'internal/on/cron/heartbeat',
} as const

export const EndpointMethod = {
  [Endpoint.GetCounter]: 'GET',
  [Endpoint.IncCounter]: 'POST',
  [Endpoint.ExternalPublish]: 'POST',
  [Endpoint.OnAppInstall]: 'POST',
  [Endpoint.OnMenuNewPost]: 'POST',
  [Endpoint.OnMenuLink]: 'POST',
  [Endpoint.OnCronHeartbeat]: 'POST',
} as const satisfies {[endpoint: string]: 'GET' | 'POST'}
