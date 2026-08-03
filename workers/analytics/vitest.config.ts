import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Worker 单元测试：使用真实 D1（miniflare 内存库）与 wrangler.jsonc 绑定。
// 本地运行前需按 .dev.vars.example 创建 workers/analytics/.dev.vars（测试用变量）。
// D1 表结构由 migrations/ 下的 SQL 迁移文件建立：配置启动时读取迁移，
// 通过 TEST_MIGRATIONS 绑定注入，由 tests/apply-migrations.ts 在每个测试 worker 中应用。
const workerDir = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig(async () => {
  const migrations = await readD1Migrations(
    fileURLToPath(new URL('./migrations', import.meta.url)),
  )
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: { bindings: { TEST_MIGRATIONS: migrations } },
      }),
    ],
    test: {
      root: workerDir,
      include: ['tests/**/*.test.ts'],
      setupFiles: ['tests/apply-migrations.ts'],
    },
  }
})