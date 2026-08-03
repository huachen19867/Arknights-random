/**
 * 匿名访问统计埋点（页面路由 PV / 30 分钟会话 / 当日匿名浏览器 UV / 抽卡次数）。
 *
 * 只在生产构建且配置 VITE_ANALYTICS_ENDPOINT 时上报，尊重 Do Not Track。
 * 严格只发送交接文档允许的字段：eventId、visitorId、sessionId、route、
 * clientTime（仅诊断）、referrerHost（仅 hostname）。抽卡事件只报告“完成了一次
 * 抽取”这个动作，不采集抽取结果、设置、Ban 名单、搜索词、完整 IP、
 * 完整 User-Agent 或完整 referrer。
 * 上报失败一律静默，绝不影响抽取、筛选或页面渲染。
 */

export const VISITOR_STORAGE_KEY = 'rhodes.analytics.visitor.v1'
export const SESSION_STORAGE_KEY = 'rhodes.analytics.session.v1'
export const SESSION_IDLE_MS = 30 * 60 * 1000

export const ANALYTICS_ROUTES = ['draw', 'ban', 'settings'] as const
export type AnalyticsRoute = (typeof ANALYTICS_ROUTES)[number]

export interface AnalyticsPayload {
  eventId: string
  visitorId: string
  sessionId: string
  route: AnalyticsRoute
  clientTime: string
  referrerHost: string
}

/** 抽卡事件载荷：只含匿名身份与时间，不携带任何抽取结果。 */
export interface DrawPayload {
  eventId: string
  visitorId: string
  sessionId: string
  clientTime: string
  referrerHost: string
}

/** 可注入的浏览器能力，便于在 node 环境做单元测试。 */
export interface AnalyticsBrowser {
  localStorage: Pick<Storage, 'getItem' | 'setItem'>
  sessionStorage: Pick<Storage, 'getItem' | 'setItem'>
  navigator: {
    sendBeacon?: (url: string, data?: BodyInit | null) => boolean
    doNotTrack?: string | null
  }
  crypto: Pick<Crypto, 'randomUUID'>
  document: { referrer: string }
  fetch: typeof globalThis.fetch
}

export interface AnalyticsOptions {
  /** 采集端点；空字符串表示禁用。 */
  endpoint: string
  /** 生产构建标志；开发环境必须为 false。 */
  prod: boolean
}

export interface SessionRecord {
  id: string
  lastActiveAt: number
}

const SAFE_ID_RE = /^[A-Za-z0-9-]{8,64}$/

function randomUuid(crypto: Pick<Crypto, 'randomUUID'>): string {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  // 极老浏览器兜底：仍只生成匿名随机 ID，不涉及任何个人身份信息。
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = (Math.random() * 16) | 0
    const value = char === 'x' ? random : (random & 0x3) | 0x8
    return value.toString(16)
  })
}

/** 从 document.referrer 只提取 hostname；解析失败或为空表示直接访问。 */
export function resolveReferrerHost(referrer: string): string {
  if (!referrer) return ''
  try {
    return new URL(referrer).hostname.toLowerCase()
  } catch {
    return ''
  }
}

export function loadOrCreateVisitorId(browser: AnalyticsBrowser): string {
  const existing = browser.localStorage.getItem(VISITOR_STORAGE_KEY)
  if (existing && SAFE_ID_RE.test(existing)) return existing
  const next = randomUuid(browser.crypto)
  try {
    browser.localStorage.setItem(VISITOR_STORAGE_KEY, next)
  } catch {
    // localStorage 不可用时退化为仅当前会话内复用。
  }
  return next
}

/**
 * 读取或创建会话；距上次活动超过 30 分钟则换新 session ID。
 * 每次活动都会刷新 lastActiveAt，形成滑动 30 分钟会话。
 */
export function loadOrCreateSession(browser: AnalyticsBrowser, now: number): SessionRecord {
  let record: SessionRecord | null = null
  const raw = browser.sessionStorage.getItem(SESSION_STORAGE_KEY)
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Partial<SessionRecord>
      if (
        typeof parsed.id === 'string' &&
        SAFE_ID_RE.test(parsed.id) &&
        typeof parsed.lastActiveAt === 'number'
      ) {
        record = { id: parsed.id, lastActiveAt: parsed.lastActiveAt }
      }
    } catch {
      record = null
    }
  }
  const expired = record === null || now - record.lastActiveAt > SESSION_IDLE_MS
  const session: SessionRecord = {
    id: record !== null && !expired ? record.id : randomUuid(browser.crypto),
    lastActiveAt: now,
  }
  try {
    browser.sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session))
  } catch {
    // sessionStorage 不可用时忽略；事件仍可发送（sessionId 仅本次有效）。
  }
  return session
}

export function buildPayload(
  browser: AnalyticsBrowser,
  visitorId: string,
  sessionId: string,
  route: AnalyticsRoute,
  now: number,
): AnalyticsPayload {
  return {
    eventId: randomUuid(browser.crypto),
    visitorId,
    sessionId,
    route,
    clientTime: new Date(now).toISOString(),
    referrerHost: resolveReferrerHost(browser.document.referrer),
  }
}

export function buildDrawPayload(
  browser: AnalyticsBrowser,
  visitorId: string,
  sessionId: string,
  now: number,
): DrawPayload {
  return {
    eventId: randomUuid(browser.crypto),
    visitorId,
    sessionId,
    clientTime: new Date(now).toISOString(),
    referrerHost: resolveReferrerHost(browser.document.referrer),
  }
}

/** 优先 sendBeacon，失败降级 fetch(keepalive)；所有错误吞掉，不产生未处理 rejection。 */
async function sendEvent(endpoint: string, body: string, browser: AnalyticsBrowser): Promise<void> {
  try {
    const blob = new Blob([body], { type: 'text/plain;charset=UTF-8' })
    if (typeof browser.navigator.sendBeacon === 'function' && browser.navigator.sendBeacon(endpoint, blob)) {
      return
    }
  } catch {
    // 继续尝试 fetch 降级。
  }
  try {
    await browser.fetch(endpoint, {
      method: 'POST',
      body,
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      keepalive: true,
      mode: 'cors',
    })
  } catch {
    // 上报失败静默，绝不影响页面功能。
  }
}

export async function sendPageView(
  endpoint: string,
  payload: AnalyticsPayload,
  browser: AnalyticsBrowser,
): Promise<void> {
  await sendEvent(endpoint, JSON.stringify(payload), browser)
}

export async function sendDraw(
  endpoint: string,
  payload: DrawPayload,
  browser: AnalyticsBrowser,
): Promise<void> {
  await sendEvent(endpoint, JSON.stringify(payload), browser)
}

export interface AnalyticsTracker {
  trackPageView: (route: string) => void
  trackDraw: () => void
}

export function createAnalyticsTracker(options: AnalyticsOptions, browser: AnalyticsBrowser): AnalyticsTracker {
  const enabled = options.prod && options.endpoint.length > 0
  const doNotTrack = browser.navigator.doNotTrack === '1' || browser.navigator.doNotTrack === 'yes'
  return {
    trackPageView(route) {
      if (!enabled || doNotTrack) return
      if (!(ANALYTICS_ROUTES as readonly string[]).includes(route)) return
      const visitorId = loadOrCreateVisitorId(browser)
      const session = loadOrCreateSession(browser, Date.now())
      const payload = buildPayload(browser, visitorId, session.id, route as AnalyticsRoute, Date.now())
      void sendPageView(options.endpoint, payload, browser)
    },
    trackDraw() {
      if (!enabled || doNotTrack) return
      const visitorId = loadOrCreateVisitorId(browser)
      const session = loadOrCreateSession(browser, Date.now())
      const payload = buildDrawPayload(browser, visitorId, session.id, Date.now())
      void sendDraw(options.endpoint, payload, browser)
    },
  }
}

function safeStorage(storage: Storage): Pick<Storage, 'getItem' | 'setItem'> {
  return {
    getItem(key) {
      try {
        return storage.getItem(key)
      } catch {
        return null
      }
    },
    setItem(key, value) {
      try {
        storage.setItem(key, value)
      } catch {
        // 隐私模式等场景下忽略写入失败。
      }
    },
  }
}

function defaultBrowser(): AnalyticsBrowser {
  return {
    localStorage: safeStorage(window.localStorage),
    sessionStorage: safeStorage(window.sessionStorage),
    navigator: window.navigator,
    crypto: window.crypto,
    document: window.document,
    fetch: globalThis.fetch.bind(globalThis),
  }
}

/** 应用接入点：只在生产构建且配置端点时上报，portrait-test 等未知路由自动忽略。 */
export function trackPageView(route: string): void {
  const endpoint = import.meta.env.VITE_ANALYTICS_ENDPOINT ?? ''
  createAnalyticsTracker({ endpoint, prod: import.meta.env.PROD }, defaultBrowser()).trackPageView(route)
}

/** 应用接入点：完成一次抽取后调用；只在生产构建且配置端点时上报。 */
export function trackDraw(): void {
  const endpoint = import.meta.env.VITE_ANALYTICS_ENDPOINT ?? ''
  createAnalyticsTracker({ endpoint, prod: import.meta.env.PROD }, defaultBrowser()).trackDraw()
}
