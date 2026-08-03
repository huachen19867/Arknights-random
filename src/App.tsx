import { useEffect, useMemo, useRef, useState } from 'react'
import { AppHeader } from './components/AppHeader'
import { useOperatorData } from './hooks/useOperatorData'
import {
  drawOperatorResults,
  drawOperatorResultsByProfessionSlots,
  filterOperators,
  filterOperatorsForPlan,
  professionSlotStats,
} from './lib/operators'
import { getEffectiveDrawConfig, loadSettings, saveSettings } from './lib/settings'
import { trackDraw, trackPageView } from './lib/analytics'
import { BanPage } from './pages/BanPage'
import { DrawPage } from './pages/DrawPage'
import { PortraitSamplePage } from './pages/PortraitSamplePage'
import { SettingsPage } from './pages/SettingsPage'
import type { AppPage, DrawResult, DrawSettings } from './types'

function pageFromHash(): AppPage {
  const page = window.location.hash.replace('#/', '')
  return page === 'settings' || page === 'ban' || page === 'portrait-test'
    ? page
    : 'draw'
}

/** 按结果统计随机技能/模组的提示语，两种抽取模式共用。 */
function buildRandomNotices(results: DrawResult[], settings: DrawSettings): string[] {
  const notices: string[] = []
  if (settings.randomSkill) {
    const missing = results.filter((result) => result.skillState === 'missing').length
    const unavailable = results.filter((result) => result.skillState === 'unavailable').length
    notices.push(
      missing > 0 || unavailable > 0
        ? [
            missing > 0 ? `${missing} 名干员缺少技能数据` : '',
            unavailable > 0 ? `${unavailable} 名干员没有可用技能` : '',
          ]
            .filter(Boolean)
            .join('，') + '。'
        : '已为每名干员独立随机一个技能。',
    )
  }
  if (settings.randomModule) {
    const missing = results.filter((result) => result.moduleState === 'missing').length
    const unavailable = results.filter((result) => result.moduleState === 'unavailable').length
    notices.push(
      missing > 0 || unavailable > 0
        ? [
            missing > 0 ? `${missing} 名干员缺少模组数据` : '',
            unavailable > 0 ? `${unavailable} 名干员没有可用模组` : '',
          ]
            .filter(Boolean)
            .join('，') + '。'
        : '已为每名干员独立随机一个模组。',
    )
  }
  return notices
}

export function App() {
  const { operators, source, loading } = useOperatorData()
  const [settings, setSettings] = useState<DrawSettings>(() => loadSettings(window.localStorage))
  const [page, setPage] = useState<AppPage>(pageFromHash)
  const [results, setResults] = useState<DrawResult[]>([])
  const [drawing, setDrawing] = useState(false)
  const [notice, setNotice] = useState('')
  const [showOrientationHint, setShowOrientationHint] = useState(false)
  const drawTimer = useRef<number | undefined>(undefined)

  const effective = useMemo(() => getEffectiveDrawConfig(settings), [settings])
  const candidates = useMemo(
    () =>
      effective.drawMode === 'profession-plan'
        ? filterOperatorsForPlan(operators, settings)
        : filterOperators(operators, settings),
    [operators, settings, effective.drawMode],
  )
  const planStats = useMemo(
    () => (effective.drawMode === 'profession-plan' ? professionSlotStats(operators, settings) : undefined),
    [operators, settings, effective.drawMode],
  )

  useEffect(() => saveSettings(settings, window.localStorage), [settings])

  useEffect(() => {
    trackPageView(page)
  }, [page])

  useEffect(() => {
    const onHashChange = () => setPage(pageFromHash())
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  useEffect(() => {
    setResults([])
    setNotice('')
  }, [settings, operators])

  useEffect(
    () => () => {
      if (drawTimer.current !== undefined) window.clearTimeout(drawTimer.current)
    },
    [],
  )

  useEffect(() => {
    const portraitPhone = window.matchMedia('(max-width: 760px) and (orientation: portrait)')
    let hintTimer: number | undefined

    const updateHint = () => {
      if (hintTimer !== undefined) window.clearTimeout(hintTimer)
      if (!portraitPhone.matches) {
        setShowOrientationHint(false)
        return
      }
      setShowOrientationHint(true)
      hintTimer = window.setTimeout(() => setShowOrientationHint(false), 2200)
    }

    updateHint()
    portraitPhone.addEventListener('change', updateHint)
    return () => {
      portraitPhone.removeEventListener('change', updateHint)
      if (hintTimer !== undefined) window.clearTimeout(hintTimer)
    }
  }, [])

  const navigate = (target: AppPage) => {
    window.location.hash = target === 'draw' ? '#/' : `#/${target}`
    setPage(target)
  }

  const draw = () => {
    if (drawing) return

    if (effective.drawMode === 'profession-plan') {
      if (settings.professionSlots.length === 0) {
        setNotice('尚未添加职业名额，请在抽取设置中添加职业名额。')
        return
      }
      try {
        const selected = drawOperatorResultsByProfessionSlots(operators, settings)
        setResults(selected)
        setDrawing(true)
        trackDraw()
        const stats = professionSlotStats(operators, settings)
        const parts = [`已满足 ${stats.satisfiable} / ${stats.total} 个职业名额。`]
        for (const shortage of stats.shortages) {
          parts.push(
            `${shortage.profession}需要 ${shortage.needed} 名，当前仅 ${shortage.available} 名符合星级与 Ban 条件，${shortage.missing} 个名额留空。`,
          )
        }
        setNotice([...parts, ...buildRandomNotices(selected, settings)].join(' '))
        drawTimer.current = window.setTimeout(() => setDrawing(false), 900)
      } catch (error) {
        setResults([])
        setDrawing(false)
        setNotice(error instanceof Error ? `抽取失败：${error.message}` : '抽取失败，请刷新页面后重试。')
      }
      return
    }

    if (candidates.length === 0) {
      setNotice('没有符合当前条件的干员，请检查筛选与 Ban 名单。')
      return
    }

    try {
      const selected = drawOperatorResults(
        candidates,
        settings.count,
        settings.randomSkill,
        settings.randomModule,
      )
      setResults(selected)
      setDrawing(true)
      trackDraw()
      const drawNotice =
        candidates.length < settings.count
          ? `候选池仅有 ${candidates.length} 人，已展示全部候选，不会重复抽取。`
          : `已从 ${candidates.length} 名候选中无重复抽取 ${selected.length} 人。`
      setNotice([drawNotice, ...buildRandomNotices(selected, settings)].join(' '))
      drawTimer.current = window.setTimeout(() => setDrawing(false), 900)
    } catch (error) {
      setResults([])
      setDrawing(false)
      setNotice(error instanceof Error ? `抽取失败：${error.message}` : '抽取失败，请刷新页面后重试。')
    }
  }

  return (
    <div className="app-shell">
      {showOrientationHint && (
        <section className="orientation-hint" role="status" aria-live="polite">
          <div className="orientation-hint__signal" aria-hidden="true">
            <span className="orientation-hint__phone"></span>
            <span className="orientation-hint__arc"></span>
          </div>
          <div>
            <span className="orientation-hint__eyebrow">DISPLAY ORIENTATION / 90°</span>
            <h1>建议横屏浏览</h1>
            <p>横置手机可获得更完整的编队界面</p>
          </div>
        </section>
      )}
      <AppHeader
        page={page}
        onNavigate={navigate}
        bannedCount={settings.bannedIds.length}
      />
      {page === 'settings' && (
        <SettingsPage
          settings={settings}
          onChange={setSettings}
          onBack={() => navigate('draw')}
          candidateCount={candidates.length}
        />
      )}
      {page === 'ban' && (
        <BanPage operators={operators} settings={settings} onChange={setSettings} onBack={() => navigate('draw')} />
      )}

      {page === 'portrait-test' && <PortraitSamplePage operators={operators} onBack={() => navigate('draw')} />}
      {page === 'draw' && (
        <DrawPage
          settings={settings}
          candidates={candidates}
          results={results}
          planStats={planStats}
          dataSource={source}
          loading={loading}
          drawing={drawing}
          notice={notice}
          onDraw={draw}
        />
      )}
      <footer className="legal-note">
        非官方、非商业粉丝工具。游戏素材与角色权利归原权利方所有；干员资料来源于 PRTS Wiki。
        本站仅记录匿名访问次数与设备类别，不记录抽取设置、结果或个人身份信息。
      </footer>
    </div>
  )
}
