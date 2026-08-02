import {
  PROFESSIONS,
  RARITIES,
  type DrawResult,
  type DrawSettings,
  type Operator,
  type OperatorModule,
  type OperatorSkill,
  type Profession,
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

export function isOperatorModule(value: unknown): value is OperatorModule {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<OperatorModule>
  return (
    typeof candidate.id === 'string' &&
    candidate.id.trim().length > 0 &&
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
    const sourceModules = Array.isArray(record.modules) ? record.modules : undefined
    const modules = sourceModules?.filter(isOperatorModule)
    const normalizedRecord = { ...record }
    delete normalizedRecord.skills
    delete normalizedRecord.modules
    unique.set(record.id, {
      ...normalizedRecord,
      ...(sourceSkills?.length === 0 || (skills && skills.length > 0) ? { skills } : {}),
      ...(sourceModules?.length === 0 || (modules && modules.length > 0) ? { modules } : {}),
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

export function pickOperatorModule(
  operator: Operator,
  cryptoApi: Crypto = globalThis.crypto,
): OperatorModule | undefined {
  if (!operator.modules?.length) return undefined
  return operator.modules[secureRandomInt(operator.modules.length, cryptoApi)]
}

export function drawOperatorResults(
  candidates: Operator[],
  requestedCount: number,
  randomSkill: boolean,
  randomModule = false,
  cryptoApi: Crypto = globalThis.crypto,
): DrawResult[] {
  return drawOperators(candidates, requestedCount, cryptoApi).map((operator) => {
    const result: DrawResult = { operator }
    if (randomSkill) {
      if (operator.skills === undefined) {
        result.skillState = 'missing'
      } else if (operator.skills.length === 0) {
        result.skillState = 'unavailable'
      } else {
        result.skill = pickOperatorSkill(operator, cryptoApi)
        result.skillState = 'selected'
      }
    }
    if (randomModule) {
      if (operator.modules === undefined) {
        result.moduleState = 'missing'
      } else if (operator.modules.length === 0) {
        result.moduleState = 'unavailable'
      } else {
        result.module = pickOperatorModule(operator, cryptoApi)
        result.moduleState = 'selected'
      }
    }
    return result
  })
}
export interface ProfessionSlotShortage {
  profession: Profession
  /** 方案中该职业占用的名额数。 */
  needed: number
  /** 符合星级与 Ban 条件的候选数。 */
  available: number
  /** 无法满足的名额数。 */
  missing: number
}

export interface ProfessionSlotStats {
  /** 当前可满足的名额数。 */
  satisfiable: number
  /** 方案总名额数。 */
  total: number
  shortages: ProfessionSlotShortage[]
}

/** 自选职业模式候选池：只按启用、星级和 Ban 过滤，不使用普通职业范围。 */
export function filterOperatorsForPlan(operators: Operator[], settings: DrawSettings): Operator[] {
  const allowedRarities = new Set(settings.rarities)
  const bannedIds = new Set(settings.bannedIds)
  return operators.filter(
    (operator) =>
      operator.enabled !== false &&
      allowedRarities.has(operator.rarity) &&
      !bannedIds.has(operator.id),
  )
}

/** 按职业统计名额缺口；同一职业重复名额共享该职业候选池，因此各职业独立求和即可。 */
export function professionSlotStats(operators: Operator[], settings: DrawSettings): ProfessionSlotStats {
  const candidates = filterOperatorsForPlan(operators, settings)
  const availableByProfession = new Map<Profession, number>()
  for (const operator of candidates) {
    availableByProfession.set(operator.profession, (availableByProfession.get(operator.profession) ?? 0) + 1)
  }
  const neededByProfession = new Map<Profession, number>()
  for (const profession of settings.professionSlots) {
    neededByProfession.set(profession, (neededByProfession.get(profession) ?? 0) + 1)
  }
  let satisfiable = 0
  const shortages: ProfessionSlotShortage[] = []
  for (const [profession, needed] of neededByProfession) {
    const available = availableByProfession.get(profession) ?? 0
    satisfiable += Math.min(needed, available)
    if (available < needed) {
      shortages.push({ profession, needed, available, missing: needed - available })
    }
  }
  return { satisfiable, total: settings.professionSlots.length, shortages }
}

/**
 * 按职业名额精确抽取：每个槽位只从对应职业且本轮尚未使用的候选中安全随机一名；
 * 候选不足的槽位保留位置并标记 shortage，不用其他职业补位、不重复干员。
 * 随机技能/随机模组在抽取阶段写入本轮固定结果。
 */
export function drawOperatorResultsByProfessionSlots(
  operators: Operator[],
  settings: DrawSettings,
  cryptoApi: Crypto = globalThis.crypto,
): DrawResult[] {
  const candidates = filterOperatorsForPlan(operators, settings)
  const poolByProfession = new Map<Profession, Operator[]>()
  for (const operator of candidates) {
    const pool = poolByProfession.get(operator.profession) ?? []
    pool.push(operator)
    poolByProfession.set(operator.profession, pool)
  }

  const usedIds = new Set<string>()
  return settings.professionSlots.map((profession) => {
    const remaining = (poolByProfession.get(profession) ?? []).filter(
      (operator) => !usedIds.has(operator.id),
    )
    if (remaining.length === 0) {
      return { operator: undefined, expectedProfession: profession, shortage: true }
    }
    const operator = remaining[secureRandomInt(remaining.length, cryptoApi)]
    usedIds.add(operator.id)
    const result: DrawResult = { operator, expectedProfession: profession }
    if (settings.randomSkill) {
      if (operator.skills === undefined) {
        result.skillState = 'missing'
      } else if (operator.skills.length === 0) {
        result.skillState = 'unavailable'
      } else {
        result.skill = pickOperatorSkill(operator, cryptoApi)
        result.skillState = 'selected'
      }
    }
    if (settings.randomModule) {
      if (operator.modules === undefined) {
        result.moduleState = 'missing'
      } else if (operator.modules.length === 0) {
        result.moduleState = 'unavailable'
      } else {
        result.module = pickOperatorModule(operator, cryptoApi)
        result.moduleState = 'selected'
      }
    }
    return result
  })
}