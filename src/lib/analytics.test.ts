import { describe, expect, it, vi } from 'vitest'
import {
  SESSION_IDLE_MS,
  VISITOR_STORAGE_KEY,
  createAnalyticsTracker,
  loadOrCreateSession,
  loadOrCreateVisitorId,
  resolveReferrerHost,
  type AnalyticsBrowser,
} from './analytics'

const ENDPOINT = 'https://analytics.example.test/v1/page-view'

function memoryStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial))
  return {
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null
    },
    setItem(key: string, value: string) {
      store.set(key, value)
    },
    read(key: string) {
      return store.get(key) ?? null
    },
  }
}

function makeBrowser(overrides: Partial<AnalyticsBrowser> = {}): AnalyticsBrowser {
  const sendBeacon = vi.fn(() => true)
  const fetchMock = vi.fn(async () => new Response(null, { status: 204 }))
  let uuidCounter = 0
  return {
    localStorage: memoryStorage(),
    sessionStorage: memoryStorage(),
    crypto: {
      randomUUID() {
        uuidCounter += 1
        return `00000000-0000-4000-8000-${String(uuidCounter).padStart(12, '0')}`
      },
    },
    document: { referrer: '' },
    fetch: fetchMock,
    ...overrides,
    navigator: { sendBeacon, doNotTrack: undefined, ...(overrides.navigator ?? {}) },
  }
}

function trackerWith(browser: AnalyticsBrowser, prod = true, endpoint = ENDPOINT) {
  return createAnalyticsTracker({ endpoint, prod }, browser)
}

describe('analytics', () => {
  it('没有 endpoint 时不发送、不报错', () => {
    const browser = makeBrowser()
    expect(() => trackerWith(browser, true, '').trackPageView('draw')).not.toThrow()
    expect(browser.navigator.sendBeacon).not.toHaveBeenCalled()
    expect(browser.fetch).not.toHaveBeenCalled()
  })

  it('非生产构建不发送', () => {
    const browser = makeBrowser()
    trackerWith(browser, false).trackPageView('draw')
    expect(browser.navigator.sendBeacon).not.toHaveBeenCalled()
  })

  it('portrait-test 与未知路由不发送', () => {
    const browser = makeBrowser()
    trackerWith(browser).trackPageView('portrait-test')
    trackerWith(browser).trackPageView('whatever')
    expect(browser.navigator.sendBeacon).not.toHaveBeenCalled()
    expect(browser.fetch).not.toHaveBeenCalled()
  })

  it('DNT=1 时不创建 visitor ID、不发送', () => {
    const browser = makeBrowser({ navigator: { sendBeacon: vi.fn(() => true), doNotTrack: '1' } })
    trackerWith(browser).trackPageView('draw')
    expect(browser.navigator.sendBeacon).not.toHaveBeenCalled()
    expect(browser.localStorage.getItem(VISITOR_STORAGE_KEY)).toBeNull()
  })

  it('首次访问创建 visitor 与 session ID', () => {
    const browser = makeBrowser()
    trackerWith(browser).trackPageView('draw')
    expect(browser.localStorage.getItem(VISITOR_STORAGE_KEY)).toMatch(/^[0-9a-f-]{36}$/)
    const session = browser.sessionStorage.getItem('rhodes.analytics.session.v1')
    expect(session).not.toBeNull()
    const parsed = JSON.parse(session!)
    expect(parsed.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(typeof parsed.lastActiveAt).toBe('number')
  })

  it('30 分钟内沿用 session，超过 30 分钟换新 session', () => {
    const browser = makeBrowser()
    const tracker = trackerWith(browser)
    tracker.trackPageView('draw')
    const first = JSON.parse(browser.sessionStorage.getItem('rhodes.analytics.session.v1')!)
    tracker.trackPageView('ban')
    const second = JSON.parse(browser.sessionStorage.getItem('rhodes.analytics.session.v1')!)
    expect(second.id).toBe(first.id)

    const stale = {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      lastActiveAt: Date.now() - SESSION_IDLE_MS - 1000,
    }
    const staleStorage = memoryStorage({ 'rhodes.analytics.session.v1': JSON.stringify(stale) })
    const staleBrowser = makeBrowser({ sessionStorage: staleStorage })
    const renewed = loadOrCreateSession(staleBrowser, Date.now())
    expect(renewed.id).not.toBe(stale.id)
  })

  it('referrer 只发送 hostname，路径与查询参数被删除', async () => {
    const browser = makeBrowser({
      document: { referrer: 'https://github.com/huachen19867/Arknights-random?utm=x#frag' },
    })
    const beacon = browser.navigator.sendBeacon as ReturnType<typeof vi.fn>
    trackerWith(browser).trackPageView('draw')
    expect(beacon).toHaveBeenCalledTimes(1)
    const blob = beacon.mock.calls[0][1] as Blob
    const payload = JSON.parse(await blob.text())
    expect(payload.referrerHost).toBe('github.com')
    expect(payload.route).toBe('draw')
    expect(payload.eventId).toMatch(/^[0-9a-f-]{36}$/)
    expect(payload.clientTime).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(JSON.stringify(payload)).not.toContain('utm')
  })

  it('sendBeacon 返回 false 时降级 fetch', async () => {
    const browser = makeBrowser({
      navigator: { sendBeacon: vi.fn(() => false), doNotTrack: undefined },
    })
    trackerWith(browser).trackPageView('draw')
    expect(browser.fetch).toHaveBeenCalledTimes(1)
    const [url, init] = (browser.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit]
    expect(url).toBe(ENDPOINT)
    expect(init.method).toBe('POST')
    expect(init.keepalive).toBe(true)
  })

  it('fetch 降级也失败时不影响 App，且不产生未处理 rejection', async () => {
    const browser = makeBrowser({
      navigator: { sendBeacon: vi.fn(() => false), doNotTrack: undefined },
      fetch: vi.fn(async () => {
        throw new Error('network down')
      }),
    })
    await expect(Promise.resolve(trackerWith(browser).trackPageView('draw'))).resolves.toBeUndefined()
    expect(browser.fetch).toHaveBeenCalledTimes(1)
  })

  it('每次 track 只发送一次', () => {
    const browser = makeBrowser()
    trackerWith(browser).trackPageView('settings')
    expect(browser.navigator.sendBeacon).toHaveBeenCalledTimes(1)
  })

  it('resolveReferrerHost 只保留 hostname', () => {
    expect(resolveReferrerHost('https://Bing.com/search?q=x')).toBe('bing.com')
    expect(resolveReferrerHost('')).toBe('')
    expect(resolveReferrerHost('not a url')).toBe('')
  })

  it('loadOrCreateVisitorId 复用已有合法 ID', () => {
    const browser = makeBrowser({
      localStorage: memoryStorage({ [VISITOR_STORAGE_KEY]: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }),
    })
    expect(loadOrCreateVisitorId(browser)).toBe('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
  })
})