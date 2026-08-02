import { useState, type CSSProperties } from 'react'
import type { DrawResult, Operator, OperatorModule, OperatorSkill, Profession } from '../types'
import { ProfessionIcon } from './ProfessionIcon'
import { Stars } from './Stars'

interface OperatorCardProps {
  operator?: Operator
  slot: number
  revealing?: boolean
  compact?: boolean
  portraitScale?: number
  skill?: OperatorSkill
  skillState?: DrawResult['skillState']
  operatorModule?: OperatorModule
  moduleState?: DrawResult['moduleState']
  /** 自选职业模式：该卡位期望的职业；同时用于候选不足的空缺槽。 */
  expectedProfession?: Profession
  /** 自选职业模式：该槽位候选不足，没有抽中干员。 */
  shortage?: boolean
}

type RevealStyle = CSSProperties & { '--reveal-index'?: number }

export function OperatorCard({
  operator,
  slot,
  revealing = false,
  compact = false,
  portraitScale = 1.2,
  skill,
  skillState,
  operatorModule,
  moduleState,
  expectedProfession,
  shortage = false,
}: OperatorCardProps) {
  const [imageFailed, setImageFailed] = useState(false)
  const hasPortrait = Boolean(operator?.portrait) && !imageFailed

  if (!operator) {
    if (expectedProfession) {
      return (
        <article
          className="operator-slot operator-card operator-card--shortage"
          aria-label={`第 ${slot} 个${expectedProfession}名额候选不足`}
        >
          <div className="operator-card__grid" aria-hidden="true"></div>
          <span className="operator-card__class" aria-hidden="true">
            <ProfessionIcon profession={expectedProfession} />
          </span>
          <span className="operator-card__shortage" aria-hidden="true">
            候选不足
          </span>
          <div className="operator-card__footer">
            <span className="operator-card__number">{String(slot).padStart(2, '0')}</span>
            <strong>{expectedProfession}</strong>
          </div>
        </article>
      )
    }
    return (
      <article className="operator-slot operator-slot--empty" aria-label={`空卡位 ${slot}`}>
        <span className="slot-index">{String(slot).padStart(2, '0')}</span>
        <span className="slot-plus" aria-hidden="true"></span>
        <span className="slot-caption">EMPTY SLOT</span>
      </article>
    )
  }

  return (
    <article
      className={`operator-slot operator-card${revealing ? ' operator-card--revealing' : ''}${compact ? ' operator-card--compact' : ''}${shortage ? ' operator-card--shortage' : ''}`}
      style={{ '--reveal-index': slot - 1 } as RevealStyle}
      aria-label={`${operator.name}，${operator.rarity} 星，${expectedProfession ?? operator.profession}${skill ? `，技能 ${skill.index}，${skill.name}` : skillState === 'unavailable' ? '，无技能' : skillState === 'missing' ? '，技能未收录' : ''}${operatorModule ? `，模组 ${operatorModule.name}` : moduleState === 'unavailable' ? '，无模组' : moduleState === 'missing' ? '，模组未收录' : ''}`}
    >
      <div className="operator-card__grid" aria-hidden="true"></div>
      <span className="operator-card__class" title={expectedProfession ?? operator.profession} aria-hidden="true">
        <ProfessionIcon profession={expectedProfession ?? operator.profession} />
      </span>
      <Stars count={operator.rarity} compact={compact} />
      <div className={`operator-card__portrait${hasPortrait ? '' : ' operator-card__portrait--fallback'}`}>
        {hasPortrait ? (
          <img
            src={operator.portrait}
            alt=""
            style={{ transform: `scale(${portraitScale})` }}
            onError={() => setImageFailed(true)}
          />
        ) : (
          <span aria-hidden="true">{operator.name.slice(0, 1)}</span>
        )}
      </div>
      <div className="operator-card__slash" aria-hidden="true"></div>
      {skill && (
        <div className="operator-card__skill" title={`技能 ${skill.index} · ${skill.name}`}>
          <span>技能 {skill.index}</span>
          <strong>{skill.name}</strong>
        </div>
      )}
      {!skill && skillState && (
        <div className="operator-card__skill operator-card__skill--muted">
          <strong>{skillState === 'unavailable' ? '无技能' : '技能未收录'}</strong>
        </div>
      )}
      {operatorModule && (
        <div className="operator-card__module" title={`模组 ${operatorModule.name}`}>
          <span>模组</span>
          <strong>{operatorModule.name}</strong>
        </div>
      )}
      {!operatorModule && moduleState && (
        <div className="operator-card__module operator-card__module--muted">
          <strong>{moduleState === 'unavailable' ? '无模组' : '模组未收录'}</strong>
        </div>
      )}
      <div className="operator-card__footer">
        <span className="operator-card__number">{String(slot).padStart(2, '0')}</span>
        <strong>{operator.name}</strong>
      </div>
    </article>
  )
}