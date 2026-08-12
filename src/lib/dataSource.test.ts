import { describe, expect, it } from 'vitest'
import { resolveAssetUrl, resolveOperatorsUrl } from './dataSource'

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
})
