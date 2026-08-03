import { applyD1Migrations, env } from 'cloudflare:test'
import type { D1Migration } from '@cloudflare/vitest-pool-workers'

// 在每个测试 worker 启动时应用 migrations/ 下的 SQL 迁移。
// TEST_MIGRATIONS 由 vitest.config.ts 注入（readD1Migrations 的返回值）。
const migrations = (env as unknown as { TEST_MIGRATIONS: D1Migration[] }).TEST_MIGRATIONS
await applyD1Migrations(env.DB, migrations)