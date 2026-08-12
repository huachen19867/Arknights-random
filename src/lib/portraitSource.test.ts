import { describe, expect, it } from 'vitest'
import { nextPortraitSource } from './portraitSource'

describe('nextPortraitSource', () => {
  it('PRTS 主图失败时切换到本站备用图', () => {
    expect(nextPortraitSource(
      'https://media.prts.wiki/operator.webp',
      '/assets/operators/A41.webp',
    )).toBe('/assets/operators/A41.webp')
  })

  it('本站备用图失败后停止重试并显示文字占位', () => {
    expect(nextPortraitSource('/assets/operators/A41.webp', '/assets/operators/A41.webp'))
      .toBeUndefined()
  })

  it('没有备用图时直接显示文字占位', () => {
    expect(nextPortraitSource('https://example.com/broken.webp', undefined)).toBeUndefined()
  })
})
