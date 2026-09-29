import { useEffect, useState } from 'react'
import { fallbackOperators } from '../data/fallbackOperators'
import { resolveAssetUrl, resolveOperatorsUrl, resolveSquadPortraitsUrl } from '../lib/dataSource'
import { normalizeOperatorPayload } from '../lib/operators'
import { normalizeSquadPortraitPayload, type SquadPortraitMap } from '../lib/squadPortraits'
import type { DataSource, Operator } from '../types'

interface OperatorDataState {
  operators: Operator[]
  squadPortraits: SquadPortraitMap
  squadPortraitsLoading: boolean
  source: DataSource
  loading: boolean
}

export function useOperatorData(): OperatorDataState {
  const [state, setState] = useState<OperatorDataState>({
    operators: fallbackOperators,
    squadPortraits: {},
    squadPortraitsLoading: true,
    source: 'fallback',
    loading: true,
  })

  useEffect(() => {
    const controller = new AbortController()

    async function loadSquadPortraits() {
      try {
        const response = await fetch(resolveSquadPortraitsUrl(import.meta.env.BASE_URL), {
          cache: 'no-cache',
          signal: controller.signal,
        })
        if (!response.ok) throw new Error(`编队上身素材映射请求失败：${response.status}`)
        const squadPortraits = normalizeSquadPortraitPayload(
          await response.json(),
          import.meta.env.BASE_URL,
        )
        if (Object.keys(squadPortraits).length === 0) {
          console.warn('编队上身素材映射为空或格式不受支持，卡片将使用原立绘。')
        }
        if (!controller.signal.aborted) {
          setState((current) => ({ ...current, squadPortraits, squadPortraitsLoading: false }))
        }
      } catch (error) {
        if (controller.signal.aborted) return
        console.warn('未读取到编队上身素材映射，卡片将使用原立绘。', error)
        setState((current) => ({ ...current, squadPortraits: {}, squadPortraitsLoading: false }))
      }
    }

    async function load() {
      try {
        const response = await fetch(resolveOperatorsUrl(import.meta.env.BASE_URL), {
          cache: 'no-cache',
          signal: controller.signal,
        })
        if (!response.ok) throw new Error(`数据请求失败：${response.status}`)
        const operators = normalizeOperatorPayload(await response.json()).map((operator) => ({
          ...operator,
          portrait: resolveAssetUrl(import.meta.env.BASE_URL, operator.portrait),
          portraitFallback: resolveAssetUrl(import.meta.env.BASE_URL, operator.portraitFallback),
        }))
        if (operators.length === 0) throw new Error('干员数据为空或格式无效')
        setState((current) => ({ ...current, operators, source: 'feishu-export', loading: false }))
      } catch (error) {
        if (controller.signal.aborted) return
        console.warn('未读取到正式干员库，已使用内置样例数据。', error)
        setState((current) => ({ ...current, operators: fallbackOperators, source: 'fallback', loading: false }))
      }
    }

    void loadSquadPortraits()
    void load()
    return () => controller.abort()
  }, [])

  return state
}
