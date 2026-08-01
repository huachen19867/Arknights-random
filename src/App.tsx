import { useEffect, useMemo, useRef, useState } from 'react'
import { AppHeader } from './components/AppHeader'
import { useOperatorData } from './hooks/useOperatorData'
import { drawOperatorResults, filterOperators } from './lib/operators'
import { loadSettings, saveSettings } from './lib/settings'
import { BanPage } from './pages/BanPage'
import { DrawPage } from './pages/DrawPage'
import { PortraitSamplePage } from './pages/PortraitSamplePage'
import { SettingsPage } from './pages/SettingsPage'
import type { AppPage, DrawResult, DrawSettings } from './types'

function pageFromHash(): AppPage {
  const page = window.location.hash.replace('#/', '')
  return page === 'settings' || page === 'ban' || page === 'portrait-test' ? page : 'draw'
}

export function App() {
  const { operators, source, loading } = useOperatorData()
  const [settings, setSettings] = useState<DrawSettings>(() => loadSettings(window.localStorage))
  const [page, setPage] = useState<AppPage>(pageFromHash)
  const [results, setResults] = useState<DrawResult[]>([])
  const [drawing, setDrawing] = useState(false)
  const [notice, setNotice] = useState('')
  const drawTimer = useRef<number | undefined>(undefined)

  const candidates = useMemo(() => filterOperators(operators, settings), [operators, settings])

  useEffect(() => saveSettings(settings, window.localStorage), [settings])

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

  const navigate = (target: AppPage) => {
    window.location.hash = target === 'draw' ? '#/' : `#/${target}`
    setPage(target)
  }

  const draw = () => {
    if (drawing || candidates.length === 0) {
      if (candidates.length === 0) setNotice('没有符合当前条件的干员，请检查筛选与 Ban 名单。')
      return
    }

    try {
      const selected = drawOperatorResults(candidates, settings.count, settings.randomSkill)
      setResults(selected)
      setDrawing(true)
      const drawNotice =
        candidates.length < settings.count
          ? `候选池仅有 ${candidates.length} 人，已展示全部候选，不会重复抽取。`
          : `已从 ${candidates.length} 名候选中无重复抽取 ${selected.length} 人。`
      const missingSkillCount = selected.filter((result) => result.skillState === 'missing').length
      const unavailableSkillCount = selected.filter((result) => result.skillState === 'unavailable').length
      const skillNotice = settings.randomSkill
        ? missingSkillCount > 0 || unavailableSkillCount > 0
          ? [
              missingSkillCount > 0 ? `${missingSkillCount} 名干员缺少技能数据` : '',
              unavailableSkillCount > 0 ? `${unavailableSkillCount} 名干员没有可用技能` : '',
            ]
              .filter(Boolean)
              .join('，') + '。'
          : '已为每名干员独立随机一个技能。'
        : ''
      setNotice([drawNotice, skillNotice].filter(Boolean).join(' '))
      drawTimer.current = window.setTimeout(() => setDrawing(false), 900)
    } catch (error) {
      setResults([])
      setDrawing(false)
      setNotice(error instanceof Error ? `抽取失败：${error.message}` : '抽取失败，请刷新页面后重试。')
    }
  }

  return (
    <div className="app-shell">
      <AppHeader page={page} onNavigate={navigate} bannedCount={settings.bannedIds.length} />
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
          dataSource={source}
          loading={loading}
          drawing={drawing}
          notice={notice}
          onDraw={draw}
        />
      )}
      <footer className="legal-note">
        非官方、非商业粉丝工具。游戏素材与角色权利归原权利方所有；干员资料来源于 PRTS Wiki。
      </footer>
    </div>
  )
}
