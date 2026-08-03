/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 生产匿名统计采集端点（公开 URL，非密钥）；在 GitHub 仓库 Variables 中配置。 */
  readonly VITE_ANALYTICS_ENDPOINT?: string
}
