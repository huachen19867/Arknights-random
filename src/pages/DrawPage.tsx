import type { DataSource, DrawResult, DrawSettings, Operator } from '../types'
import { OperatorCard } from '../components/OperatorCard'
import { ShuffleIcon } from '../components/Icons'
import { getEffectiveDrawConfig } from '../lib/settings'
import type { ProfessionSlotStats } from '../lib/operators'

interface DrawPageProps {
  settings: DrawSettings
  candidates: Operator[]
  results: DrawResult[]
  /** 自选职业模式的可满足名额统计；范围模式不传。 */
  planStats?: ProfessionSlotStats
  dataSource: DataSource
  loading: boolean
  drawing: boolean
  notice: string
  onDraw: () => void
}

export function DrawPage({
  settings,
  candidates,
  results,
  planStats,
  dataSource,
  loading,
  drawing,
  notice,
  onDraw,
}: DrawPageProps) {
  const effective = getEffectiveDrawConfig(settings)
  const planActive = effective.drawMode === 'profession-plan'
  const planEmpty = planActive && effective.count === 0
  const startDisabled = drawing || loading || (planActive ? planEmpty : candidates.length === 0)
  const defaultNotice = planActive
    ? planEmpty
      ? '尚未添加职业名额，请在抽取设置中添加职业名额。'
      : '职业方案就绪，可以开始抽取'
    : candidates.length === 0
      ? '没有符合当前条件的干员，请调整星级、职业或 Ban 名单。'
      : '筛选条件就绪，可以开始抽取'

  return (
    <main className="draw-page" data-screen-label="抽取主界面">
      <section className="squad-board" aria-labelledby="squad-title">
        {dataSource === 'fallback' && !loading && (
          <div className="demo-banner" role="alert">
            <strong>示例数据模式</strong>
            <span>未读取到飞书干员库导出文件，当前仅用于功能体验。</span>
          </div>
        )}
        <div className="board-heading">
          <div className="board-heading__meta">
            <span>目标人数</span>
            <strong>{String(effective.count).padStart(2, '0')}</strong>
          </div>
        </div>

        <div className="squad-layout">
          <div className="operator-grid" aria-live="polite" aria-busy={drawing}>
            {Array.from({ length: 12 }, (_, index) => {
              const result = results[index]
              return (
                <OperatorCard
                  key={`${index}-${result?.operator?.id ?? result?.expectedProfession ?? 'empty'}`}
                  slot={index + 1}
                  operator={result?.operator}
                  expectedProfession={result?.expectedProfession}
                  shortage={result?.shortage}
                  skill={result?.skill}
                  skillState={result?.skillState}
                  operatorModule={result?.module}
                  moduleState={result?.moduleState}
                  revealing={drawing}
                />
              )
            })}
          </div>

          <aside className="draw-rail">
            <div className="draw-rail__pool">
              <span>{planActive ? 'PLAN SLOTS' : 'CANDIDATES'}</span>
              <strong>
                {planActive
                  ? `${planStats?.satisfiable ?? 0} / ${planStats?.total ?? 0}`
                  : loading
                    ? '--'
                    : candidates.length}
              </strong>
              <small>{planActive ? '可满足名额' : '当前候选池'}</small>
            </div>
            <button
              className="draw-button"
              type="button"
              onClick={onDraw}
              disabled={startDisabled}
              aria-label="开始抽取"
            >
              <span className="draw-button__scan" aria-hidden="true"></span>
              <ShuffleIcon />
              <strong className="draw-button__label">
                <span>开始</span>
                <span>抽取</span>
              </strong>
            </button>
          </aside>
        </div>

        <div className="status-strip" role="status">
          <span className={`source-light${dataSource === 'fallback' ? ' source-light--warning' : ''}`}></span>
          <span>
            {dataSource === 'feishu-export' ? '飞书干员库快照已载入' : '当前为内置样例数据'}
          </span>
          <i></i>
          <span>{notice || defaultNotice}</span>
        </div>
      </section>
    </main>
  )
}