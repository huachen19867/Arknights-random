import type { Profession } from '../types'

/**
 * 八职业唯一确定性文件映射；未知职业在类型层面即被拒绝。
 * 图标为 PRTS 提供的 26×26 透明 PNG（见 README 素材权属声明），打包进 public/assets/professions/。
 */
const PROFESSION_ICON_PATHS: Record<Profession, string> = {
  先锋: 'assets/professions/vanguard.png',
  近卫: 'assets/professions/guard.png',
  重装: 'assets/professions/defender.png',
  狙击: 'assets/professions/sniper.png',
  术师: 'assets/professions/caster.png',
  医疗: 'assets/professions/medic.png',
  辅助: 'assets/professions/supporter.png',
  特种: 'assets/professions/specialist.png',
}

interface ProfessionIconProps {
  profession: Profession
  className?: string
}

/** 纯展示职业图标；无障碍名称由调用方提供（aria-label/title），图标本身 alt 为空。 */
export function ProfessionIcon({ profession, className }: ProfessionIconProps) {
  return (
    <img
      className={className}
      src={`${import.meta.env.BASE_URL}${PROFESSION_ICON_PATHS[profession]}`}
      alt=""
      draggable={false}
    />
  )
}