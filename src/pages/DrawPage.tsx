import type { DataSource, DrawResult, DrawSettings, Operator } from '../types'
import { OperatorCard } from '../components/OperatorCard'
import { ShuffleIcon } from '../components/Icons'

interface DrawPageProps {
  settings: DrawSettings
  candidates: Operator[]
  results: DrawResult[]
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
  dataSource,
  loading,
  drawing,
  notice,
  onDraw,
}: DrawPageProps) {
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
          <div>
            <span className="eyebrow">OPERATOR SELECTION / 01</span>
            <h1 id="squad-title">随机编队</h1>
          </div>
          <div className="board-heading__meta">
            <span>目标人数</span>
            <strong>{String(settings.count).padStart(2, '0')}</strong>
          </div>
        </div>

        <div className="squad-layout">
          <div className="operator-grid" aria-live="polite" aria-busy={drawing}>
            {Array.from({ length: 12 }, (_, index) => (
              <OperatorCard
                key={`${index}-${results[index]?.operator.id ?? 'empty'}`}
                slot={index + 1}
                operator={results[index]?.operator}
                skill={results[index]?.skill}
                skillState={results[index]?.skillState}
                revealing={drawing}
              />
            ))}
          </div>

          <aside className="draw-rail">
            <div className="draw-rail__pool">
              <span>CANDIDATES</span>
              <strong>{loading ? '--' : candidates.length}</strong>
              <small>当前候选池</small>
            </div>
            <button
              className="draw-button"
              type="button"
              onClick={onDraw}
              disabled={drawing || loading || candidates.length === 0}
            >
              <span className="draw-button__scan" aria-hidden="true"></span>
              <ShuffleIcon />
              <strong>开始抽取</strong>
            </button>
          </aside>
        </div>

        <div className="status-strip" role="status">
          <span className={`source-light${dataSource === 'fallback' ? ' source-light--warning' : ''}`}></span>
          <span>
            {dataSource === 'feishu-export' ? '飞书干员库快照已载入' : '当前为内置样例数据'}
          </span>
          <i></i>
          <span>
            {notice ||
              (candidates.length === 0
                ? '没有符合当前条件的干员，请调整星级、职业或 Ban 名单。'
                : '筛选条件就绪，可以开始抽取')}
          </span>
        </div>
      </section>
    </main>
  )
}
