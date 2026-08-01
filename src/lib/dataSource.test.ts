import { describe, expect, it } from 'vitest'
import { resolveOperatorsUrl } from './dataSource'

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
