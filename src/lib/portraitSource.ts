/**
 * 主立绘失败后只允许切换一次本站备用图；备用图再失败便返回文字占位，
 * 避免两个坏地址之间无限重试。
 */
export function nextPortraitSource(
  failedSource: string | undefined,
  fallbackSource: string | undefined,
): string | undefined {
  if (!fallbackSource || failedSource === fallbackSource) return undefined
  return fallbackSource
}
