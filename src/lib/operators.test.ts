import { describe, expect, it } from 'vitest'
import type { DrawSettings, Operator } from '../types'
import {
  drawOperatorResults,
  drawOperatorResultsByProfessionSlots,
  drawOperators,
  filterOperators,
  filterOperatorsForPlan,
  normalizeOperatorPayload,
  professionSlotStats,
  secureRandomInt,
} from './operators'

const operators: Operator[] = [
  { id: 'a', name: '甲', rarity: 6, profession: '近卫' },
  { id: 'b', name: '乙', rarity: 6, profession: '狙击' },
  { id: 'c', name: '丙', rarity: 5, profession: '近卫' },
  { id: 'd', name: '丁', rarity: 4, profession: '医疗' },
  { id: 'e', name: '戊', rarity: 5, profession: '近卫', enabled: false },
]

function settings(overrides: Partial<DrawSettings> = {}): DrawSettings {
  return {
    rarities: [1, 2, 3, 4, 5, 6],
    professions: ['先锋', '近卫', '重装', '狙击', '术师', '医疗', '辅助', '特种'],
    count: 12,
    bannedIds: [],
    randomSkill: false,
    randomModule: false,
    drawMode: 'range',
    professionSlots: [],
    ...overrides,
  }
}

describe('normalizeOperatorPayload', () => {
  it('支持数组和 operators 包装格式，并过滤无效项与重复 id', () => {
    const payload = {
      operators: [operators[0], operators[0], { id: '', name: '坏数据', rarity: 9, profession: '未知' }],
    }
    expect(normalizeOperatorPayload(payload)).toEqual([operators[0]])
    expect(normalizeOperatorPayload(operators)).toHaveLength(5)
  })

  it('兼容旧快照缺失 skills，并保留显式空数组的语义', () => {
    const payload = [
      { ...operators[0], skills: [{ index: 1, name: '一技能' }, { index: 0, name: '无效技能' }] },
      { ...operators[1], skills: [] },
      operators[2],
    ]
    const normalized = normalizeOperatorPayload(payload)
    expect(normalized[0].skills).toEqual([{ index: 1, name: '一技能' }])
    expect(normalized[1].skills).toEqual([])
    expect(Object.hasOwn(normalized[2], 'skills')).toBe(false)
  })

  it('透传 modules 并保留空数组与缺失两种语义', () => {
    const payload = [
      {
        ...operators[0],
        modules: [{ id: 'a:AFT-X', index: 1, name: '模组一', code: 'AFT-X' }, { id: 'bad', index: 0, name: '' }],
      },
      { ...operators[1], modules: [] },
      operators[2],
    ]
    const normalized = normalizeOperatorPayload(payload)
    expect(normalized[0].modules).toEqual([{ id: 'a:AFT-X', index: 1, name: '模组一', code: 'AFT-X' }])
    expect(normalized[1].modules).toEqual([])
    expect(Object.hasOwn(normalized[2], 'modules')).toBe(false)
  })
})

describe('filterOperators', () => {
  it('对星级、职业与 Ban 名单取交集', () => {
    const result = filterOperators(
      operators,
      settings({ rarities: [5, 6], professions: ['近卫'], bannedIds: ['a'] }),
    )
    expect(result.map((item) => item.id)).toEqual(['c'])
  })

  it('防御性排除快照中显式未启用的记录', () => {
    const result = filterOperators(operators, settings({ rarities: [5], professions: ['近卫'] }))
    expect(result.map((item) => item.id)).toEqual(['c'])
  })

  it('空选择得到空候选池', () => {
    expect(filterOperators(operators, settings({ rarities: [] }))).toEqual([])
  })
})

describe('filterOperatorsForPlan', () => {
  it('忽略普通职业范围，只按启用、星级与 Ban 过滤', () => {
    const result = filterOperatorsForPlan(
      operators,
      settings({ rarities: [5, 6], professions: ['医疗'], bannedIds: ['a'] }),
    )
    expect(result.map((item) => item.id)).toEqual(['b', 'c'])
  })

  it('防御性排除未启用记录', () => {
    const result = filterOperatorsForPlan(operators, settings({ rarities: [5] }))
    expect(result.map((item) => item.id)).toEqual(['c'])
  })
})

describe('professionSlotStats', () => {
  it('统计可满足名额与按职业缺口', () => {
    const stats = professionSlotStats(
      operators,
      settings({ drawMode: 'profession-plan', professionSlots: ['近卫', '近卫', '医疗', '狙击', '狙击', '狙击'] }),
    )
    expect(stats.total).toBe(6)
    expect(stats.satisfiable).toBe(4)
    expect(stats.shortages).toEqual([{ profession: '狙击', needed: 3, available: 1, missing: 2 }])
  })

  it('空方案总名额为零且无缺口', () => {
    const stats = professionSlotStats(operators, settings({ drawMode: 'profession-plan', professionSlots: [] }))
    expect(stats.total).toBe(0)
    expect(stats.satisfiable).toBe(0)
    expect(stats.shortages).toEqual([])
  })
})

describe('drawOperatorResultsByProfessionSlots', () => {
  it('按槽位顺序精确抽取：1 先锋 + 2 个不重复近卫 + 1 医疗', () => {
    const planOperators: Operator[] = [
      { id: 'v1', name: '先锋甲', rarity: 6, profession: '先锋' },
      { id: 'v2', name: '先锋乙', rarity: 5, profession: '先锋' },
      { id: 'g1', name: '近卫甲', rarity: 6, profession: '近卫' },
      { id: 'g2', name: '近卫乙', rarity: 5, profession: '近卫' },
      { id: 'g3', name: '近卫丙', rarity: 4, profession: '近卫' },
      { id: 'm1', name: '医疗甲', rarity: 6, profession: '医疗' },
      { id: 's1', name: '狙击甲', rarity: 6, profession: '狙击' },
    ]
    const planSettings = settings({
      drawMode: 'profession-plan',
      professionSlots: ['先锋', '近卫', '近卫', '医疗'],
      randomSkill: false,
      randomModule: false,
    })
    const results = drawOperatorResultsByProfessionSlots(planOperators, planSettings)
    expect(results).toHaveLength(4)
    expect(results.map((result) => result.expectedProfession)).toEqual(['先锋', '近卫', '近卫', '医疗'])
    expect(results[0].operator?.profession).toBe('先锋')
    expect(results[1].operator?.profession).toBe('近卫')
    expect(results[2].operator?.profession).toBe('近卫')
    expect(results[1].operator?.id).not.toBe(results[2].operator?.id)
    expect(results[3].operator?.profession).toBe('医疗')
    expect(results.every((result) => !result.shortage)).toBe(true)
  })

  it('候选不足时槽位保留位置并标记 shortage，不用其他职业补位、不重复干员', () => {
    const planSettings = settings({
      drawMode: 'profession-plan',
      professionSlots: ['近卫', '近卫', '近卫', '医疗'],
      rarities: [4, 5, 6],
    })
    const results = drawOperatorResultsByProfessionSlots(operators, planSettings)
    expect(results).toHaveLength(4)
    expect(results.map((result) => result.expectedProfession)).toEqual(['近卫', '近卫', '近卫', '医疗'])
    const picked = results.filter((result) => result.operator).map((result) => result.operator?.id)
    expect(new Set(picked).size).toBe(picked.length)
    expect(results.filter((result) => result.shortage)).toHaveLength(1)
    expect(results[2]).toMatchObject({ shortage: true, operator: undefined, expectedProfession: '近卫' })
    expect(results[3].operator?.profession).toBe('医疗')
  })

  it('遵守星级与 Ban 名单：被 Ban 的近卫不再可选', () => {
    const planSettings = settings({
      drawMode: 'profession-plan',
      professionSlots: ['近卫'],
      rarities: [5, 6],
      bannedIds: ['a'],
    })
    const results = drawOperatorResultsByProfessionSlots(operators, planSettings)
    expect(results[0].operator?.id).toBe('c')
  })

  it('星级过滤后职业候选不足时返回空缺槽', () => {
    const planSettings = settings({
      drawMode: 'profession-plan',
      professionSlots: ['近卫'],
      rarities: [6],
      bannedIds: ['a'],
    })
    const results = drawOperatorResultsByProfessionSlots(operators, planSettings)
    expect(results[0]).toMatchObject({ shortage: true, operator: undefined, expectedProfession: '近卫' })
  })

  it('随机技能与随机模组在抽取阶段写入本轮固定结果', () => {
    const planOperators: Operator[] = [
      {
        ...operators[0],
        skills: [
          { index: 1, name: '一技能' },
          { index: 2, name: '二技能' },
        ],
        modules: [
          { id: 'a:AFT-X', index: 1, name: '模组甲', code: 'AFT-X' },
          { id: 'a:AFT-Y', index: 2, name: '模组乙', code: 'AFT-Y' },
        ],
      },
      { ...operators[1], skills: [], modules: [] },
      operators[2],
    ]
    const values = [0, 0, 1]
    let cursor = 0
    const cryptoApi = {
      getRandomValues(array: Uint32Array) {
        array[0] = values[cursor++] ?? 0
        return array
      },
    } as unknown as Crypto
    const planSettings = settings({
      drawMode: 'profession-plan',
      professionSlots: ['近卫', '狙击'],
      randomSkill: true,
      randomModule: true,
    })
    const results = drawOperatorResultsByProfessionSlots(planOperators, planSettings, cryptoApi)
    expect(results[0].skillState).toBe('selected')
    expect(results[0].skill).toEqual({ index: 1, name: '一技能' })
    expect(results[0].moduleState).toBe('selected')
    expect(results[0].module).toEqual({ id: 'a:AFT-Y', index: 2, name: '模组乙', code: 'AFT-Y' })
    expect(results[1].skillState).toBe('unavailable')
    expect(results[1].moduleState).toBe('unavailable')
  })

  it('空方案返回空结果', () => {
    const results = drawOperatorResultsByProfessionSlots(
      operators,
      settings({ drawMode: 'profession-plan', professionSlots: [] }),
    )
    expect(results).toEqual([])
  })
})

describe('secure draw', () => {
  it('抽取结果不重复且不会超过候选池', () => {
    const result = drawOperators(operators, 12)
    expect(result).toHaveLength(operators.length)
    expect(new Set(result.map((item) => item.id)).size).toBe(result.length)
    expect(result.every((item) => operators.includes(item))).toBe(true)
  })

  it('非法上限会被拒绝', () => {
    expect(() => secureRandomInt(0)).toThrow(RangeError)
  })

  it('安全随机 API 不可用时给出明确错误', () => {
    expect(() => secureRandomInt(3, {} as Crypto)).toThrow('当前环境不支持安全随机数生成')
  })

  it('开启随机技能时在抽取阶段写入稳定结果，并区分无技能与未收录', () => {
    const skillCandidates: Operator[] = [
      {
        ...operators[0],
        skills: [
          { index: 1, name: '一技能' },
          { index: 2, name: '二技能' },
        ],
      },
      { ...operators[1], skills: [] },
      operators[2],
    ]
    const values = [0, 0, 1]
    let cursor = 0
    const cryptoApi = {
      getRandomValues(array: Uint32Array) {
        array[0] = values[cursor++] ?? 0
        return array
      },
    } as unknown as Crypto

    const results = drawOperatorResults(skillCandidates, 3, true, false, cryptoApi)
    expect(results.map((result) => result.skillState)).toEqual(['unavailable', 'missing', 'selected'])
    expect(results[2].skill).toEqual({ index: 2, name: '二技能' })
    expect(results[2].skill?.name).toBe('二技能')
  })

  it('关闭随机技能时不生成技能结果', () => {
    const results = drawOperatorResults(operators.slice(0, 2), 2, false)
    expect(results.every((result) => result.skill === undefined && result.skillState === undefined)).toBe(true)
  })

  it('开启随机模组时在抽取阶段写入稳定结果，并区分无模组与未收录', () => {
    const moduleCandidates: Operator[] = [
      {
        ...operators[0],
        modules: [
          { id: 'a:AFT-X', index: 1, name: '模组甲', code: 'AFT-X' },
          { id: 'a:AFT-Y', index: 2, name: '模组乙', code: 'AFT-Y' },
        ],
      },
      { ...operators[1], modules: [] },
      operators[2],
    ]
    const values = [0, 0, 1]
    let cursor = 0
    const cryptoApi = {
      getRandomValues(array: Uint32Array) {
        array[0] = values[cursor++] ?? 0
        return array
      },
    } as unknown as Crypto

    const results = drawOperatorResults(moduleCandidates, 3, false, true, cryptoApi)
    expect(results.map((result) => result.moduleState)).toEqual(['unavailable', 'missing', 'selected'])
    expect(results[2].module).toEqual({ id: 'a:AFT-Y', index: 2, name: '模组乙', code: 'AFT-Y' })
    expect(results[0].module).toBeUndefined()
  })

  it('关闭随机模组时不生成模组结果', () => {
    const results = drawOperatorResults(operators.slice(0, 2), 2, false, false)
    expect(results.every((result) => result.module === undefined && result.moduleState === undefined)).toBe(true)
  })
})