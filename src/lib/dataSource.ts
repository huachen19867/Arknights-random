export function resolveOperatorsUrl(baseUrl: string): string {
  const normalizedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
  return `${normalizedBase}data/operators.json`
}

export function resolveSquadPortraitsUrl(baseUrl: string): string {
  const normalizedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
  return `${normalizedBase}data/squad-portraits.json`
}

export function resolveAssetUrl(baseUrl: string, assetUrl?: string): string | undefined {
  if (!assetUrl) return assetUrl
  if (/^[a-z][a-z\d+.-]*:/i.test(assetUrl) || assetUrl.startsWith('//')) return assetUrl
  const normalizedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
  return `${normalizedBase}${assetUrl.replace(/^\/+/, '')}`
}
