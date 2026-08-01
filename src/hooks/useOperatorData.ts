import { useEffect, useState } from 'react'
import { fallbackOperators } from '../data/fallbackOperators'
import { resolveOperatorsUrl } from '../lib/dataSource'
import { normalizeOperatorPayload } from '../lib/operators'
import type { DataSource, Operator } from '../types'

interface OperatorDataState {
  operators: Operator[]
  source: DataSource
  loading: boolean
}

export function useOperatorData(): OperatorDataState {
  const [state, setState] = useState<OperatorDataState>({
    operators: fallbackOperators,
    source: 'fallback',
    loading: true,
  })

  useEffect(() => {
    const controller = new AbortController()

    async function load() {
      try {
        const response = await fetch(resolveOperatorsUrl(import.meta.env.BASE_URL), {
          cache: 'no-cache',
          signal: controller.signal,
        })
        if (!response.ok) throw new Error(`数据请求失败：${response.status}`)
        const operators = normalizeOperatorPayload(await response.json())
        if (operators.length === 0) throw new Error('干员数据为空或格式无效')
        setState({ operators, source: 'feishu-export', loading: false })
      } catch (error) {
        if (controller.signal.aborted) return
        console.warn('未读取到正式干员库，已使用内置样例数据。', error)
        setState({ operators: fallbackOperators, source: 'fallback', loading: false })
      }
    }

    void load()
    return () => controller.abort()
  }, [])

  return state
}
