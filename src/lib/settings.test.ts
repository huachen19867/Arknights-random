import { describe, expect, it } from 'vitest'
import { PROFESSIONS, RARITIES } from '../types'
import {
  DEFAULT_SETTINGS,
  SETTINGS_STORAGE_KEY,
  loadSettings,
  normalizeSettings,
  saveSettings,
} from './settings'

function memoryStorage(initial?: string) {
  let value = initial ?? null
  return {
    getItem(key: string) {
      return key === SETTINGS_STORAGE_KEY ? value : null
    },
    setItem(key: string, next: string) {
      if (key === SETTINGS_STORAGE_KEY) value = next
    },
    read() {
      return value
    },
  }
}

describe('settings', () => {
  it('默认全选星级与职业、抽取 12 人，并关闭随机技能与随机模组', () => {
    const loaded = loadSettings(memoryStorage())
    expect(loaded.rarities).toEqual(RARITIES)
    expect(loaded.professions).toEqual(PROFESSIONS)
    expect(loaded.count).toBe(12)
    expect(loaded.bannedIds).toEqual([])
    expect(loaded.randomSkill).toBe(false)
    expect(loaded.randomModule).toBe(false)
  })

  it('持久化设置并去重 Ban id', () => {
    const storage = memoryStorage()
    saveSettings({ ...DEFAULT_SETTINGS, count: 7, bannedIds: ['a', 'a', 'b'], randomSkill: true, randomModule: true }, storage)
    expect(loadSettings(storage)).toMatchObject({ count: 7, bannedIds: ['a', 'b'], randomSkill: true, randomModule: true })
  })

  it('修正越界人数并过滤未知枚举', () => {
    expect(
      normalizeSettings({
        rarities: [6, 9],
        professions: ['近卫', '未知'],
        count: 99,
        bannedIds: [1, 'valid'],
      }),
    ).toEqual({
      rarities: [6],
      professions: ['近卫'],
      count: 12,
      bannedIds: ['valid'],
      randomSkill: false,
      randomModule: false,
    })
  })

  it('旧版设置没有 randomSkill 时兼容为关闭', () => {
    const storage = memoryStorage(
      JSON.stringify({ rarities: [6], professions: ['近卫'], count: 1, bannedIds: [] }),
    )
    expect(loadSettings(storage).randomSkill).toBe(false)
  })

  it('旧版设置没有 randomModule 时兼容为关闭', () => {
    const storage = memoryStorage(
      JSON.stringify({ rarities: [6], professions: ['近卫'], count: 1, bannedIds: [], randomSkill: true }),
    )
    expect(loadSettings(storage).randomModule).toBe(false)
    expect(loadSettings(storage).randomSkill).toBe(true)
  })

  it('损坏的 JSON 自动回退默认值', () => {
    const loaded = loadSettings(memoryStorage('{bad json'))
    expect(loaded).toEqual(DEFAULT_SETTINGS)
  })
})
