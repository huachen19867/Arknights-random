/**
 * 飞书 Bitable v1 批量写入：只在 Cron 聚合时使用，绝不在页面访问请求路径调用。
 * tenant access token 只在单次 scheduled 执行的内存中使用，不写 D1、不落日志。
 */

export interface FeishuFields {
  [name: string]: string | number
}

export interface FeishuCreateItem {
  key: string
  fields: FeishuFields
}

export interface FeishuUpdateItem {
  recordId: string
  key: string
  fields: FeishuFields
}

export interface FeishuCreatedRecord {
  key: string
  recordId: string
}

export interface FeishuClient {
  createRecords(items: FeishuCreateItem[]): Promise<FeishuCreatedRecord[]>
  updateRecords(items: FeishuUpdateItem[]): Promise<void>
}

const FEISHU_API_BASE = 'https://open.feishu.cn/open-apis'
const BATCH_LIMIT = 100
const MAX_ATTEMPTS = 3

export class FeishuError extends Error {
  constructor(
    public readonly code: number,
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message)
    this.name = 'FeishuError'
  }
}

interface AnalyticsEnvLike {
  FEISHU_BASE_TOKEN: string
  FEISHU_STATS_TABLE_ID: string
  FEISHU_APP_ID: string
  FEISHU_APP_SECRET: string
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export function createFeishuClient(env: AnalyticsEnvLike): FeishuClient {
  let tokenPromise: Promise<string> | null = null

  async function tenantAccessToken(): Promise<string> {
    if (tokenPromise === null) {
      tokenPromise = (async () => {
        const response = await fetch(`${FEISHU_API_BASE}/auth/v3/tenant_access_token/internal/`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
          body: JSON.stringify({ app_id: env.FEISHU_APP_ID, app_secret: env.FEISHU_APP_SECRET }),
        })
        const data = (await response.json().catch(() => ({}))) as {
          code?: number
          msg?: string
          tenant_access_token?: string
        }
        if (!response.ok || data.code !== 0 || typeof data.tenant_access_token !== 'string') {
          throw new FeishuError(
            data.code ?? response.status,
            data.msg ?? 'failed to get tenant access token',
            response.status >= 500,
          )
        }
        return data.tenant_access_token
      })()
    }
    return tokenPromise
  }

  async function request(path: string, body: unknown): Promise<unknown> {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      const token = await tenantAccessToken()
      const response = await fetch(`${FEISHU_API_BASE}${path}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json; charset=utf-8',
        },
        body: JSON.stringify(body),
      })
      const data = (await response.json().catch(() => ({}))) as { code?: number; msg?: string }
      if (response.ok && (data.code === undefined || data.code === 0)) {
        return data
      }
      const code = data.code ?? response.status
      // 1254291 同表写冲突：串行 + 指数退避重试；5xx 视为临时故障重试。
      // 结构 / 权限错误（1254045、91403、403 等）立即中止本轮，不盲目重试。
      const retryable = code === 1254291 || response.status >= 500
      if (retryable && attempt < MAX_ATTEMPTS - 1) {
        await sleep(1000 * 2 ** attempt)
        tokenPromise = null
        continue
      }
      throw new FeishuError(code, data.msg ?? `feishu request failed (${response.status})`, retryable)
    }
    throw new FeishuError(-1, 'unreachable', true)
  }

  return {
    async createRecords(items) {
      const created: FeishuCreatedRecord[] = []
      for (let offset = 0; offset < items.length; offset += BATCH_LIMIT) {
        const batch = items.slice(offset, offset + BATCH_LIMIT)
        const data = (await request(
          `/bitable/v1/apps/${env.FEISHU_BASE_TOKEN}/tables/${env.FEISHU_STATS_TABLE_ID}/records/batch_create`,
          { records: batch.map((item) => ({ fields: item.fields })) },
        )) as { data?: { records?: Array<{ record_id?: string; fields?: Record<string, unknown> }> } }
        const records = data?.data?.records ?? []
        // 飞书按请求顺序返回记录；同时用唯一键兜底对齐，避免顺序假设失败时映射错位。
        const keyByUniqueKey = new Map<string, string>()
        for (const item of batch) {
          const uniqueKey = item.fields['唯一键']
          if (typeof uniqueKey === 'string') keyByUniqueKey.set(uniqueKey, item.key)
        }
        for (const record of records) {
          const uniqueKey = record.fields?.['唯一键']
          const key =
            typeof uniqueKey === 'string' && keyByUniqueKey.has(uniqueKey)
              ? keyByUniqueKey.get(uniqueKey)!
              : ''
          if (key && typeof record.record_id === 'string' && record.record_id.length > 0) {
            created.push({ key, recordId: record.record_id })
          }
        }
      }
      return created
    },

    async updateRecords(items) {
      for (let offset = 0; offset < items.length; offset += BATCH_LIMIT) {
        const batch = items.slice(offset, offset + BATCH_LIMIT)
        await request(
          `/bitable/v1/apps/${env.FEISHU_BASE_TOKEN}/tables/${env.FEISHU_STATS_TABLE_ID}/records/batch_update`,
          { records: batch.map((item) => ({ record_id: item.recordId, fields: item.fields })) },
        )
      }
    },
  }
}