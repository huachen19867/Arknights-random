/**
 * arknights-analytics Worker 入口。
 * 公开采集端点：POST /v1/page-view（匿名 page_view）、POST /v1/draw（匿名抽卡动作），
 * 服务端校验 / 去重 / 限流 / 分类。
 * 定时任务：Cron 每 15 分钟聚合 D1 事件并串行写入飞书“访问统计”与“抽卡次数统计”表。
 */

import { runAggregation } from './aggregate'
import { handleCollect, handleDrawCollect } from './collect'

export interface AnalyticsEnv {
  DB: D1Database
  /** 允许的浏览器 Origin，逗号分隔；生产固定为 https://huachen19867.github.io */
  ALLOWED_ORIGIN: string
  /** 归日时区，固定 Asia/Shanghai */
  TIME_ZONE: string
  /** 飞书现有 Arknights Base token（资源 ID，非密钥） */
  FEISHU_BASE_TOKEN: string
  /** 飞书“访问统计”表 ID（资源 ID，非密钥） */
  FEISHU_STATS_TABLE_ID: string
  /** 飞书“抽卡次数统计”表 ID（资源 ID，非密钥） */
  FEISHU_DRAW_TABLE_ID: string
  /** 以下三项必须通过 wrangler secret 注入，禁止进入仓库 */
  FEISHU_APP_ID: string
  FEISHU_APP_SECRET: string
  ANALYTICS_HASH_SALT: string
}

export default {
  async fetch(request: Request, env: AnalyticsEnv): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === '/v1/page-view') {
      return handleCollect(request, env)
    }
    if (url.pathname === '/v1/draw') {
      return handleDrawCollect(request, env)
    }
    return new Response('not found', { status: 404, headers: { 'Cache-Control': 'no-store' } })
  },

  async scheduled(_controller: ScheduledController, env: AnalyticsEnv, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      runAggregation(env).catch((error: unknown) => {
        // 失败不推进水位；日志只输出错误信息，不包含任何密钥或原始 IP。
        console.error('analytics aggregation failed', error instanceof Error ? error.message : String(error))
      }),
    )
  },
}
