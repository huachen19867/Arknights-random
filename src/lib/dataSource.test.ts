import { describe, expect, it } from 'vitest'
import { resolveAssetUrl, resolveOperatorsUrl, resolveSquadPortraitsUrl } from './dataSource'

describe('resolveOperatorsUrl', () => {
  it('支持根路径部署', () => {
    expect(resolveOperatorsUrl('/')).toBe('/data/operators.json')
  })

  it('支持仓库子路径部署', () => {
    expect(resolveOperatorsUrl('/arknights-random/')).toBe('/arknights-random/data/operators.json')
    expect(resolveOperatorsUrl('/arknights-random')).toBe('/arknights-random/data/operators.json')
  })

  it('支持相对 base 路径', () => {
    expect(resolveOperatorsUrl('./')).toBe('./data/operators.json')
  })
})

describe('resolveSquadPortraitsUrl', () => {
  it('支持根路径及 GitHub Pages 子路径', () => {
    expect(resolveSquadPortraitsUrl('/')).toBe('/data/squad-portraits.json')
    expect(resolveSquadPortraitsUrl('/arknights-random'))
      .toBe('/arknights-random/data/squad-portraits.json')
  })
})

describe('resolveAssetUrl', () => {
  it('把本站相对资源解析到根路径或仓库子路径', () => {
    expect(resolveAssetUrl('/', 'assets/operators/A41.webp')).toBe('/assets/operators/A41.webp')
    expect(resolveAssetUrl('/Arknights-random/', 'assets/operators/id-UjAwMTrljLvnlpc.webp'))
      .toBe('/Arknights-random/assets/operators/id-UjAwMTrljLvnlpc.webp')
  })

  it('保留 HTTPS 外链和空值，兼容旧快照', () => {
    expect(resolveAssetUrl('/Arknights-random/', 'https://example.com/operator.webp'))
      .toBe('https://example.com/operator.webp')
    expect(resolveAssetUrl('/', undefined)).toBeUndefined()
  })

  it('允许主立绘使用外链、备用立绘使用本站子路径', () => {
    expect(resolveAssetUrl('/Arknights-random/', 'https://media.prts.wiki/operator.webp'))
      .toBe('https://media.prts.wiki/operator.webp')
    expect(resolveAssetUrl('/Arknights-random/', 'assets/operators/A41.webp'))
      .toBe('/Arknights-random/assets/operators/A41.webp')
  })
})
