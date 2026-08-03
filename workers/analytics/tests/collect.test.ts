import { env, SELF } from 'cloudflare:test'
import { afterEach, describe, expect, it } from 'vitest'
import {
  RATE_LIMIT_PER_WINDOW,
  classifyDevice,
  classifySource,
  dayCn,
  isBotUserAgent,
  validatePayload,
} from '../src/collect'


// 每个用例结束后清空各表数据（reset() 会连表结构一起删，不能用于 D1），
// 避免用例间数据互相污染（同文件共享同一 worker/数据库）。
afterEach(async () => {
  await env.DB.exec(
    'DELETE FROM events; DELETE FROM rate_buckets; DELETE FROM base_record_map; DELETE FROM sync_state;',
  )
})

const ORIGIN = 'https://huachen19867.github.io'

function payload(overrides: Record<string, unknown> = {}) {
  return {
    eventId: '11111111-1111-4111-8111-111111111111',
    visitorId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    sessionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    route: 'draw',
    clientTime: '2026-08-03T00:00:00.000Z',
    referrerHost: 'github.com',
    ...overrides,
  }
}

async function post(body: unknown, headers: Record<string, string> = {}) {
  return SELF.fetch('https://analytics.test/v1/page-view', {
    method: 'POST',
    headers: { Origin: ORIGIN, 'Content-Type': 'text/plain;charset=UTF-8', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

async function eventCount(): Promise<number> {
  const row = await env.DB.prepare('SELECT COUNT(*) AS count FROM events').first<{ count: number }>()
  return row?.count ?? 0
}

describe('collect unit', () => {
  it('合法 payload 通过校验', () => {
    const result = validatePayload(payload())
    expect(result.ok).toBe(true)
  })

  it('非法 eventId / visitorId / route / referrerHost 被拒绝', () => {
    expect(validatePayload(payload({ eventId: 'not-a-uuid' })).ok).toBe(false)
    expect(validatePayload(payload({ eventId: undefined })).ok).toBe(false)
    expect(validatePayload(payload({ visitorId: '' })).ok).toBe(false)
    expect(validatePayload(payload({ sessionId: 'x'.repeat(65) })).ok).toBe(false)
    expect(validatePayload(payload({ route: 'portrait-test' })).ok).toBe(false)
    expect(validatePayload(payload({ route: 'drawx' })).ok).toBe(false)
    expect(validatePayload(payload({ referrerHost: 'github.com/path' })).ok).toBe(false)
    expect(validatePayload(payload({ clientTime: 'not-a-date' })).ok).toBe(false)
    expect(validatePayload('string').ok).toBe(false)
    expect(validatePayload(null).ok).toBe(false)
  })

  it('上海时区 23:59 与 00:01 正确分到两天', () => {
    // UTC 16:00 = 上海次日 00:00；UTC 15:59:59 = 上海当日 23:59:59
    expect(dayCn(new Date('2026-08-02T16:00:00.000Z'), 'Asia/Shanghai')).toBe('2026-08-03')
    expect(dayCn(new Date('2026-08-02T15:59:59.000Z'), 'Asia/Shanghai')).toBe('2026-08-02')
    expect(dayCn(new Date('2026-08-02T16:00:01.000Z'), 'Asia/Shanghai')).toBe('2026-08-03')
  })

  it('设备分类粗分 desktop / mobile / tablet', () => {
    expect(classifyDevice('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0')).toBe('desktop')
    expect(classifyDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile Safari')).toBe('mobile')
    expect(classifyDevice('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit Mobile')).toBe('mobile')
    expect(classifyDevice('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) Safari')).toBe('tablet')
    expect(classifyDevice('Mozilla/5.0 (Linux; Android 14; SM-X910) AppleWebKit Tablet')).toBe('tablet')
  })

  it('来源归类为直接访问 / GitHub / 搜索引擎 / 其他外链', () => {
    expect(classifySource(undefined)).toBe('直接访问')
    expect(classifySource('')).toBe('直接访问')
    expect(classifySource('github.com')).toBe('GitHub')
    expect(classifySource('www.github.com')).toBe('GitHub')
    expect(classifySource('huachen19867.github.io')).toBe('GitHub')
    expect(classifySource('www.baidu.com')).toBe('搜索引擎')
    expect(classifySource('google.com.hk')).toBe('搜索引擎')
    expect(classifySource('example.com')).toBe('其他外链')
  })

  it('机器人 UA 被识别', () => {
    expect(isBotUserAgent('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)')).toBe(true)
    expect(isBotUserAgent('Mozilla/5.0 (compatible; bingbot/2.0)')).toBe(true)
    expect(isBotUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0')).toBe(false)
  })
})

describe('collect http', () => {
  it('合法 Origin + 合法 payload 返回 204 并写入一条', async () => {
    const response = await post(payload())
    expect(response.status).toBe(204)
    expect(await eventCount()).toBe(1)
  })

  it('相同 eventId 连续提交两次，D1 只有一条', async () => {
    await post(payload())
    await post(payload())
    expect(await eventCount()).toBe(1)
  })

  it('非允许 Origin 返回 403', async () => {
    const response = await post(payload(), { Origin: 'https://evil.example.com' })
    expect(response.status).toBe(403)
    expect(await eventCount()).toBe(0)
  })

  it('OPTIONS CORS 预检返回 204 与允许头', async () => {
    const response = await SELF.fetch('https://analytics.test/v1/page-view', {
      method: 'OPTIONS',
      headers: { Origin: ORIGIN, 'Access-Control-Request-Method': 'POST' },
    })
    expect(response.status).toBe(204)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN)
    expect(response.headers.get('Access-Control-Allow-Methods')).toContain('POST')
    expect(response.headers.get('Vary')).toContain('Origin')
  })

  it('超过 1 KB 返回 413', async () => {
    const response = await post(payload({ clientTime: 'x'.repeat(1200) }))
    expect(response.status).toBe(413)
    expect(await eventCount()).toBe(0)
  })

  it('非法 UUID 与未知 route 返回 400', async () => {
    expect((await post(payload({ eventId: 'bad' }))).status).toBe(400)
    expect((await post(payload({ route: 'portrait-test' }))).status).toBe(400)
    expect(await eventCount()).toBe(0)
  })

  it('机器人 UA 不计数', async () => {
    const response = await post(payload(), { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' })
    expect(response.status).toBe(204)
    expect(await eventCount()).toBe(0)
  })

  it('限流达到阈值后返回 429', async () => {
    for (let i = 0; i < RATE_LIMIT_PER_WINDOW; i += 1) {
      const response = await post(payload({ eventId: `11111111-1111-4111-8111-${String(i).padStart(12, '0')}` }))
      expect(response.status).toBe(204)
    }
    const blocked = await post(payload({ eventId: '22222222-2222-4222-8222-222222222222' }))
    expect(blocked.status).toBe(429)
    expect(await eventCount()).toBe(RATE_LIMIT_PER_WINDOW)
  })

  it('D1 不含原始 IP、完整 UA、完整 referrer', async () => {
    await post(payload({ referrerHost: 'github.com' }), {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0',
      'CF-Connecting-IP': '203.0.113.7',
    })
    const rows = await env.DB.prepare('SELECT * FROM events').all<Record<string, unknown>>()
    expect(rows.results).toHaveLength(1)
    const row = rows.results[0]
    expect(Object.values(row).join('|')).not.toContain('203.0.113.7')
    expect(Object.values(row).join('|')).not.toContain('Chrome/120.0')
    expect(Object.values(row).join('|')).not.toContain('github.com')
    expect(String(row.visitor_hash)).toMatch(/^[0-9a-f]{64}$/)
    expect(String(row.session_hash)).toMatch(/^[0-9a-f]{64}$/)
    expect(row.route).toBe('draw')
    expect(row.day_cn).toBe(dayCn(new Date(), 'Asia/Shanghai'))
  })

  it('未知路径返回 404', async () => {
    const response = await SELF.fetch('https://analytics.test/other', { method: 'GET' })
    expect(response.status).toBe(404)
  })
})