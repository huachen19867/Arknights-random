import {
  PROFESSIONS,
  RARITIES,
  type DrawResult,
  type DrawSettings,
  type Operator,
  type OperatorSkill,
} from '../types'

export function isOperatorSkill(value: unknown): value is OperatorSkill {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<OperatorSkill>
  return (
    Number.isInteger(candidate.index) &&
    (candidate.index as number) > 0 &&
    typeof candidate.name === 'string' &&
    candidate.name.trim().length > 0
  )
}

export function isOperator(value: unknown): value is Operator {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<Operator>
  return (
    typeof candidate.id === 'string' &&
    candidate.id.length > 0 &&
    typeof candidate.name === 'string' &&
    candidate.name.length > 0 &&
    RARITIES.includes(candidate.rarity as (typeof RARITIES)[number]) &&
    PROFESSIONS.includes(candidate.profession as (typeof PROFESSIONS)[number]) &&
    (candidate.enabled === undefined || typeof candidate.enabled === 'boolean') &&
    (candidate.portrait === undefined || typeof candidate.portrait === 'string')
  )
}

export function normalizeOperatorPayload(payload: unknown): Operator[] {
  const records = Array.isArray(payload)
    ? payload
    : payload && typeof payload === 'object' && Array.isArray((payload as { operators?: unknown }).operators)
      ? (payload as { operators: unknown[] }).operators
      : []

  const unique = new Map<string, Operator>()
  for (const record of records) {
    if (!isOperator(record) || unique.has(record.id)) continue
    const sourceSkills = Array.isArray(record.skills) ? record.skills : undefined
    const skills = sourceSkills?.filter(isOperatorSkill)
    const normalizedRecord = { ...record }
    delete normalizedRecord.skills
    unique.set(record.id, {
      ...normalizedRecord,
      ...(sourceSkills?.length === 0 || (skills && skills.length > 0) ? { skills } : {}),
    })
  }
  return [...unique.values()]
}

export function filterOperators(operators: Operator[], settings: DrawSettings): Operator[] {
  const allowedRarities = new Set(settings.rarities)
  const allowedProfessions = new Set(settings.professions)
  const bannedIds = new Set(settings.bannedIds)

  return operators.filter(
    (operator) =>
      operator.enabled !== false &&
      allowedRarities.has(operator.rarity) &&
      allowedProfessions.has(operator.profession) &&
      !bannedIds.has(operator.id),
  )
}

export function secureRandomInt(maxExclusive: number, cryptoApi: Crypto = globalThis.crypto): number {
  if (!Number.isSafeInteger(maxExclusive) || maxExclusive <= 0) {
    throw new RangeError('maxExclusive 必须是大于 0 的安全整数')
  }
  if (!cryptoApi?.getRandomValues) {
    throw new Error('当前环境不支持安全随机数生成')
  }

  const range = 0x1_0000_0000
  const limit = range - (range % maxExclusive)
  const buffer = new Uint32Array(1)
  let value: number
  do {
    cryptoApi.getRandomValues(buffer)
    value = buffer[0]
  } while (value >= limit)
  return value % maxExclusive
}

export function fisherYates<T>(items: readonly T[], cryptoApi: Crypto = globalThis.crypto): T[] {
  const shuffled = [...items]
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = secureRandomInt(index + 1, cryptoApi)
    ;[shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]]
  }
  return shuffled
}

export function drawOperators(
  candidates: Operator[],
  requestedCount: number,
  cryptoApi: Crypto = globalThis.crypto,
): Operator[] {
  const count = Math.max(0, Math.min(Math.trunc(requestedCount), candidates.length))
  return fisherYates(candidates, cryptoApi).slice(0, count)
}

export function pickOperatorSkill(
  operator: Operator,
  cryptoApi: Crypto = globalThis.crypto,
): OperatorSkill | undefined {
  if (!operator.skills?.length) return undefined
  return operator.skills[secureRandomInt(operator.skills.length, cryptoApi)]
}

export function drawOperatorResults(
  candidates: Operator[],
  requestedCount: number,
  randomSkill: boolean,
  cryptoApi: Crypto = globalThis.crypto,
): DrawResult[] {
  return drawOperators(candidates, requestedCount, cryptoApi).map((operator) => {
    if (!randomSkill) return { operator }
    if (operator.skills === undefined) return { operator, skillState: 'missing' }
    if (operator.skills.length === 0) return { operator, skillState: 'unavailable' }
    return { operator, skill: pickOperatorSkill(operator, cryptoApi), skillState: 'selected' }
  })
}
