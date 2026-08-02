import { PROFESSIONS, RARITIES, type DrawSettings, type Profession, type Rarity } from '../types'
import { ArrowIcon } from '../components/Icons'
import { ProfessionIcon } from '../components/ProfessionIcon'
import { Stars } from '../components/Stars'
import { getEffectiveDrawConfig } from '../lib/settings'

interface SettingsPageProps {
  settings: DrawSettings
  onChange: (settings: DrawSettings) => void
  onBack: () => void
  onGoToProfessionPlan: () => void
  onSwitchToRange: () => void
  candidateCount: number
}

function toggleValue<T>(items: T[], value: T): T[] {
  return items.includes(value) ? items.filter((item) => item !== value) : [...items, value]
}

export function SettingsPage({
  settings,
  onChange,
  onBack,
  onGoToProfessionPlan,
  onSwitchToRange,
  candidateCount,
}: SettingsPageProps) {
  const effective = getEffectiveDrawConfig(settings)
  const planActive = effective.drawMode === 'profession-plan'
  const slotCounts = PROFESSIONS.map((profession) => ({
    profession,
    count: settings.professionSlots.filter((slot) => slot === profession).length,
  })).filter((item) => item.count > 0)
  const planSummary = slotCounts.map((item) => `${item.profession}×${item.count}`).join('、')

  const update = <K extends keyof DrawSettings>(key: K, value: DrawSettings[K]) => {
    onChange({ ...settings, [key]: value })
  }

  return (
    <main className="panel-page" data-screen-label="抽取设置">
      <section className="settings-panel">
        <div className="panel-titlebar">
          <button className="back-button" type="button" onClick={onBack} aria-label="返回抽取界面">
            <ArrowIcon />
          </button>
          <div>
            <span className="eyebrow">FILTER CONFIGURATION / 02</span>
            <h1>抽取设置</h1>
          </div>
          <div className="candidate-readout">
            <span>筛选后可抽取</span>
            <strong>{candidateCount}</strong>
            <small>名干员</small>
          </div>
        </div>

        <div className="settings-grid">
          <section className="setting-section setting-section--wide" aria-labelledby="rarity-label">
            <div className="setting-heading">
              <div>
                <span>01</span>
                <h2 id="rarity-label">星级范围</h2>
              </div>
              <button
                type="button"
                onClick={() =>
                  update('rarities', settings.rarities.length === RARITIES.length ? [] : [...RARITIES])
                }
              >
                {settings.rarities.length === RARITIES.length ? '取消全选' : '全部选择'}
              </button>
            </div>
            <div className="rarity-options">
              {RARITIES.map((rarity) => {
                const selected = settings.rarities.includes(rarity)
                return (
                  <button
                    key={rarity}
                    type="button"
                    className={selected ? 'rarity-option rarity-option--selected' : 'rarity-option'}
                    aria-pressed={selected}
                    onClick={() => update('rarities', toggleValue(settings.rarities, rarity as Rarity))}
                  >
                    <strong>{rarity}</strong>
                    <Stars count={rarity} compact />
                    <span>{selected ? 'INCLUDED' : 'EXCLUDED'}</span>
                  </button>
                )
              })}
            </div>
          </section>

          <section className="setting-section setting-section--wide" aria-labelledby="profession-label">
            <div className="setting-heading">
              <div>
                <span>02</span>
                <h2 id="profession-label">职业范围</h2>
                {planActive && <em className="mode-tag">自选职业模式</em>}
              </div>
              {planActive ? (
                <div className="plan-switch-actions">
                  <button type="button" onClick={onGoToProfessionPlan}>
                    前往自选职业修改
                  </button>
                  <button type="button" onClick={onSwitchToRange}>
                    切换为范围抽取
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() =>
                    update(
                      'professions',
                      settings.professions.length === PROFESSIONS.length ? [] : [...PROFESSIONS],
                    )
                  }
                >
                  {settings.professions.length === PROFESSIONS.length ? '取消全选' : '全部选择'}
                </button>
              )}
            </div>
            {planActive ? (
              <div className="plan-summary-block">
                {slotCounts.length > 0 ? (
                  <div className="plan-slot-chips">
                    {slotCounts.map((item) => (
                      <span key={item.profession} className="plan-slot-chip">
                        <ProfessionIcon profession={item.profession} />
                        {item.profession} ×{item.count}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="plan-summary-empty">尚未添加职业名额。</p>
                )}
                <p className="plan-summary-note">
                  自选职业模式按名额精确配队：每个名额只抽取对应职业。抽取人数固定为名额总数
                  {effective.count}，普通职业范围与人数设置已保留，切换回范围抽取后原样恢复。
                </p>
              </div>
            ) : (
              <div className="profession-options">
                {PROFESSIONS.map((profession) => {
                  const selected = settings.professions.includes(profession)
                  return (
                    <button
                      key={profession}
                      type="button"
                      className={
                        selected ? 'profession-option profession-option--selected' : 'profession-option'
                      }
                      aria-pressed={selected}
                      onClick={() =>
                        update('professions', toggleValue(settings.professions, profession as Profession))
                      }
                      title={profession}
                    >
                      <span className="profession-option__icon" aria-hidden="true">
                        <ProfessionIcon profession={profession} />
                      </span>
                      <strong>{profession}</strong>
                      <small>{selected ? 'ACTIVE' : 'OFFLINE'}</small>
                    </button>
                  )
                })}
              </div>
            )}
          </section>

          <section className="setting-section setting-section--count" aria-labelledby="count-label">
            <div className="setting-heading">
              <div>
                <span>03</span>
                <h2 id="count-label">抽取人数</h2>
              </div>
            </div>
            <div className="count-control">
              <output htmlFor="draw-count">{String(effective.count).padStart(2, '0')}</output>
              <div>
                <input
                  id="draw-count"
                  type="range"
                  min="1"
                  max="12"
                  step="1"
                  value={effective.count}
                  disabled={planActive}
                  onChange={(event) => update('count', Number(event.target.value))}
                />
                <div className="count-ticks" aria-hidden="true">
                  <span>01</span>
                  <span>06</span>
                  <span>12</span>
                </div>
              </div>
            </div>
            {planActive && (
              <p className="count-locked-note">人数由自选职业名额决定，请在自选职业页修改。</p>
            )}
          </section>

          <section className="setting-section setting-section--skill" aria-labelledby="skill-label">
            <div className="setting-heading">
              <div>
                <span>04</span>
                <h2 id="skill-label">随机技能</h2>
              </div>
            </div>
            <p className="skill-setting__description">开启后，为每名抽中干员独立随机一个实际技能。</p>
            <div className="skill-setting__options" role="group" aria-label="是否随机技能">
              <button
                type="button"
                className={
                  settings.randomSkill ? 'skill-setting__option skill-setting__option--selected' : 'skill-setting__option'
                }
                aria-pressed={settings.randomSkill}
                onClick={() => update('randomSkill', true)}
              >
                <strong>是</strong>
                <small>RANDOM</small>
              </button>
              <button
                type="button"
                className={
                  !settings.randomSkill ? 'skill-setting__option skill-setting__option--selected' : 'skill-setting__option'
                }
                aria-pressed={!settings.randomSkill}
                onClick={() => update('randomSkill', false)}
              >
                <strong>否</strong>
                <small>DEFAULT</small>
              </button>
            </div>
          </section>

          <section className="setting-section setting-section--module" aria-labelledby="module-label">
            <div className="setting-heading">
              <div>
                <span>05</span>
                <h2 id="module-label">随机模组</h2>
              </div>
            </div>
            <p className="skill-setting__description">开启后，为每名抽中干员独立随机一个已收录的模组。</p>
            <div className="skill-setting__options" role="group" aria-label="是否随机模组">
              <button
                type="button"
                className={
                  settings.randomModule ? 'skill-setting__option skill-setting__option--selected' : 'skill-setting__option'
                }
                aria-pressed={settings.randomModule}
                onClick={() => update('randomModule', true)}
              >
                <strong>是</strong>
                <small>RANDOM</small>
              </button>
              <button
                type="button"
                className={
                  !settings.randomModule ? 'skill-setting__option skill-setting__option--selected' : 'skill-setting__option'
                }
                aria-pressed={!settings.randomModule}
                onClick={() => update('randomModule', false)}
              >
                <strong>否</strong>
                <small>DEFAULT</small>
              </button>
            </div>
          </section>

          <section className="setting-summary" aria-label="当前设置摘要">
            <span>ACTIVE RULE</span>
            <strong>
              {planActive
                ? `自选职业模式 / ${effective.count} 个名额 / ${planSummary || '尚未添加名额'} / 随机技能${
                    settings.randomSkill ? '开启' : '关闭'
                  } / 随机模组${settings.randomModule ? '开启' : '关闭'}`
                : `${settings.rarities.length} 个星级 / ${settings.professions.length} 个职业 / 抽取 ${settings.count} 人 / 随机技能${
                    settings.randomSkill ? '开启' : '关闭'
                  } / 随机模组${settings.randomModule ? '开启' : '关闭'}`}
            </strong>
            <p>设置会自动保存在当前浏览器中。</p>
          </section>
        </div>
      </section>
    </main>
  )
}