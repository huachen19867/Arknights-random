export const PROFESSIONS = [
  '先锋',
  '近卫',
  '重装',
  '狙击',
  '术师',
  '医疗',
  '辅助',
  '特种',
] as const

export const RARITIES = [1, 2, 3, 4, 5, 6] as const

export type Profession = (typeof PROFESSIONS)[number]
export type Rarity = (typeof RARITIES)[number]

export interface OperatorSkill {
  index: number
  name: string
}

export interface OperatorModule {
  id: string
  index: number
  name: string
  code?: string
  sourceUrl?: string
}

export interface Operator {
  id: string
  name: string
  rarity: Rarity
  profession: Profession
  enabled?: boolean
  portrait?: string
  sourceUrl?: string
  updatedAt?: string
  skills?: OperatorSkill[]
  modules?: OperatorModule[]
}

export interface DrawResult {
  operator: Operator
  skill?: OperatorSkill
  skillState?: 'selected' | 'unavailable' | 'missing'
  module?: OperatorModule
  moduleState?: 'selected' | 'unavailable' | 'missing'
}

export interface DrawSettings {
  rarities: Rarity[]
  professions: Profession[]
  count: number
  bannedIds: string[]
  randomSkill: boolean
  randomModule: boolean
}

export type AppPage = 'draw' | 'settings' | 'ban' | 'portrait-test'

export type DataSource = 'feishu-export' | 'fallback'
