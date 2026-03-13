import React, { useEffect, useState } from 'react';
import { version as appVersion } from '../../package.json';
import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Disc3, Users, Music4, Radio, Settings, Heart, BarChart3, Shuffle, ListMusic,
  PanelLeftClose, PanelLeft, HelpCircle, Dices, ArrowUpCircle
} from 'lucide-react';

const PsysonicLogo = () => (
  <img src="/logo.png" alt="Psysonic Logo" width="36" height="36" style={{ borderRadius: '8px' }} />
);

const navItems = [
  { icon: Disc3, labelKey: 'sidebar.mainstage', to: '/' },
  { icon: Radio, labelKey: 'sidebar.newReleases', to: '/new-releases' },
  { icon: Music4,  labelKey: 'sidebar.allAlbums',    to: '/albums' },
  { icon: Dices,   labelKey: 'sidebar.randomAlbums', to: '/random-albums' },
  { icon: Users, labelKey: 'sidebar.artists', to: '/artists' },
  { icon: ListMusic, labelKey: 'sidebar.playlists', to: '/playlists' },
  { icon: Shuffle, labelKey: 'sidebar.randomMix', to: '/random-mix' },
  { icon: Heart, labelKey: 'sidebar.favorites', to: '/favorites' },
];

function isNewer(latest: string, current: string): boolean {
  const parse = (v: string) => v.replace(/^v/, '').split('.').map(Number);
  const [lMaj, lMin, lPat] = parse(latest);
  const [cMaj, cMin, cPat] = parse(current);
  if (lMaj !== cMaj) return lMaj > cMaj;
  if (lMin !== cMin) return lMin > cMin;
  return lPat > cPat;
}

function UpdateToast({ isCollapsed, latestVersion }: { isCollapsed: boolean; latestVersion: string }) {
  const { t } = useTranslation();

  if (isCollapsed) {
    return (
      <div className="update-toast-icon" style={{ marginTop: 'auto' }} title={`${t('sidebar.updateAvailable')}: ${latestVersion}`}>
        <ArrowUpCircle size={20} />
      </div>
    );
  }

  return (
    <div className="update-toast">
      <div className="update-toast-header">
        <ArrowUpCircle size={14} />
        <span className="update-toast-label">{t('sidebar.updateAvailable')}</span>
      </div>
      <div className="update-toast-version">{t('sidebar.updateReady', { version: latestVersion })}</div>
      <a
        className="update-toast-link"
        href="https://github.com/Psychotoxical/psysonic/releases"
        target="_blank"
        rel="noopener noreferrer"
      >
        {t('sidebar.updateLink')}
      </a>
    </div>
  );
}

export default function Sidebar({
  isCollapsed = false,
  toggleCollapse
}: {
  isCollapsed?: boolean;
  toggleCollapse?: () => void;
}) {
  const { t } = useTranslation();
  const [latestVersion, setLatestVersion] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch('https://api.github.com/repos/Psychotoxical/psysonic/releases/latest');
        if (!res.ok) return;
        const data = await res.json();
        const tag: string = data.tag_name ?? '';
        if (!cancelled && tag && isNewer(tag, appVersion)) {
          setLatestVersion(tag.startsWith('v') ? tag : `v${tag}`);
        }
      } catch {
        // network unavailable — silently skip
      }
    }, 1500);
    return () => { cancelled = true; clearTimeout(timer); };
  }, []);

  return (
    <aside className={`sidebar animate-slide-in ${isCollapsed ? 'collapsed' : ''}`}>
      <div className="sidebar-brand">
        <button 
          className="collapse-btn" 
          onClick={toggleCollapse} 
          title={isCollapsed ? t('sidebar.expand') : t('sidebar.collapse')}
          style={{ padding: 0 }}
        >
          {isCollapsed ? <PanelLeft size={24} /> : <PanelLeftClose size={24} />}
        </button>
        {!isCollapsed && <PsysonicLogo />}
        {!isCollapsed && <span className="brand-name">Psysonic</span>}
      </div>

      <nav className="sidebar-nav" aria-label="Hauptnavigation">
        {!isCollapsed && <span className="nav-section-label">{t('sidebar.library')}</span>}
        {navItems.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
            title={isCollapsed ? t(item.labelKey) : undefined}
          >
            <item.icon size={isCollapsed ? 22 : 18} />
            {!isCollapsed && <span>{t(item.labelKey)}</span>}
          </NavLink>
        ))}

        {!isCollapsed && <span className="nav-section-label" style={{ marginTop: 'auto' }}>{t('sidebar.system')}</span>}
        {latestVersion && <UpdateToast isCollapsed={isCollapsed} latestVersion={latestVersion} />}
        <NavLink
          to="/statistics"
          className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
          style={isCollapsed && !latestVersion ? { marginTop: 'auto' } : undefined}
          title={isCollapsed ? t('sidebar.statistics') : undefined}
        >
          <BarChart3 size={isCollapsed ? 22 : 18} />
          {!isCollapsed && <span>{t('sidebar.statistics')}</span>}
        </NavLink>
        <NavLink
          to="/help"
          className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
          title={isCollapsed ? t('sidebar.help') : undefined}
        >
          <HelpCircle size={isCollapsed ? 22 : 18} />
          {!isCollapsed && <span>{t('sidebar.help')}</span>}
        </NavLink>
        <NavLink
          to="/settings"
          className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
          title={isCollapsed ? t('sidebar.settings') : undefined}
        >
          <Settings size={isCollapsed ? 22 : 18} />
          {!isCollapsed && <span>{t('sidebar.settings')}</span>}
        </NavLink>
      </nav>
    </aside>
  );
}
