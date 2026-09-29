import { OperatorCard } from '../components/OperatorCard'
import type { SquadPortraitMap } from '../lib/squadPortraits'
import type { Operator } from '../types'

const SAMPLE_IDS = [
  'KZ15',
  'A41',
  'BS04',
  'AA04',
  'R001:术师',
  'R001:医疗',
  'R001:近卫',
  'B00W',
  'JC01',
  'LN02',
  'PL07',
]

interface PortraitSamplePageProps {
  operators: Operator[]
  squadPortraits: SquadPortraitMap
  portraitsLoading: boolean
  onBack: () => void
}

export function PortraitSamplePage({
  operators,
  squadPortraits,
  portraitsLoading,
  onBack,
}: PortraitSamplePageProps) {
  const operatorsById = new Map(operators.map((operator) => [operator.id, operator]))
  const samples = SAMPLE_IDS
    .map((id) => operatorsById.get(id))
    .filter((operator): operator is Operator => Boolean(operator))

  return (
    <main className="panel-page portrait-sample-page" data-screen-label="精二上身卡片样本">
      <section className="portrait-sample-panel" aria-labelledby="portrait-sample-title">
        <div className="panel-titlebar">
          <button className="portrait-sample-back" type="button" onClick={onBack}>
            返回抽取页
          </button>
          <div>
            <span className="eyebrow">SQUAD PORTRAIT REVIEW / 01</span>
            <h1 id="portrait-sample-title">精二上身卡片样本</h1>
          </div>
        </div>

        <p className="portrait-sample-note">
          卡面使用独立的游戏内上身素材，人物从卡片顶部铺开，底部信息条覆盖胸口区域；失败时沿用现有立绘与本地备用图。低星干员没有精二阶段时展示对应可用卡面。
        </p>

        {portraitsLoading ? (
          <p className="portrait-sample-loading" role="status">正在读取编队上身卡面…</p>
        ) : (
          <div className="portrait-sample-grid">
            {samples.map((operator, index) => (
              <section className="portrait-sample" key={operator.id} aria-labelledby={`sample-${operator.id}`}>
                <h2 id={`sample-${operator.id}`}>{operator.name}</h2>
                <p>{operator.rarity} 星 · {operator.profession}</p>
                <OperatorCard
                  operator={operator}
                  squadPortrait={squadPortraits[operator.id]}
                  slot={index + 1}
                  compact
                />
              </section>
            ))}
          </div>
        )}
      </section>
    </main>
  )
}
