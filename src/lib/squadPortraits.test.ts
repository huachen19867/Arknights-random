import { describe, expect, it } from 'vitest'
import { normalizeSquadPortraitPayload } from './squadPortraits'

describe('normalizeSquadPortraitPayload', () => {
  it('解析独立映射并按 BASE_URL 解析本地素材', () => {
    expect(normalizeSquadPortraitPayload({
      schemaVersion: 1,
      count: 1,
      portraits: {
        B00W: 'assets/squad-portraits/B00W.png',
        'R001:术师': '/assets/squad-portraits/amiya.png',
        remote: 'https://example.com/portrait.png',
      },
    }, '/arknights-random/')).toEqual({
      B00W: '/arknights-random/assets/squad-portraits/B00W.png',
      'R001:术师': '/arknights-random/assets/squad-portraits/amiya.png',
      remote: 'https://example.com/portrait.png',
    })
  })

  it('跳过无效记录，并在 manifest 缺失或版本未知时返回空映射', () => {
    expect(normalizeSquadPortraitPayload({
      schemaVersion: 1,
      portraits: { valid: 'assets/portrait.png', blank: '  ', wrong: null },
    }, '/')).toEqual({ valid: '/assets/portrait.png' })
    expect(normalizeSquadPortraitPayload({ schemaVersion: 2, portraits: { id: 'a.png' } }, '/'))
      .toEqual({})
    expect(normalizeSquadPortraitPayload(null, '/')).toEqual({})
  })
})
