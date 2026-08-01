import {
  PROFESSIONS,
  RARITIES,
  type DrawSettings,
  type Profession,
  type Rarity,
} from '../types'

export const SETTINGS_STORAGE_KEY = 'rhodes-randomizer.settings.v1'

export const DEFAULT_SETTINGS: DrawSettings = {
  rarities: [...RARITIES],
  professions: [...PROFESSIONS],
  count: 12,
  bannedIds: [],
  randomSkill: false,
  randomModule: false,
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

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
    ? Math.min(12, Math.max(1, Math.trunc(input.count as number)))
    : DEFAULT_SETTINGS.count
  const bannedIds = Array.isArray(input.bannedIds)
    ? [...new Set(input.bannedIds.filter((item): item is string => typeof item === 'string'))]
    : []
  const randomSkill = input.randomSkill === true
  const randomModule = input.randomModule === true

  return { rarities, professions, count, bannedIds, randomSkill, randomModule }
}

export function loadSettings(storage?: StorageLike): DrawSettings {
  if (!storage) return { ...DEFAULT_SETTINGS, rarities: [...RARITIES], professions: [...PROFESSIONS] }
  try {
    const saved = storage.getItem(SETTINGS_STORAGE_KEY)
    return saved ? normalizeSettings(JSON.parse(saved)) : normalizeSettings(DEFAULT_SETTINGS)
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
