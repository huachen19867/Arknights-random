import { describe, expect, it } from 'vitest'
import { PROFESSIONS, RARITIES, type DrawSettings } from '../types'
import {
  DEFAULT_SETTINGS,
  LEGACY_SETTINGS_STORAGE_KEY,
  MAX_PROFESSION_SLOTS,
  SETTINGS_STORAGE_KEY,
  getEffectiveDrawConfig,
  loadSettings,
  normalizeSettings,
  saveSettings,
} from './settings'

function memoryStorage(v2?: string, v1?: string) {
  let valueV2 = v2 ?? null
  let valueV1 = v1 ?? null
  return {
    getItem(key: string) {
      if (key === SETTINGS_STORAGE_KEY) return valueV2
      if (key === LEGACY_SETTINGS_STORAGE_KEY) return valueV1
      return null
    },
    setItem(key: string, next: string) {
      if (key === SETTINGS_STORAGE_KEY) valueV2 = next
      if (key === LEGACY_SETTINGS_STORAGE_KEY) valueV1 = next
    },
    read() {
      return valueV2
    },
  }
}

describe('settings', () => {
  it('默认全选星级与职业、抽取 12 人，并关闭随机技能与随机模组，处于普通范围模式', () => {
    const loaded = loadSettings(memoryStorage())
    expect(loaded.rarities).toEqual(RARITIES)
    expect(loaded.professions).toEqual(PROFESSIONS)
    expect(loaded.count).toBe(12)
    expect(loaded.bannedIds).toEqual([])
    expect(loaded.randomSkill).toBe(false)
    expect(loaded.randomModule).toBe(false)
    expect(loaded.drawMode).toBe('range')
    expect(loaded.professionSlots).toEqual([])
  })

  it('持久化设置并去重 Ban id', () => {
    const storage = memoryStorage()
    saveSettings(
      { ...DEFAULT_SETTINGS, count: 7, bannedIds: ['a', 'a', 'b'], randomSkill: true, randomModule: true },
      storage,
    )
    expect(loadSettings(storage)).toMatchObject({
      count: 7,
      bannedIds: ['a', 'b'],
      randomSkill: true,
      randomModule: true,
    })
  })

  it('修正越界人数并过滤未知枚举', () => {
    expect(
      normalizeSettings({
        rarities: [6, 9],
        professions: ['近卫', '未知'],
        count: 99,
        bannedIds: [1, 'valid'],
        drawMode: 'profession-plan',
        professionSlots: ['近卫', '近卫', '未知职业'],
      }),
    ).toEqual({
      rarities: [6],
      professions: ['近卫'],
      count: 12,
      bannedIds: ['valid'],
      randomSkill: false,
      randomModule: false,
      drawMode: 'profession-plan',
      professionSlots: ['近卫', '近卫'],
    })
  })

  it('v2 缺失时读取 v1 并补入普通范围模式与空名额数组', () => {
    const storage = memoryStorage(
      undefined,
      JSON.stringify({ rarities: [6], professions: ['近卫'], count: 1, bannedIds: ['a'], randomSkill: true }),
    )
    const loaded = loadSettings(storage)
    expect(loaded).toMatchObject({
      rarities: [6],
      professions: ['近卫'],
      count: 1,
      bannedIds: ['a'],
      randomSkill: true,
      randomModule: false,
      drawMode: 'range',
      professionSlots: [],
    })
  })

  it('v1 存储的旧数据没有任何 v2 字段也能完整保留原有设置', () => {
    const storage = memoryStorage(
      undefined,
      JSON.stringify({ rarities: [5, 6], professions: ['近卫', '狙击'], count: 4, bannedIds: ['x'] }),
    )
    const loaded = loadSettings(storage)
    expect(loaded.rarities).toEqual([5, 6])
    expect(loaded.professions).toEqual(['近卫', '狙击'])
    expect(loaded.count).toBe(4)
    expect(loaded.bannedIds).toEqual(['x'])
  })

  it('职业名额保留重复项与顺序，只过滤未知职业', () => {
    const loaded = loadSettings(
      memoryStorage(
        JSON.stringify({
          ...DEFAULT_SETTINGS,
          drawMode: 'profession-plan',
          professionSlots: ['近卫', '近卫', '医疗', '近卫', '不存在'],
        }),
      ),
    )
    expect(loaded.professionSlots).toEqual(['近卫', '近卫', '医疗', '近卫'])
    expect(loaded.drawMode).toBe('profession-plan')
  })

  it('职业名额超过 12 个时只保留前 12 个', () => {
    const slots = Array.from({ length: 15 }, (_, index) => PROFESSIONS[index % PROFESSIONS.length])
    const loaded = loadSettings(memoryStorage(JSON.stringify({ ...DEFAULT_SETTINGS, professionSlots: slots })))
    expect(loaded.professionSlots).toHaveLength(MAX_PROFESSION_SLOTS)
    expect(loaded.professionSlots).toEqual(slots.slice(0, MAX_PROFESSION_SLOTS))
  })

  it('未知 drawMode 回退为普通范围模式', () => {
    expect(
      normalizeSettings({ ...DEFAULT_SETTINGS, drawMode: 'unknown' as never, professionSlots: ['近卫'] }).drawMode,
    ).toBe('range')
  })

  it('损坏的 JSON 自动回退默认值', () => {
    const loaded = loadSettings(memoryStorage('{bad json'))
    expect(loaded).toEqual(DEFAULT_SETTINGS)
  })

  it('v2 优先于 v1，v2 损坏时回退默认而不是读 v1', () => {
    const storage = memoryStorage('{bad json', JSON.stringify({ count: 3 }))
    expect(loadSettings(storage).count).toBe(DEFAULT_SETTINGS.count)
  })

  it('有效配置：普通范围模式使用 count 与 professions', () => {
    const settings: DrawSettings = { ...DEFAULT_SETTINGS, count: 5, professions: ['近卫'] }
    expect(getEffectiveDrawConfig(settings)).toEqual({
      drawMode: 'range',
      count: 5,
      professions: ['近卫'],
      professionSlots: [],
    })
  })

  it('有效配置：自选职业模式人数等于名额数，普通设置原样保留', () => {
    const settings: DrawSettings = {
      ...DEFAULT_SETTINGS,
      count: 9,
      professions: ['近卫', '狙击'],
      drawMode: 'profession-plan',
      professionSlots: ['近卫', '近卫', '医疗'],
    }
    expect(getEffectiveDrawConfig(settings)).toEqual({
      drawMode: 'profession-plan',
      count: 3,
      professions: ['近卫', '狙击'],
      professionSlots: ['近卫', '近卫', '医疗'],
    })
  })
})