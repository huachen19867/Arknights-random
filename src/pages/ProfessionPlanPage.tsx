import { useState } from 'react'
import { PROFESSIONS, type DrawSettings, type Profession } from '../types'
import { ArrowIcon, PlanIcon } from '../components/Icons'
import { ProfessionIcon } from '../components/ProfessionIcon'
import { MAX_PROFESSION_SLOTS } from '../lib/settings'

interface ProfessionPlanPageProps {
  settings: DrawSettings
  onChange: (settings: DrawSettings) => void
  onBack: () => void
  /** 切换为自选职业模式并返回抽取界面。 */
  onUsePlan: () => void
}

export function ProfessionPlanPage({ settings, onChange, onBack, onUsePlan }: ProfessionPlanPageProps) {
  const [notice, setNotice] = useState('')
  const slots = settings.professionSlots

  const addSlot = (profession: Profession) => {
    if (slots.length >= MAX_PROFESSION_SLOTS) {
      setNotice(`已达到 ${MAX_PROFESSION_SLOTS} 个职业名额`)
      return
    }
    setNotice('')
    onChange({ ...settings, drawMode: 'profession-plan', professionSlots: [...slots, profession] })
  }

  const selectAll = () => {
    setNotice('')
    onChange({ ...settings, drawMode: 'profession-plan', professionSlots: [...PROFESSIONS] })
  }

  const clearAll = () => {
    setNotice('')
    onChange({ ...settings, professionSlots: [] })
  }

  const removeSlot = (index: number) => {
    setNotice('')
    onChange({ ...settings, professionSlots: slots.filter((_, slotIndex) => slotIndex !== index) })
  }

  const usePlan = () => {
    onChange({ ...settings, drawMode: 'profession-plan' })
    onUsePlan()
  }

  const switchToRange = () => {
    setNotice('')
    onChange({ ...settings, drawMode: 'range' })
  }

  return (
    <main className="panel-page plan-page" data-screen-label="自选职业">
      <section className="plan-panel">
        <div className="panel-titlebar">
          <button className="back-button" type="button" onClick={onBack} aria-label="返回抽取界面">
            <ArrowIcon />
          </button>
          <div>
            <span className="eyebrow">PROFESSION PLAN / 04</span>
            <h1>自选职业</h1>
          </div>
          <div className="plan-readout" aria-label={`已添加 ${slots.length} 个职业名额`}>
            <span>职业名额</span>
            <strong>
              {slots.length}
              <small>/ {MAX_PROFESSION_SLOTS}</small>
            </strong>
          </div>
          <button
            className="clear-all-button"
            type="button"
            onClick={clearAll}
            disabled={slots.length === 0}
          >
            清除所有
          </button>
        </div>

        <div className="plan-toolbar" role="group" aria-label="职业名额工具栏">
          {PROFESSIONS.map((profession) => {
            const count = slots.filter((slot) => slot === profession).length
            return (
              <button
                key={profession}
                type="button"
                className="plan-profession-button"
                onClick={() => addSlot(profession)}
                aria-label={`添加一个${profession}名额`}
                title={profession}
                disabled={slots.length >= MAX_PROFESSION_SLOTS}
              >
                <ProfessionIcon profession={profession} />
                <strong>{profession}</strong>
                <small aria-hidden="true">{count > 0 ? `×${count}` : ''}</small>
              </button>
            )
          })}
          <div className="plan-toolbar__actions">
            <button
              type="button"
              className="plan-toolbar-actions__all"
              onClick={selectAll}
              disabled={slots.length >= MAX_PROFESSION_SLOTS}
            >
              全选
            </button>
            <button
              type="button"
              className="plan-toolbar-actions__clear"
              onClick={clearAll}
              disabled={slots.length === 0}
            >
              清除
            </button>
          </div>
        </div>

        {slots.length > 0 ? (
          <div className="plan-slot-grid" aria-label="已添加的职业名额">
            {slots.map((profession, index) => (
              <button
                type="button"
                key={`${index}-${profession}`}
                className="plan-slot"
                onClick={() => removeSlot(index)}
                aria-label={`移除第 ${index + 1} 个${profession}名额`}
                title={`移除第 ${index + 1} 个${profession}名额`}
              >
                <span className="plan-slot__index">{String(index + 1).padStart(2, '0')}</span>
                <ProfessionIcon profession={profession} />
                <strong>{profession}</strong>
              </button>
            ))}
          </div>
        ) : (
          <div className="plan-empty">
            <PlanIcon />
            <strong>还没有职业名额</strong>
            <span>点击上方职业添加名额，同一职业可重复，最多 {MAX_PROFESSION_SLOTS} 个。</span>
          </div>
        )}

        <div className="plan-status" role="status" aria-live="polite">
          {notice || `已添加 ${slots.length} / ${MAX_PROFESSION_SLOTS} 个职业名额`}
        </div>

        <div className="plan-actions">
          <div className="plan-mode-switch plan-mode-switch--large" role="group" aria-label="自选职业开关">
            <button
              type="button"
              aria-pressed={settings.drawMode === 'profession-plan'}
              onClick={usePlan}
            >
              启用自选职业
            </button>
            <button
              type="button"
              aria-pressed={settings.drawMode !== 'profession-plan'}
              onClick={switchToRange}
            >
              关闭自选职业
            </button>
          </div>
        </div>
      </section>
    </main>
  )
}