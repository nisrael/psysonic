import React, { useEffect, useState } from 'react';
import { usePlayerStore } from '../store/playerStore';
import { useOfflineStore } from '../store/offlineStore';
import { useAuthStore } from '../store/authStore';
import { open } from '@tauri-apps/plugin-shell';
import { version as appVersion } from '../../package.json';
import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Disc3, Users, Music4, Radio, Settings, Heart, BarChart3, Shuffle, ListMusic,
  PanelLeftClose, PanelLeft, HelpCircle, Dices, ArrowUpCircle, AudioLines, HardDriveDownload
} from 'lucide-react';
import PsysonicLogo from './PsysonicLogo';
import PSmallLogo from './PSmallLogo';

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
  const parse = (v: string) => v.replace(/^[^0-9]*/, '').split('.').map(Number);
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
      <div className="update-toast-icon" style={{ marginTop: 'auto' }} data-tooltip={`${t('sidebar.updateAvailable')}: ${latestVersion}`} data-tooltip-pos="bottom">
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
      <button
        className="update-toast-link"
        onClick={() => open('https://github.com/Psychotoxical/psysonic/releases')}
      >
        {t('sidebar.updateLink')}
      </button>
    </div>
  );
}

export default function Sidebar({
  isCollapsed = false,
  toggleCollapse,
}: {
  isCollapsed?: boolean;
  toggleCollapse?: () => void;
}) {
  const { t } = useTranslation();
  const isPlaying   = usePlayerStore(s => s.isPlaying);
  const currentTrack = usePlayerStore(s => s.currentTrack);
  const offlineJobs = useOfflineStore(s => s.jobs);
  const activeJobs = offlineJobs.filter(j => j.status === 'queued' || j.status === 'downloading');
  const offlineAlbums = useOfflineStore(s => s.albums);
  const serverId = useAuthStore(s => s.activeServerId ?? '');
  const hasOfflineContent = Object.values(offlineAlbums).some(a => a.serverId === serverId);
  const [latestVersion, setLatestVersion] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const check = async () => {
      try {
        const res = await fetch('https://api.github.com/repos/Psychotoxical/psysonic/releases/latest');
        if (!res.ok) return;
        const data = await res.json();
        const tag: string = data.tag_name ?? '';
        if (!cancelled && tag && isNewer(tag, appVersion)) {
          setLatestVersion(tag.replace(/^v/i, ''));
        }
      } catch {
        // network unavailable — silently skip
      }
    };

    const initial = setTimeout(check, 1500);
    const interval = setInterval(check, 10 * 60 * 1000); // every 10 minutes

    return () => { cancelled = true; clearTimeout(initial); clearInterval(interval); };
  }, []);

  return (
    <aside className={`sidebar animate-slide-in ${isCollapsed ? 'collapsed' : ''}`}>
      <div className="sidebar-brand">
        {isCollapsed
          ? <PSmallLogo style={{ height: '32px', width: 'auto' }} />
          : <PsysonicLogo style={{ height: '28px', width: 'auto' }} />
        }
      </div>

      <button
        className="collapse-btn"
        onClick={toggleCollapse}
        data-tooltip={isCollapsed ? t('sidebar.expand') : t('sidebar.collapse')}
        data-tooltip-pos="right"
      >
        {isCollapsed ? <PanelLeft size={14} /> : <PanelLeftClose size={14} />}
      </button>

      <nav className="sidebar-nav" aria-label="Hauptnavigation">
        {!isCollapsed && <span className="nav-section-label">{t('sidebar.library')}</span>}
        {navItems.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
            data-tooltip={isCollapsed ? t(item.labelKey) : undefined}
            data-tooltip-pos="bottom"
          >
            <item.icon size={isCollapsed ? 22 : 18} />
            {!isCollapsed && <span>{t(item.labelKey)}</span>}
          </NavLink>
        ))}

        {/* Now Playing — special styled */}
        <NavLink
          to="/now-playing"
          className={({ isActive }) => `nav-link nav-link-nowplaying ${isActive ? 'active' : ''}`}
          data-tooltip={isCollapsed ? t('sidebar.nowPlaying') : undefined}
          data-tooltip-pos="bottom"
          style={{ marginTop: 'auto' }}
        >
          <span className="nav-np-icon-wrap">
            <AudioLines size={isCollapsed ? 22 : 18} />
            {isPlaying && currentTrack && <span className="nav-np-dot" />}
          </span>
          {!isCollapsed && <span>{t('sidebar.nowPlaying')}</span>}
        </NavLink>

        {hasOfflineContent && (
          <NavLink
            to="/offline"
            className={({ isActive }) => `nav-link nav-link-offline ${isActive ? 'active' : ''}`}
            data-tooltip={isCollapsed ? t('sidebar.offlineLibrary') : undefined}
            data-tooltip-pos="bottom"
          >
            <HardDriveDownload size={isCollapsed ? 22 : 18} />
            {!isCollapsed && <span>{t('sidebar.offlineLibrary')}</span>}
          </NavLink>
        )}

        {!isCollapsed && <span className="nav-section-label">{t('sidebar.system')}</span>}
        {latestVersion && <UpdateToast isCollapsed={isCollapsed} latestVersion={latestVersion} />}
        <NavLink
          to="/statistics"
          className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
          data-tooltip={isCollapsed ? t('sidebar.statistics') : undefined}
          data-tooltip-pos="bottom"
        >
          <BarChart3 size={isCollapsed ? 22 : 18} />
          {!isCollapsed && <span>{t('sidebar.statistics')}</span>}
        </NavLink>
        <NavLink
          to="/help"
          className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
          data-tooltip={isCollapsed ? t('sidebar.help') : undefined}
          data-tooltip-pos="bottom"
        >
          <HelpCircle size={isCollapsed ? 22 : 18} />
          {!isCollapsed && <span>{t('sidebar.help')}</span>}
        </NavLink>
        <NavLink
          to="/settings"
          className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
          data-tooltip={isCollapsed ? t('sidebar.settings') : undefined}
          data-tooltip-pos="bottom"
        >
          <Settings size={isCollapsed ? 22 : 18} />
          {!isCollapsed && <span>{t('sidebar.settings')}</span>}
        </NavLink>

        {activeJobs.length > 0 && (
          <div
            className={`sidebar-offline-queue ${isCollapsed ? 'sidebar-offline-queue--collapsed' : ''}`}
            data-tooltip={isCollapsed ? t('sidebar.downloadingTracks', { n: activeJobs.length }) : undefined}
            data-tooltip-pos="right"
          >
            <HardDriveDownload size={isCollapsed ? 18 : 14} className="spin-slow" />
            {!isCollapsed && (
              <span>{t('sidebar.downloadingTracks', { n: activeJobs.length })}</span>
            )}
          </div>
        )}
      </nav>
    </aside>
  );
}
