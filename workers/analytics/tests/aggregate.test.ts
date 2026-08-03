import { env } from 'cloudflare:test'
import { afterEach, describe, expect, it } from 'vitest'
import {
  COLLECTION_VERSION,
  DRAW_WATERMARK_KEY,
  LOCK_KEY,
  WATERMARK_KEY,
  acquireLock,
  addDays,
  cleanup,
  collectDayDrawMetrics,
  collectDayMetrics,
  dayToEpochMs,
  drawRowToFields,
  releaseLock,
  rowToFields,
  runAggregation,
  type DrawMetricRow,
  type MetricRow,
} from '../src/aggregate'
import { dayCn } from '../src/collect'
import { FeishuError, type FeishuClient, type FeishuFields } from '../src/feishu'
import type { AnalyticsEnv } from '../src/index'


// 每个用例结束后清空各表数据（reset() 会连表结构一起删，不能用于 D1），
// 避免用例间数据互相污染（同文件共享同一 worker/数据库）。
afterEach(async () => {
  await env.DB.exec(
    'DELETE FROM events; DELETE FROM draw_events; DELETE FROM rate_buckets; DELETE FROM base_record_map; DELETE FROM draw_record_map; DELETE FROM sync_state;',
  )
})

const TIME_ZONE = 'Asia/Shanghai'

interface FakeCalls {
  create: Array<{ key: string; fields: FeishuFields }>
  update: Array<{ recordId: string; key: string; fields: FeishuFields }>
}

function makeFakeFeishu(failCreateWith?: FeishuError): { client: FeishuClient; calls: FakeCalls } {
  const calls: FakeCalls = { create: [], update: [] }
  let counter = 0
  const client: FeishuClient = {
    async createRecords(items) {
      if (failCreateWith) throw failCreateWith
      calls.create.push(...items)
      return items.map((item) => ({ key: item.key, recordId: `rec_test_${counter++}` }))
    },
    async updateRecords(items) {
      calls.update.push(...items)
    },
  }
  return { client, calls }
}

async function insertEvent(overrides: Partial<Record<string, string | number>> = {}) {
  const event = {
    event_id: overrides.event_id ?? `evt_${Math.random().toString(36).slice(2, 10)}`,
    received_at: overrides.received_at ?? new Date().toISOString(),
    day_cn: overrides.day_cn ?? '2026-08-01',
    route: overrides.route ?? 'draw',
    visitor_hash: overrides.visitor_hash ?? 'v1'.repeat(32),
    session_hash: overrides.session_hash ?? 's1'.repeat(32),
    device: overrides.device ?? 'desktop',
    source: overrides.source ?? '直接访问',
  }
  await env.DB.prepare(
    `INSERT INTO events (event_id, received_at, day_cn, route, visitor_hash, session_hash, device, source)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
  )
    .bind(event.event_id, event.received_at, event.day_cn, event.route, event.visitor_hash, event.session_hash, event.device, event.source)
    .run()
}

async function insertDrawEvent(overrides: Partial<Record<string, string | number>> = {}) {
  const event = {
    event_id: overrides.event_id ?? `draw_${Math.random().toString(36).slice(2, 10)}`,
    received_at: overrides.received_at ?? new Date().toISOString(),
    day_cn: overrides.day_cn ?? '2026-08-01',
    visitor_hash: overrides.visitor_hash ?? 'v1'.repeat(32),
    session_hash: overrides.session_hash ?? 's1'.repeat(32),
    device: overrides.device ?? 'desktop',
    source: overrides.source ?? '直接访问',
  }
  await env.DB.prepare(
    `INSERT INTO draw_events (event_id, received_at, day_cn, visitor_hash, session_hash, device, source)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
  )
    .bind(event.event_id, event.received_at, event.day_cn, event.visitor_hash, event.session_hash, event.device, event.source)
    .run()
}

function aggregateEnv(): AnalyticsEnv {
  return { ...(env as unknown as AnalyticsEnv), TIME_ZONE } as AnalyticsEnv
}

async function watermark(): Promise<string | null> {
  const row = await env.DB.prepare('SELECT state_value FROM sync_state WHERE state_key = ?1')
    .bind(WATERMARK_KEY)
    .first<{ state_value: string }>()
  return row?.state_value ?? null
}

async function drawWatermark(): Promise<string | null> {
  const row = await env.DB.prepare('SELECT state_value FROM sync_state WHERE state_key = ?1')
    .bind(DRAW_WATERMARK_KEY)
    .first<{ state_value: string }>()
  return row?.state_value ?? null
}

function byKey(rows: MetricRow[], key: string): MetricRow {
  const row = rows.find((item) => item.key === key)
  if (!row) throw new Error(`missing metric row: ${key}`)
  return row
}

describe('aggregate metrics', () => {
  it('总览 PV 等于事件条数，会话与 UV 按散列去重，四粒度分组正确', async () => {
    const day = '2026-08-01'
    await insertEvent({ day_cn: day, route: 'draw', visitor_hash: 'a'.repeat(64), session_hash: 'a1'.repeat(32) })
    await insertEvent({ day_cn: day, route: 'draw', visitor_hash: 'a'.repeat(64), session_hash: 'a1'.repeat(32) })
    await insertEvent({ day_cn: day, route: 'ban', visitor_hash: 'b'.repeat(64), session_hash: 'b1'.repeat(32) })
    await insertEvent({ day_cn: day, route: 'settings', visitor_hash: 'c'.repeat(64), session_hash: 'c1'.repeat(32), device: 'mobile', source: 'GitHub' })

    const rows = await collectDayMetrics(env.DB, day, day)
    expect(rows).toHaveLength(8) // 总览 + 3 页面 + 2 设备 + 2 来源（直接访问/GitHub）：只输出有事件的维度值

    const overview = byKey(rows, `${day}|总览|全部`)
    expect(overview.pv).toBe(4)
    expect(overview.sessions).toBe(3)
    expect(overview.uv).toBe(3)

    expect(byKey(rows, `${day}|页面|draw`).pv).toBe(2)
    expect(byKey(rows, `${day}|页面|ban`).pv).toBe(1)
    expect(byKey(rows, `${day}|设备|desktop`).pv).toBe(3)
    expect(byKey(rows, `${day}|设备|mobile`).pv).toBe(1)
    expect(byKey(rows, `${day}|来源|直接访问`).pv).toBe(3)
    expect(byKey(rows, `${day}|来源|GitHub`).pv).toBe(1)
  })

  it('无事件日期返回空数组', async () => {
    expect(await collectDayMetrics(env.DB, '2026-01-01', '2026-01-01')).toEqual([])
  })

  it('rowToFields 输出飞书字段形状（日期为毫秒、状态与版本正确）', () => {
    const row: MetricRow = {
      key: '2026-08-01|总览|全部',
      date: '2026-08-01',
      dimension: '总览',
      value: '全部',
      pv: 27,
      sessions: 14,
      uv: 9,
      status: '已封账',
    }
    const fields = rowToFields(row, 1785680100000)
    expect(fields['唯一键']).toBe('2026-08-01|总览|全部')
    expect(fields['日期']).toBe(dayToEpochMs('2026-08-01'))
    expect(fields['统计维度']).toBe('总览')
    expect(fields['PV']).toBe(27)
    expect(fields['访问次数']).toBe(14)
    expect(fields['UV']).toBe(9)
    expect(fields['数据状态']).toBe('已封账')
    expect(fields['同步时间']).toBe(1785680100000)
    expect(fields['采集版本']).toBe(COLLECTION_VERSION)
  })

  it('抽卡聚合按总览 / 设备 / 来源分组，只统计有事件的维度值', async () => {
    const day = '2026-08-02'
    await insertDrawEvent({ day_cn: day, device: 'desktop', source: '直接访问' })
    await insertDrawEvent({ day_cn: day, device: 'desktop', source: 'GitHub' })
    await insertDrawEvent({ day_cn: day, device: 'mobile', source: 'GitHub' })

    const rows = await collectDayDrawMetrics(env.DB, day, day)
    expect(rows).toHaveLength(5) // 总览 + 2 设备 + 2 来源

    const overview = rows.find((row) => row.key === `${day}|总览|全部`)!
    expect(overview.draws).toBe(3)
    expect(overview.status).toBe('当日滚动')
    expect(rows.find((row) => row.key === `${day}|设备|desktop`)!.draws).toBe(2)
    expect(rows.find((row) => row.key === `${day}|设备|mobile`)!.draws).toBe(1)
    expect(rows.find((row) => row.key === `${day}|来源|直接访问`)!.draws).toBe(1)
    expect(rows.find((row) => row.key === `${day}|来源|GitHub`)!.draws).toBe(2)
  })

  it('无抽卡事件的日期返回空数组', async () => {
    expect(await collectDayDrawMetrics(env.DB, '2026-01-01', '2026-01-01')).toEqual([])
  })

  it('drawRowToFields 输出抽卡统计的飞书字段形状', () => {
    const row: DrawMetricRow = {
      key: '2026-08-02|总览|全部',
      date: '2026-08-02',
      dimension: '总览',
      value: '全部',
      draws: 42,
      status: '当日滚动',
    }
    const fields = drawRowToFields(row, 1785680100000)
    expect(fields['唯一键']).toBe('2026-08-02|总览|全部')
    expect(fields['日期']).toBe(dayToEpochMs('2026-08-02'))
    expect(fields['统计维度']).toBe('总览')
    expect(fields['抽卡次数']).toBe(42)
    expect(fields['数据状态']).toBe('当日滚动')
    expect(fields['同步时间']).toBe(1785680100000)
    expect(fields['采集版本']).toBe(COLLECTION_VERSION)
    expect(fields['PV']).toBeUndefined()
  })
})

describe('runAggregation', () => {
  it('创建记录：过去日期为已封账，写入 base_record_map，水位推进到今天', async () => {
    const day = addDays(dayCn(new Date(), TIME_ZONE), -2)
    await insertEvent({ day_cn: day })
    const fake = makeFakeFeishu()

    const result = await runAggregation(aggregateEnv(), fake.client)
    expect(result.status).toBe('done')
    expect(result.syncedDays).toEqual([day])

    const overview = fake.calls.create.find((item) => item.fields['唯一键'] === `${day}|总览|全部`)
    expect(overview).toBeDefined()
    expect(overview!.fields['数据状态']).toBe('已封账')
    expect(overview!.fields['PV']).toBe(1)
    expect(overview!.fields['访问次数']).toBe(1)
    expect(overview!.fields['UV']).toBe(1)
    expect(overview!.fields['日期']).toBe(dayToEpochMs(day))

    const mapCount = await env.DB.prepare('SELECT COUNT(*) AS count FROM base_record_map').first<{ count: number }>()
    expect(mapCount?.count).toBe(4) // 单事件日：总览 + 页面 + 设备 + 来源各 1 行

    expect(await watermark()).toBe(dayCn(new Date(), TIME_ZONE))
  })

  it('今日记录为当日滚动；同一唯一键重复同步只更新不新建', async () => {
    const today = dayCn(new Date(), TIME_ZONE)
    await insertEvent({ day_cn: today })
    const fake = makeFakeFeishu()

    await runAggregation(aggregateEnv(), fake.client)
    const firstCreateCount = fake.calls.create.length
    expect(firstCreateCount).toBe(4) // 单事件日：总览 + 页面 + 设备 + 来源各 1 行
    const overview = fake.calls.create.find((item) => item.fields['唯一键'] === `${today}|总览|全部`)
    expect(overview!.fields['数据状态']).toBe('当日滚动')

    await insertEvent({ day_cn: today, route: 'ban' })
    await runAggregation(aggregateEnv(), fake.client)
    // 水位已到今天仍会重算当日：新出现的维度值（ban 页面）新建，已有唯一键只更新不重复建
    expect(fake.calls.create.length).toBe(firstCreateCount + 1)
    expect(fake.calls.update.length).toBeGreaterThan(0)
    const updatedOverview = fake.calls.update.find((item) => item.key === `${today}|总览|全部`)
    expect(updatedOverview).toBeDefined()
    expect(updatedOverview!.fields['PV']).toBe(2)

    const mapCount = await env.DB.prepare('SELECT COUNT(*) AS count FROM base_record_map').first<{ count: number }>()
    expect(mapCount?.count).toBe(firstCreateCount + 1)
  })

  it('中断两天后按水位补回缺失日期', async () => {
    const today = dayCn(new Date(), TIME_ZONE)
    const oldDay = addDays(today, -2)
    await insertEvent({ day_cn: oldDay })
    await insertEvent({ day_cn: today, route: 'ban' })
    await env.DB.prepare(
      `INSERT INTO sync_state (state_key, state_value, updated_at) VALUES (?1, ?2, ?3)`,
    )
      .bind(WATERMARK_KEY, addDays(today, -3), new Date().toISOString())
      .run()

    const fake = makeFakeFeishu()
    const result = await runAggregation(aggregateEnv(), fake.client)
    expect(result.syncedDays).toContain(oldDay)
    expect(result.syncedDays).toContain(today)
    // 中间无事件日期不产生汇总行
    expect(fake.calls.create.some((item) => item.fields['唯一键'] === `${addDays(today, -1)}|总览|全部`)).toBe(false)
    expect(await watermark()).toBe(today)
  })

  it('水位已到今天且今日无新事件：不写飞书也不报错', async () => {
    const today = dayCn(new Date(), TIME_ZONE)
    await env.DB.prepare(
      `INSERT INTO sync_state (state_key, state_value, updated_at) VALUES (?1, ?2, ?3)`,
    )
      .bind(WATERMARK_KEY, today, new Date().toISOString())
      .run()
    const fake = makeFakeFeishu()
    const result = await runAggregation(aggregateEnv(), fake.client)
    expect(result.status).toBe('done')
    expect(result.syncedDays).toEqual([])
    expect(fake.calls.create).toHaveLength(0)
    expect(fake.calls.update).toHaveLength(0)
  })

  it('飞书结构/权限错误不推进水位，且锁被释放可再次运行', async () => {
    const day = addDays(dayCn(new Date(), TIME_ZONE), -1)
    await insertEvent({ day_cn: day })
    const failing = makeFakeFeishu(new FeishuError(1254045, 'field not found', false))

    await expect(runAggregation(aggregateEnv(), failing.client)).rejects.toThrow(FeishuError)
    expect(await watermark()).toBeNull()

    const fake = makeFakeFeishu()
    const result = await runAggregation(aggregateEnv(), fake.client)
    expect(result.status).toBe('done')
  })

  it('带过期时间的 D1 锁：持锁期间第二次获取失败，释放后可重获', async () => {
    expect(await acquireLock(env.DB)).toBe(true)
    expect(await acquireLock(env.DB)).toBe(false)
    await releaseLock(env.DB)
    expect(await acquireLock(env.DB)).toBe(true)
    await releaseLock(env.DB)
    const row = await env.DB.prepare('SELECT COUNT(*) AS count FROM sync_state WHERE state_key = ?1')
      .bind(LOCK_KEY)
      .first<{ count: number }>()
    expect(row?.count).toBe(0)
  })

  it('cleanup 只删除 90 天前事件与过期限流桶', async () => {
    const old = new Date(Date.now() - 91 * 24 * 3600 * 1000).toISOString()
    const recent = new Date(Date.now() - 89 * 24 * 3600 * 1000).toISOString()
    await insertEvent({ received_at: old })
    await insertEvent({ received_at: recent })
    await env.DB.prepare(
      `INSERT INTO rate_buckets (bucket_key, window_start, event_count) VALUES (?1, ?2, ?3)`,
    )
      .bind('stale-bucket', Date.now() - 2 * 24 * 3600 * 1000, 5)
      .run()
    await env.DB.prepare(
      `INSERT INTO rate_buckets (bucket_key, window_start, event_count) VALUES (?1, ?2, ?3)`,
    )
      .bind('fresh-bucket', Date.now() - 3600 * 1000, 5)
      .run()

    await cleanup(env.DB)

    const events = await env.DB.prepare('SELECT event_id FROM events').all<{ event_id: string }>()
    expect(events.results).toHaveLength(1)
    const buckets = await env.DB.prepare('SELECT bucket_key FROM rate_buckets').all<{ bucket_key: string }>()
    expect(buckets.results.map((row) => row.bucket_key).sort()).toEqual(['fresh-bucket'])
  })

  it('抽卡统计：创建过去日期行并写入 draw_record_map，水位独立推进', async () => {
    const day = addDays(dayCn(new Date(), TIME_ZONE), -2)
    await insertDrawEvent({ day_cn: day })
    await insertDrawEvent({ day_cn: day, device: 'mobile', source: 'GitHub' })
    const fake = makeFakeFeishu()

    const result = await runAggregation(aggregateEnv(), fake.client)
    expect(result.status).toBe('done')
    expect(result.drawSyncedDays).toEqual([day])
    expect(result.syncedDays).toEqual([])

    const overview = fake.calls.create.find((item) => item.fields['唯一键'] === `${day}|总览|全部`)
    expect(overview).toBeDefined()
    expect(overview!.fields['抽卡次数']).toBe(2)
    expect(overview!.fields['数据状态']).toBe('已封账')

    const drawMapCount = await env.DB.prepare('SELECT COUNT(*) AS count FROM draw_record_map').first<{ count: number }>()
    expect(drawMapCount?.count).toBe(5) // 总览 + 2 设备 + 2 来源
    const pageMapCount = await env.DB.prepare('SELECT COUNT(*) AS count FROM base_record_map').first<{ count: number }>()
    expect(pageMapCount?.count).toBe(0)

    expect(await drawWatermark()).toBe(dayCn(new Date(), TIME_ZONE))
    expect(await watermark()).toBeNull()
  })

  it('抽卡统计今日滚动行可重复更新；同一唯一键不重复创建', async () => {
    const today = dayCn(new Date(), TIME_ZONE)
    await insertDrawEvent({ day_cn: today })
    const fake = makeFakeFeishu()

    await runAggregation(aggregateEnv(), fake.client)
    const firstCreateCount = fake.calls.create.length
    expect(firstCreateCount).toBe(3) // 单事件日：总览 + 设备 + 来源各 1 行
    const overview = fake.calls.create.find((item) => item.fields['唯一键'] === `${today}|总览|全部`)
    expect(overview!.fields['数据状态']).toBe('当日滚动')

    await insertDrawEvent({ day_cn: today, device: 'desktop', source: '直接访问' })
    await runAggregation(aggregateEnv(), fake.client)
    expect(fake.calls.create.length).toBe(firstCreateCount)
    expect(fake.calls.update.length).toBeGreaterThan(0)
    const updatedOverview = fake.calls.update.find((item) => item.key === `${today}|总览|全部`)
    expect(updatedOverview).toBeDefined()
    expect(updatedOverview!.fields['抽卡次数']).toBe(2)
  })

  it('抽卡统计与访问统计互相独立：只插抽卡事件不影响访问统计水位', async () => {
    const today = dayCn(new Date(), TIME_ZONE)
    await insertDrawEvent({ day_cn: today })
    const fake = makeFakeFeishu()

    await runAggregation(aggregateEnv(), fake.client)
    expect(await drawWatermark()).toBe(today)
    expect(await watermark()).toBeNull()
  })
})
