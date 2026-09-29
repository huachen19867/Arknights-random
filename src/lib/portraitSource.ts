/**
 * 按优先级尝试后续图源；图源列表包含当前失败项时只返回它后面的候选，
 * 因此不会在损坏的上身图、主立绘和本地备用图之间来回循环。
 */
export function nextPortraitSource(
  failedSource: string | undefined,
  fallbackSources: string | undefined | readonly (string | undefined)[],
): string | undefined {
  if (!failedSource) return undefined
  const candidates = Array.isArray(fallbackSources) ? fallbackSources : [fallbackSources]
  const failedIndex = candidates.indexOf(failedSource)
  const laterCandidates = failedIndex >= 0 ? candidates.slice(failedIndex + 1) : candidates
  return laterCandidates.find((source): source is string => Boolean(source) && source !== failedSource)
}
