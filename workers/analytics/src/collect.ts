/**
 * 采集端点：校验、去重、限流、分类，然后写入 D1。
 * 本模块只保存匿名散列与分类结果；原始 IP、完整 UA、完整 referrer 用完即弃，
 * 严禁写入 D1、日志或飞书。
 */

export const ALLOWED_ROUTES = ['draw', 'ban', 'settings'] as const
export type Route = (typeof ALLOWED_ROUTES)[number]
export type Device = 'desktop' | 'mobile' | 'tablet'
export type Source = '直接访问' | 'GitHub' | '搜索引擎' | '其他外链'

export const MAX_PAYLOAD_BYTES = 1024
export const RATE_WINDOW_SECONDS = 600
export const RATE_LIMIT_PER_WINDOW = 120

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/
const HOSTNAME_RE =
  /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i

const BOT_UA_RE =
  /(googlebot|bingbot|duckduckbot|baiduspider|yandexbot|sogou|exabot|semrushbot|ahrefsbot|mj12bot|dotbot|twitterbot|facebookexternalhit|slurp|petalbot|bytespider|applebot|gptbot|ccbot|anthropic-ai|claudebot|perplexitybot)/i

export interface PageViewPayload {
  eventId: string
  visitorId: string
  sessionId: string
  route: Route
  /** 客户端时间，仅诊断，不参与正式日统计。 */
  clientTime?: string
  /** 只保留 hostname；空字符串表示直接访问。 */
  referrerHost?: string
}

export interface StoredEvent {
  eventId: string
  receivedAt: string
  dayCn: string
  route: Route
  visitorHash: string
  sessionHash: string
  device: Device
  source: Source
}

/** 用 UA 粗分设备类别，随后丢弃原始 UA。 */
export function classifyDevice(userAgent: string): Device {
  const ua = userAgent.toLowerCase()
  if (ua.includes('ipad') || (ua.includes('android') && !ua.includes('mobi')) || ua.includes('tablet')) {
    return 'tablet'
  }
  if (ua.includes('mobi') || ua.includes('iphone') || ua.includes('ipod')) {
    return 'mobile'
  }
  return 'desktop'
}

const SEARCH_ENGINE_HOSTS = [
  'baidu.com',
  'google.com',
  'google.com.hk',
  'bing.com',
  'sogou.com',
  'so.com',
  'yandex.com',
  'yandex.ru',
  'duckduckgo.com',
  'ecosia.org',
  'search.brave.com',
]

/** 来源归类为直接访问、GitHub、搜索引擎或其他外链，随后丢弃原始 referrerHost。 */
export function classifySource(referrerHost: string | undefined): Source {
  if (!referrerHost) return '直接访问'
  const host = referrerHost.toLowerCase().replace(/^www\./, '')
  if (host === 'github.com' || host.endsWith('.github.io') || host.endsWith('.github.com')) {
    return 'GitHub'
  }
  if (SEARCH_ENGINE_HOSTS.some((candidate) => host === candidate || host.endsWith(`.${candidate}`))) {
    return '搜索引擎'
  }
  return '其他外链'
}

/** 拒绝明显机器人 UA；不把完整 UA 写入 D1。 */
export function isBotUserAgent(userAgent: string): boolean {
  return BOT_UA_RE.test(userAgent.toLowerCase())
}

export function validatePayload(
  raw: unknown,
): { ok: true; payload: PageViewPayload } | { ok: false; reason: string } {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, reason: 'payload must be a JSON object' }
  }
  const obj = raw as Record<string, unknown>

  const eventId = obj.eventId
  if (typeof eventId !== 'string' || !UUID_RE.test(eventId)) {
    return { ok: false, reason: 'invalid eventId' }
  }
  const visitorId = obj.visitorId
  if (typeof visitorId !== 'string' || !ID_RE.test(visitorId)) {
    return { ok: false, reason: 'invalid visitorId' }
  }
  const sessionId = obj.sessionId
  if (typeof sessionId !== 'string' || !ID_RE.test(sessionId)) {
    return { ok: false, reason: 'invalid sessionId' }
  }
  const route = obj.route
  if (typeof route !== 'string' || !(ALLOWED_ROUTES as readonly string[]).includes(route)) {
    return { ok: false, reason: 'invalid route' }
  }

  let clientTime: string | undefined
  if (obj.clientTime !== undefined) {
    if (typeof obj.clientTime !== 'string' || obj.clientTime.length > 64) {
      return { ok: false, reason: 'invalid clientTime' }
    }
    if (Number.isNaN(Date.parse(obj.clientTime))) {
      return { ok: false, reason: 'invalid clientTime' }
    }
    clientTime = obj.clientTime
  }

  let referrerHost: string | undefined
  if (obj.referrerHost !== undefined) {
    if (typeof obj.referrerHost !== 'string' || (obj.referrerHost.length > 0 && !HOSTNAME_RE.test(obj.referrerHost))) {
      return { ok: false, reason: 'invalid referrerHost' }
    }
    referrerHost = obj.referrerHost
  }

  return {
    ok: true,
    payload: { eventId, visitorId, sessionId, route: route as Route, clientTime, referrerHost },
  }
}

const DAY_FORMATTER_CACHE = new Map<string, Intl.DateTimeFormat>()

/** 服务端时间按指定时区（默认 Asia/Shanghai）归日，返回 YYYY-MM-DD。 */
export function dayCn(date: Date, timeZone: string): string {
  let formatter = DAY_FORMATTER_CACHE.get(timeZone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
    DAY_FORMATTER_CACHE.set(timeZone, formatter)
  }
  return formatter.format(date)
}

/** HMAC-SHA-256 十六进制；散列按日加盐，不能跨日关联。 */
export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message))
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function rateBucketKey(networkHash: string, receivedAt: Date): string {
  const windowStart = Math.floor(receivedAt.getTime() / 1000 / RATE_WINDOW_SECONDS) * RATE_WINDOW_SECONDS
  return `${networkHash}:${windowStart}`
}

/** 按 10 分钟窗口计数；超过 limit 返回 false（限流拒绝）。 */
export async function checkAndIncrementRateLimit(
  db: D1Database,
  bucketKey: string,
  receivedAt: Date,
  limit: number,
): Promise<boolean> {
  const row = await db
    .prepare(
      `INSERT INTO rate_buckets (bucket_key, window_start, event_count)
       VALUES (?1, ?2, 1)
       ON CONFLICT(bucket_key) DO UPDATE SET event_count = rate_buckets.event_count + 1
       RETURNING event_count`,
    )
    .bind(bucketKey, receivedAt.getTime())
    .first<{ event_count: number }>()
  return (row?.event_count ?? 1) <= limit
}

/** INSERT OR IGNORE：相同 eventId 重试不重复计数。返回是否真的插入。 */
export async function insertEvent(db: D1Database, event: StoredEvent): Promise<boolean> {
  const result = await db
    .prepare(
      `INSERT OR IGNORE INTO events
       (event_id, received_at, day_cn, route, visitor_hash, session_hash, device, source)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
    )
    .bind(
      event.eventId,
      event.receivedAt,
      event.dayCn,
      event.route,
      event.visitorHash,
      event.sessionHash,
      event.device,
      event.source,
    )
    .run()
  return result.meta.changes > 0
}

/** collect 需要的环境字段；与 AnalyticsEnv 结构兼容。 */
export interface CollectEnv {
  DB: D1Database
  ALLOWED_ORIGIN: string
  TIME_ZONE: string
  ANALYTICS_HASH_SALT: string
}

const noStore = () => ({ 'Cache-Control': 'no-store' })

function corsHeaders(request: Request, allowed: boolean): Record<string, string> {
  const origin = request.headers.get('Origin')
  if (allowed && origin) {
    return {
      'Access-Control-Allow-Origin': origin,
      'Vary': 'Origin',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    }
  }
  return { 'Vary': 'Origin' }
}

function jsonError(status: number, code: string, message: string, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...noStore(), ...headers },
  })
}

/**
 * POST /v1/page-view 处理链：CORS → 大小 → JSON → 校验 → 机器人过滤 → 匿名散列 →
 * 限流 → INSERT OR IGNORE。采集写 D1 成功后才返回 204；飞书同步绝不在请求路径执行。
 */
export async function handleCollect(request: Request, env: CollectEnv): Promise<Response> {
  if (request.method === 'OPTIONS') {
    const origin = request.headers.get('Origin')
    const allowed = origin !== null && isAllowedOrigin(origin, env.ALLOWED_ORIGIN)
    return new Response(null, { status: 204, headers: { ...noStore(), ...corsHeaders(request, allowed) } })
  }
  if (request.method !== 'POST') {
    return jsonError(405, 'method_not_allowed', 'only POST allowed')
  }

  const origin = request.headers.get('Origin')
  if (origin !== null && !isAllowedOrigin(origin, env.ALLOWED_ORIGIN)) {
    return jsonError(403, 'origin_not_allowed', 'origin not allowed', corsHeaders(request, false))
  }

  const bodyText = await request.text()
  if (new TextEncoder().encode(bodyText).length > MAX_PAYLOAD_BYTES) {
    return jsonError(413, 'payload_too_large', 'payload exceeds 1KB', corsHeaders(request, origin !== null))
  }

  let raw: unknown
  try {
    raw = JSON.parse(bodyText)
  } catch {
    return jsonError(400, 'invalid_json', 'body must be valid JSON', corsHeaders(request, origin !== null))
  }

  const validated = validatePayload(raw)
  if (!validated.ok) {
    return jsonError(400, 'invalid_payload', validated.reason, corsHeaders(request, origin !== null))
  }

  const userAgent = request.headers.get('User-Agent') ?? ''
  if (isBotUserAgent(userAgent)) {
    // 机器人事件静默丢弃，不计数也不返回可被探测的区分。
    return new Response(null, { status: 204, headers: { ...noStore(), ...corsHeaders(request, origin !== null) } })
  }

  const receivedAt = new Date()
  const timeZone = env.TIME_ZONE || 'Asia/Shanghai'
  const day = dayCn(receivedAt, timeZone)
  const salt = env.ANALYTICS_HASH_SALT

  const visitorHash = await hmacSha256Hex(salt, `${day}:${validated.payload.visitorId}`)
  const sessionHash = await hmacSha256Hex(salt, `${day}:${validated.payload.sessionId}`)
  const ip = request.headers.get('CF-Connecting-IP') ?? ''
  // 网络散列只在内存/限流桶中使用（桶键本身即散列），D1 不保存原始 IP。
  const networkHash = await hmacSha256Hex(salt, `${day}:${ip}`)

  const allowed = await checkAndIncrementRateLimit(
    env.DB,
    rateBucketKey(networkHash, receivedAt),
    receivedAt,
    RATE_LIMIT_PER_WINDOW,
  )
  if (!allowed) {
    return jsonError(429, 'rate_limited', 'too many requests', corsHeaders(request, origin !== null))
  }

  const event: StoredEvent = {
    eventId: validated.payload.eventId,
    receivedAt: receivedAt.toISOString(),
    dayCn: day,
    route: validated.payload.route,
    visitorHash,
    sessionHash,
    device: classifyDevice(userAgent),
    source: classifySource(validated.payload.referrerHost),
  }
  try {
    await insertEvent(env.DB, event)
  } catch (error) {
    // D1 写入失败：本次事件可能丢失，返回 503；前端静默，不影响网站。
    console.error('d1 insert failed', error instanceof Error ? error.message : String(error))
    return jsonError(503, 'd1_error', 'failed to store event', corsHeaders(request, origin !== null))
  }
  return new Response(null, { status: 204, headers: { ...noStore(), ...corsHeaders(request, origin !== null) } })
}

export function isAllowedOrigin(origin: string, allowedOrigins: string): boolean {
  return allowedOrigins
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .includes(origin)
}