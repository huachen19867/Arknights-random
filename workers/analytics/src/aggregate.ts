/**
 * 定时聚合：每 15 分钟把 D1 匿名事件聚合成日汇总，串行写入飞书“访问统计”表。
 * 以 sync_state 水位为起点补算缺失日期；失败不推进水位，下次 Cron 自动补偿。
 */

import { dayCn } from './collect'
import { createFeishuClient, type FeishuClient, type FeishuFields } from './feishu'

export const COLLECTION_VERSION = 'v1'
export const MAX_BACKFILL_DAYS = 31
export const RETENTION_DAYS = 90
export const LOCK_KEY = 'cron_lock'
export const WATERMARK_KEY = 'last_synced_day'
export const LOCK_TTL_SECONDS = 600
export const BATCH_LIMIT = 100

export type Dimension = '总览' | '页面' | '设备' | '来源'
export type DataStatus = '当日滚动' | '已封账'

export interface MetricRow {
  key: string
  date: string
  dimension: Dimension
  value: string
  pv: number
  sessions: number
  uv: number
  status: DataStatus
}

export interface AggregationResult {
  status: 'locked' | 'up-to-date' | 'empty' | 'done'
  syncedDays: string[]
  created: number
  updated: number
}

interface AnalyticsEnvLike {
  DB: D1Database
  TIME_ZONE: string
}

/** 加 YYYY-MM-DD 天数的纯日期计算（UTC 数学，仅用于日字符串，不涉及时区）。 */
export function addDays(day: string, delta: number): string {
  const [year, month, date] = day.split('-').map(Number)
  const next = new Date(Date.UTC(year, month - 1, date + delta))
  return next.toISOString().slice(0, 10)
}

/** 上海时区某日 00:00 对应的 Unix 毫秒（飞书 datetime CellValue 需要）。 */
export function dayToEpochMs(day: string): number {
  return Date.parse(`${day}T00:00:00+08:00`)
}

/** 带过期时间的 D1 锁：10 分钟内只有持锁实例能运行聚合，避免重复写同一张飞书表。 */
export async function acquireLock(db: D1Database): Promise<boolean> {
  const now = new Date().toISOString()
  const result = await db
    .prepare(
      `INSERT INTO sync_state (state_key, state_value, updated_at)
       VALUES (?1, ?2, ?3)
       ON CONFLICT(state_key) DO UPDATE
         SET state_value = ?2, updated_at = ?3
         WHERE unixepoch(sync_state.updated_at) < unixepoch(?3) - ?4`,
    )
    .bind(LOCK_KEY, '1', now, LOCK_TTL_SECONDS)
    .run()
  return result.meta.changes > 0
}

export async function releaseLock(db: D1Database): Promise<void> {
  await db.prepare('DELETE FROM sync_state WHERE state_key = ?1').bind(LOCK_KEY).run()
}

async function readWatermark(db: D1Database): Promise<string | null> {
  const row = await db
    .prepare('SELECT state_value FROM sync_state WHERE state_key = ?1')
    .bind(WATERMARK_KEY)
    .first<{ state_value: string }>()
  return row?.state_value ?? null
}

async function writeWatermark(db: D1Database, day: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO sync_state (state_key, state_value, updated_at)
       VALUES (?1, ?2, ?3)
       ON CONFLICT(state_key) DO UPDATE SET state_value = ?2, updated_at = ?3`,
    )
    .bind(WATERMARK_KEY, day, new Date().toISOString())
    .run()
}

async function firstEventDay(db: D1Database): Promise<string | null> {
  const row = await db.prepare('SELECT MIN(day_cn) AS day FROM events').first<{ day: string | null }>()
  return row?.day ?? null
}

interface Aggregated {
  pv: number
  sessions: number
  uv: number
}

function makeRow(day: string, dimension: Dimension, value: string, agg: Aggregated, today: string): MetricRow {
  return {
    key: `${day}|${dimension}|${value}`,
    date: day,
    dimension,
    value,
    pv: agg.pv,
    sessions: agg.sessions,
    uv: agg.uv,
    status: day === today ? '当日滚动' : '已封账',
  }
}

/** 汇总某一天的总览 / 页面 / 设备 / 来源四个粒度；当天无事件返回空数组。 */
export async function collectDayMetrics(db: D1Database, day: string, today: string): Promise<MetricRow[]> {
  const overview = await db
    .prepare(
      `SELECT COUNT(*) AS pv,
              COUNT(DISTINCT session_hash) AS sessions,
              COUNT(DISTINCT visitor_hash) AS uv
       FROM events WHERE day_cn = ?1`,
    )
    .bind(day)
    .first<Aggregated>()
  if (!overview || overview.pv === 0) return []

  const rows: MetricRow[] = [makeRow(day, '总览', '全部', overview, today)]
  const groups: Array<[StoredEventColumn, Dimension]> = [
    ['route', '页面'],
    ['device', '设备'],
    ['source', '来源'],
  ]
  for (const [column, dimension] of groups) {
    const result = await db
      .prepare(
        `SELECT ${column} AS value,
                COUNT(*) AS pv,
                COUNT(DISTINCT session_hash) AS sessions,
                COUNT(DISTINCT visitor_hash) AS uv
         FROM events WHERE day_cn = ?1 GROUP BY ${column} ORDER BY value`,
      )
      .bind(day)
      .all<{ value: string } & Aggregated>()
    for (const row of result.results) {
      rows.push(makeRow(day, dimension, row.value, row, today))
    }
  }
  return rows
}

type StoredEventColumn = 'route' | 'device' | 'source'

export function rowToFields(row: MetricRow, nowMs: number): FeishuFields {
  return {
    '唯一键': row.key,
    '日期': dayToEpochMs(row.date),
    '统计维度': row.dimension,
    '维度值': row.value,
    'PV': row.pv,
    '访问次数': row.sessions,
    'UV': row.uv,
    '数据状态': row.status,
    '同步时间': nowMs,
    '采集版本': COLLECTION_VERSION,
  }
}

export async function persistRecordMap(
  db: D1Database,
  entries: Array<{ key: string; recordId: string }>,
): Promise<void> {
  if (entries.length === 0) return
  const now = new Date().toISOString()
  await db.batch(
    entries.map((entry) =>
      db
        .prepare(
          `INSERT OR REPLACE INTO base_record_map (metric_key, record_id, updated_at)
           VALUES (?1, ?2, ?3)`,
        )
        .bind(entry.key, entry.recordId, now),
    ),
  )
}

async function loadRecordMap(db: D1Database): Promise<Map<string, string>> {
  const result = await db.prepare('SELECT metric_key, record_id FROM base_record_map').all<{
    metric_key: string
    record_id: string
  }>()
  return new Map(result.results.map((row) => [row.metric_key, row.record_id]))
}

/** 按唯一键拆分创建 / 更新，串行批量（100 条/批）；每批创建成功后立即持久化 record 映射。 */
export async function syncMetricsToFeishu(
  db: D1Database,
  client: FeishuClient,
  rows: MetricRow[],
  existing: Map<string, string>,
  nowMs: number,
): Promise<{ created: number; updated: number }> {
  const toCreate = rows.filter((row) => !existing.has(row.key))
  const toUpdate = rows.filter((row) => existing.has(row.key))
  let created = 0
  let updated = 0

  for (let offset = 0; offset < toCreate.length; offset += BATCH_LIMIT) {
    const batch = toCreate.slice(offset, offset + BATCH_LIMIT)
    const createdRecords = await client.createRecords(
      batch.map((row) => ({ key: row.key, fields: rowToFields(row, nowMs) })),
    )
    await persistRecordMap(db, createdRecords)
    created += createdRecords.length
  }

  for (let offset = 0; offset < toUpdate.length; offset += BATCH_LIMIT) {
    const batch = toUpdate.slice(offset, offset + BATCH_LIMIT)
    await client.updateRecords(
      batch.map((row) => ({
        recordId: existing.get(row.key)!,
        key: row.key,
        fields: rowToFields(row, nowMs),
      })),
    )
    updated += batch.length
  }

  return { created, updated }
}

/** 清理 90 天前匿名事件与过期限流桶；飞书日汇总长期保留，不在此删除。 */
export async function cleanup(db: D1Database): Promise<void> {
  await db
    .prepare(
      `DELETE FROM events
       WHERE received_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?1)`,
    )
    .bind(`-${RETENTION_DAYS} days`)
    .run()
  await db
    .prepare('DELETE FROM rate_buckets WHERE window_start < ?1')
    .bind(Date.now() - 24 * 60 * 60 * 1000)
    .run()
}

export async function runAggregation(
  env: AnalyticsEnvLike & {
    FEISHU_BASE_TOKEN: string
    FEISHU_STATS_TABLE_ID: string
    FEISHU_APP_ID: string
    FEISHU_APP_SECRET: string
  },
  feishuOverride?: FeishuClient,
): Promise<AggregationResult> {
  const db = env.DB
  if (!(await acquireLock(db))) {
    return { status: 'locked', syncedDays: [], created: 0, updated: 0 }
  }
  try {
    const timeZone = env.TIME_ZONE || 'Asia/Shanghai'
    const today = dayCn(new Date(), timeZone)
    const watermark = await readWatermark(db)
    const earliest = await firstEventDay(db)

    if (watermark === null && earliest === null) {
      await cleanup(db)
      return { status: 'empty', syncedDays: [], created: 0, updated: 0 }
    }

    // 水位已到今天时仍要重算今天：当日滚动行每 15 分钟随新事件更新。
    // 水位落后时从水位次日补算，但至少覆盖昨天，让昨日行从“当日滚动”翻为“已封账”。
    let start: string
    if (watermark === null) {
      start = earliest!
    } else if (watermark === today) {
      start = today
    } else {
      start = addDays(watermark, 1)
      const yesterday = addDays(today, -1)
      if (start > yesterday) start = yesterday
    }
    // 单次最多补算 31 天，防止异常任务无限运行。
    const minStart = addDays(today, -(MAX_BACKFILL_DAYS - 1))
    if (start < minStart) start = minStart
    if (start > today) {
      await cleanup(db)
      return { status: 'up-to-date', syncedDays: [], created: 0, updated: 0 }
    }

    const client = feishuOverride ?? createFeishuClient(env)
    const existing = await loadRecordMap(db)
    const syncedDays: string[] = []
    let created = 0
    let updated = 0
    let hasAny = false

    for (let day = start; day <= today; day = addDays(day, 1)) {
      const rows = await collectDayMetrics(db, day, today)
      if (rows.length === 0) continue
      const result = await syncMetricsToFeishu(db, client, rows, existing, Date.now())
      syncedDays.push(day)
      created += result.created
      updated += result.updated
      hasAny = true
    }

    if (hasAny) {
      await writeWatermark(db, today)
    }
    await cleanup(db)
    return { status: 'done', syncedDays, created, updated }
  } finally {
    await releaseLock(db)
  }
}