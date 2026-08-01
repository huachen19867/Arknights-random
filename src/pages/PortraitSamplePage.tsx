import { OperatorCard } from '../components/OperatorCard'
import type { Operator } from '../types'

const SAMPLE_NAMES = ['银灰', '艾雅法拉', '能天使', '史尔特尔', '泥岩']

interface PortraitSamplePageProps {
  operators: Operator[]
  onBack: () => void
}

export function PortraitSamplePage({ operators, onBack }: PortraitSamplePageProps) {
  const samples = SAMPLE_NAMES.map((name) => operators.find((operator) => operator.name === name)).filter(
    (operator): operator is Operator => Boolean(operator),
  )

  return (
    <main className="panel-page portrait-sample-page" data-screen-label="立绘缩放样本">
      <section className="portrait-sample-panel" aria-labelledby="portrait-sample-title">
        <div className="panel-titlebar">
          <button className="portrait-sample-back" type="button" onClick={onBack}>
            返回抽取页
          </button>
          <div>
            <span className="eyebrow">PORTRAIT SCALE TEST / 01</span>
            <h1 id="portrait-sample-title">中心放大 30% 样本</h1>
          </div>
        </div>

        <p className="portrait-sample-note">
          每组左侧为当前效果，右侧为保持图片中心不变并放大至 130%。卡片框、名称与遮罩均保持正式产品尺寸逻辑。
        </p>

        <div className="portrait-sample-grid">
          {samples.map((operator, index) => (
            <section className="portrait-sample" key={operator.id} aria-labelledby={`sample-${operator.id}`}>
              <h2 id={`sample-${operator.id}`}>{operator.name}</h2>
              <div className="portrait-sample__pair">
                <div>
                  <span>当前 100%</span>
                  <OperatorCard operator={operator} slot={index + 1} compact />
                </div>
                <div>
                  <span>中心 130%</span>
                  <OperatorCard operator={operator} slot={index + 1} compact portraitScale={1.3} />
                </div>
              </div>
            </section>
          ))}
        </div>
      </section>
    </main>
  )
}
