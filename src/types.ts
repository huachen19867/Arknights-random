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

export type DrawMode = 'range' | 'profession-plan'

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
  /** 自选职业模式候选不足时为空，此时 shortage 为 true。 */
  operator?: Operator
  skill?: OperatorSkill
  skillState?: 'selected' | 'unavailable' | 'missing'
  module?: OperatorModule
  moduleState?: 'selected' | 'unavailable' | 'missing'
  /** 自选职业模式：该结果槽位期望的职业；普通范围模式不设置。 */
  expectedProfession?: Profession
  /** 自选职业模式：该槽位对应职业候选不足，没有抽中干员。 */
  shortage?: boolean
}

export interface DrawSettings {
  /** 普通范围模式的星级允许集合。 */
  rarities: Rarity[]
  /** 普通范围模式的职业允许集合（去重）。 */
  professions: Profession[]
  /** 普通范围模式的抽取人数。 */
  count: number
  bannedIds: string[]
  randomSkill: boolean
  randomModule: boolean
  /** range=普通范围模式；profession-plan=自选职业名额模式。 */
  drawMode: DrawMode
  /** 自选职业名额：保留顺序与重复项，长度 0..12。 */
  professionSlots: Profession[]
}

export type AppPage = 'draw' | 'settings' | 'ban' | 'portrait-test'

export type DataSource = 'feishu-export' | 'fallback'