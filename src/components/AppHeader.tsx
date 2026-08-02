import type { AppPage } from '../types'
import { BanIcon, SettingsIcon } from './Icons'

interface AppHeaderProps {
  page: AppPage
  onNavigate: (page: AppPage) => void
  bannedCount: number
}

export function AppHeader({ page, onNavigate, bannedCount }: AppHeaderProps) {
  return (
    <header className="app-header">
      <button className="brand" type="button" onClick={() => onNavigate('draw')}>
        <span className="brand__mark" aria-hidden="true">
          <i></i>
          <i></i>
          <i></i>
        </span>
        <span>
          <strong>RHODES / RANDOM</strong>
          <small>罗德岛随机编队终端</small>
        </span>
      </button>

      <nav className="top-nav" aria-label="主要页面">
        <button
          type="button"
          className={page === 'ban' ? 'nav-button nav-button--active' : 'nav-button'}
          onClick={() => onNavigate('ban')}
        >
          <BanIcon />
          <span>Ban 干员</span>
          <b>{bannedCount}</b>
        </button>

        <button
          type="button"
          className={page === 'settings' ? 'nav-button nav-button--active' : 'nav-button'}
          onClick={() => onNavigate('settings')}
        >
          <SettingsIcon />
          <span>抽取设置</span>
        </button>
      </nav>
    </header>
  )
}