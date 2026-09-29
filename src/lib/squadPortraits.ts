import { resolveAssetUrl } from './dataSource'

export type SquadPortraitMap = Record<string, string>

/**
 * The manifest is optional presentation data. Invalid or unsupported payloads return an empty
 * map so the operator library can continue using its existing portrait and local fallback.
 */
export function normalizeSquadPortraitPayload(
  payload: unknown,
  baseUrl: string,
): SquadPortraitMap {
  if (!payload || typeof payload !== 'object') return {}
  const candidate = payload as { schemaVersion?: unknown; portraits?: unknown }
  if (candidate.schemaVersion !== 1 || !candidate.portraits || typeof candidate.portraits !== 'object') {
    return {}
  }

  const portraits: SquadPortraitMap = {}
  for (const [id, path] of Object.entries(candidate.portraits)) {
    if (!id.trim() || typeof path !== 'string' || !path.trim()) continue
    const resolved = resolveAssetUrl(baseUrl, path.trim())
    if (resolved) portraits[id] = resolved
  }
  return portraits
}
