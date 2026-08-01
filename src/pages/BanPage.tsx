import { useMemo, useState } from 'react'
import { PROFESSIONS, RARITIES, type DrawSettings, type Operator } from '../types'
import { ArrowIcon, BanIcon, SearchIcon } from '../components/Icons'
import { OperatorCard } from '../components/OperatorCard'

interface BanPageProps {
  operators: Operator[]
  settings: DrawSettings
  onChange: (settings: DrawSettings) => void
  onBack: () => void
}

export function BanPage({ operators, settings, onChange, onBack }: BanPageProps) {
  const [query, setQuery] = useState('')
  const [rarity, setRarity] = useState('all')
  const [profession, setProfession] = useState('all')
  const bannedSet = useMemo(() => new Set(settings.bannedIds), [settings.bannedIds])

  const filtered = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase('zh-CN')
    return operators.filter(
      (operator) =>
        (!keyword || operator.name.toLocaleLowerCase('zh-CN').includes(keyword)) &&
        (rarity === 'all' || operator.rarity === Number(rarity)) &&
        (profession === 'all' || operator.profession === profession),
    )
  }, [operators, profession, query, rarity])

  const toggleBan = (id: string) => {
    const next = bannedSet.has(id)
      ? settings.bannedIds.filter((bannedId) => bannedId !== id)
      : [...settings.bannedIds, id]
    onChange({ ...settings, bannedIds: next })
  }

  const clearFiltered = () => {
    const visibleIds = new Set(filtered.map((operator) => operator.id))
    onChange({
      ...settings,
      bannedIds: settings.bannedIds.filter((id) => !visibleIds.has(id)),
    })
  }

  return (
    <main className="panel-page ban-page" data-screen-label="Ban 干员">
      <section className="ban-panel">
        <div className="panel-titlebar">
          <button className="back-button" type="button" onClick={onBack} aria-label="返回抽取界面">
            <ArrowIcon />
          </button>
          <div>
            <span className="eyebrow">EXCLUSION LIST / 03</span>
            <h1>Ban 干员</h1>
          </div>
          <div className="candidate-readout candidate-readout--danger">
            <span>已排除</span>
            <strong>{settings.bannedIds.length}</strong>
            <small>名干员</small>
          </div>
        </div>

        <div className="ban-toolbar">
          <label className="search-field">
            <SearchIcon />
            <span className="sr-only">搜索干员名称</span>
            <input
              type="search"
              value={query}
              placeholder="输入干员名称"
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <label className="select-field">
            <span>星级</span>
            <select value={rarity} onChange={(event) => setRarity(event.target.value)}>
              <option value="all">全部星级</option>
              {RARITIES.map((item) => (
                <option value={item} key={item}>
                  {item} 星
                </option>
              ))}
            </select>
          </label>
          <label className="select-field">
            <span>职业</span>
            <select value={profession} onChange={(event) => setProfession(event.target.value)}>
              <option value="all">全部职业</option>
              {PROFESSIONS.map((item) => (
                <option value={item} key={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <div className="ban-actions">
            <button type="button" onClick={clearFiltered} disabled={!filtered.some((item) => bannedSet.has(item.id))}>
              清除当前筛选
            </button>
            <button
              type="button"
              className="danger-button"
              onClick={() => onChange({ ...settings, bannedIds: [] })}
              disabled={settings.bannedIds.length === 0}
            >
              清空全部 Ban
            </button>
          </div>
        </div>

        <div className="ban-results-meta">
          <span>RESULT / {filtered.length}</span>
          <p>点击卡片即可加入或移出 Ban 名单。</p>
        </div>

        {filtered.length > 0 ? (
          <div className="ban-grid">
            {filtered.map((operator, index) => {
              const isBanned = bannedSet.has(operator.id)
              return (
                <button
                  type="button"
                  key={operator.id}
                  className={isBanned ? 'ban-card ban-card--active' : 'ban-card'}
                  aria-pressed={isBanned}
                  onClick={() => toggleBan(operator.id)}
                >
                  <OperatorCard operator={operator} slot={index + 1} compact />
                  <span className="ban-card__state">
                    <BanIcon />
                    {isBanned ? '已 Ban' : '加入 Ban'}
                  </span>
                </button>
              )
            })}
          </div>
        ) : (
          <div className="empty-state">
            <SearchIcon />
            <strong>没有找到符合条件的干员</strong>
            <span>请调整名称、星级或职业筛选。</span>
          </div>
        )}
      </section>
    </main>
  )
}
