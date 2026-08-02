import {
  PROFESSIONS,
  RARITIES,
  type DrawMode,
  type DrawSettings,
  type Profession,
  type Rarity,
} from '../types'

export const SETTINGS_STORAGE_KEY = 'rhodes-randomizer.settings.v2'
export const LEGACY_SETTINGS_STORAGE_KEY = 'rhodes-randomizer.settings.v1'
/** 自选职业名额上限，与抽取人数上限保持一致。 */
export const MAX_PROFESSION_SLOTS = 12

export const DEFAULT_SETTINGS: DrawSettings = {
  rarities: [...RARITIES],
  professions: [...PROFESSIONS],
  count: 12,
  bannedIds: [],
  randomSkill: false,
  randomModule: false,
  drawMode: 'range',
  professionSlots: [],
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

export interface EffectiveDrawConfig {
  drawMode: DrawMode
  /** 当前模式实际抽取人数。 */
  count: number
  /** 当前模式参与抽取的职业集合（普通范围模式使用）。 */
  professions: Profession[]
  /** 自选职业模式的名额数组；范围模式下为空数组。 */
  professionSlots: Profession[]
}

/** 所有界面（主界面人数、顶部徽标、设置摘要、自选页计数）必须从这里读取同一份有效配置。 */
export function getEffectiveDrawConfig(settings: DrawSettings): EffectiveDrawConfig {
  if (settings.drawMode === 'profession-plan') {
    return {
      drawMode: 'profession-plan',
      count: settings.professionSlots.length,
      professions: settings.professions,
      professionSlots: settings.professionSlots,
    }
  }
  return {
    drawMode: 'range',
    count: settings.count,
    professions: settings.professions,
    professionSlots: [],
  }
}

/**
 * 归一化设置：职业名额保留顺序与重复项，只过滤未知职业并截断到上限；
 * 普通 professions 继续使用 Set 去重语义，两者不得混用。
 */
export function normalizeSettings(value: unknown): DrawSettings {
  const input = value && typeof value === 'object' ? (value as Partial<DrawSettings>) : {}
  const rarities = Array.isArray(input.rarities)
    ? [...new Set(input.rarities.filter((item): item is Rarity => RARITIES.includes(item as Rarity)))]
    : [...DEFAULT_SETTINGS.rarities]
  const professions = Array.isArray(input.professions)
    ? [
        ...new Set(
          input.professions.filter((item): item is Profession =>
            PROFESSIONS.includes(item as Profession),
          ),
        ),
      ]
    : [...DEFAULT_SETTINGS.professions]
  const count = Number.isFinite(input.count)
    ? Math.min(MAX_PROFESSION_SLOTS, Math.max(1, Math.trunc(input.count as number)))
    : DEFAULT_SETTINGS.count
  const bannedIds = Array.isArray(input.bannedIds)
    ? [...new Set(input.bannedIds.filter((item): item is string => typeof item === 'string'))]
    : []
  const randomSkill = input.randomSkill === true
  const randomModule = input.randomModule === true
  const drawMode: DrawMode = input.drawMode === 'profession-plan' ? 'profession-plan' : 'range'
  const professionSlots = Array.isArray(input.professionSlots)
    ? input.professionSlots
        .filter((item): item is Profession => PROFESSIONS.includes(item as Profession))
        .slice(0, MAX_PROFESSION_SLOTS)
    : []

  return { rarities, professions, count, bannedIds, randomSkill, randomModule, drawMode, professionSlots }
}

export function loadSettings(storage?: StorageLike): DrawSettings {
  if (!storage) return { ...DEFAULT_SETTINGS, rarities: [...RARITIES], professions: [...PROFESSIONS] }
  try {
    const savedV2 = storage.getItem(SETTINGS_STORAGE_KEY)
    if (savedV2) return normalizeSettings(JSON.parse(savedV2))
    const savedV1 = storage.getItem(LEGACY_SETTINGS_STORAGE_KEY)
    if (savedV1) return normalizeSettings(JSON.parse(savedV1))
    return normalizeSettings(DEFAULT_SETTINGS)
  } catch {
    return normalizeSettings(DEFAULT_SETTINGS)
  }
}

export function saveSettings(settings: DrawSettings, storage?: StorageLike): void {
  if (!storage) return
  try {
    storage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(normalizeSettings(settings)))
  } catch {
    // 隐私模式或容量限制时仍允许当前会话继续使用。
  }
}