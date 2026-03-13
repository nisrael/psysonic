import React, { useEffect, useState, useCallback } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import Sidebar from './components/Sidebar';
import PlayerBar from './components/PlayerBar';
import LiveSearch from './components/LiveSearch';
import NowPlayingDropdown from './components/NowPlayingDropdown';
import QueuePanel from './components/QueuePanel';
import Home from './pages/Home';
import Albums from './pages/Albums';
import Artists from './pages/Artists';
import ArtistDetail from './pages/ArtistDetail';
import NewReleases from './pages/NewReleases';
import Favorites from './pages/Favorites';
import RandomMix from './pages/RandomMix';
import Settings from './pages/Settings';
import Login from './pages/Login';
import AlbumDetail from './pages/AlbumDetail';
import LabelAlbums from './pages/LabelAlbums';
import Statistics from './pages/Statistics';
import Playlists from './pages/Playlists';
import Help from './pages/Help';
import RandomAlbums from './pages/RandomAlbums';
import FullscreenPlayer from './components/FullscreenPlayer';
import ContextMenu from './components/ContextMenu';
import { useAuthStore } from './store/authStore';
import { usePlayerStore } from './store/playerStore';
import { useThemeStore } from './store/themeStore';

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { isLoggedIn, servers, activeServerId } = useAuthStore();
  if (!isLoggedIn || !activeServerId || servers.length === 0) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function AppShell() {
  const isFullscreenOpen = usePlayerStore(s => s.isFullscreenOpen);
  const toggleFullscreen = usePlayerStore(s => s.toggleFullscreen);
  const isQueueVisible = usePlayerStore(s => s.isQueueVisible);
  const initializeFromServerQueue = usePlayerStore(s => s.initializeFromServerQueue);
  const currentTrack = usePlayerStore(s => s.currentTrack);
  const isPlaying = usePlayerStore(s => s.isPlaying);

  useEffect(() => {
    initializeFromServerQueue();
  }, [initializeFromServerQueue]);

  useEffect(() => {
    const fn = async () => {
      try {
        const appWindow = getCurrentWindow();
        if (currentTrack) {
          const state = isPlaying ? '▶' : '⏸';
          const title = `${state} ${currentTrack.artist} - ${currentTrack.title} | Psysonic`;
          document.title = title;
          await appWindow.setTitle(title);
        } else {
          document.title = 'Psysonic';
          await appWindow.setTitle('Psysonic');
        }
      } catch (err) {}
    };
    fn();
  }, [currentTrack, isPlaying]);

  const [sidebarWidth, setSidebarWidth] = useState(220);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => {
    return localStorage.getItem('psysonic_sidebar_collapsed') === 'true';
  });
  const [queueWidth, setQueueWidth] = useState(300);
  const [isDraggingSidebar, setIsDraggingSidebar] = useState(false);
  const [isDraggingQueue, setIsDraggingQueue] = useState(false);

  useEffect(() => {
    localStorage.setItem('psysonic_sidebar_collapsed', isSidebarCollapsed.toString());
  }, [isSidebarCollapsed]);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (isDraggingSidebar) {
      // Limit sidebar width between 180px and 400px
      const newWidth = Math.max(180, Math.min(e.clientX, 400));
      setSidebarWidth(newWidth);
    } else if (isDraggingQueue) {
      // Limit queue width between 250px and 500px. Queue is on the right.
      const newWidth = Math.max(250, Math.min(window.innerWidth - e.clientX, 500));
      setQueueWidth(newWidth);
    }
  }, [isDraggingSidebar, isDraggingQueue]);

  const handleMouseUp = useCallback(() => {
    setIsDraggingSidebar(false);
    setIsDraggingQueue(false);
  }, []);

  useEffect(() => {
    if (isDraggingSidebar || isDraggingQueue) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.classList.add('is-dragging');
    } else {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'default';
      document.body.classList.remove('is-dragging');
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      document.body.classList.remove('is-dragging');
    };
  }, [isDraggingSidebar, isDraggingQueue, handleMouseMove, handleMouseUp]);

  return (
    <div 
      className="app-shell"
      style={{ 
        '--sidebar-width': isSidebarCollapsed ? '72px' : `${sidebarWidth}px`,
        '--queue-width': isQueueVisible ? `${queueWidth}px` : '0px'
      } as React.CSSProperties}
      onContextMenu={e => e.preventDefault()}
    >
      <Sidebar 
        isCollapsed={isSidebarCollapsed} 
        toggleCollapse={() => setIsSidebarCollapsed(!isSidebarCollapsed)} 
      />
      <div 
        className="resizer resizer-sidebar" 
        onMouseDown={(e) => {
          e.preventDefault();
          setIsDraggingSidebar(true);
        }}
        style={{ display: isSidebarCollapsed ? 'none' : 'block' }}
      />
      <main className="main-content">
        <header className="content-header">
          <LiveSearch />
          <div className="spacer" />
          <NowPlayingDropdown />
        </header>
        <div className="content-body" style={{ padding: 0 }}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/albums" element={<Albums />} />
            <Route path="/random-albums" element={<RandomAlbums />} />
            <Route path="/album/:id" element={<AlbumDetail />} />
            <Route path="/artists" element={<Artists />} />
            <Route path="/artist/:id" element={<ArtistDetail />} />
            <Route path="/new-releases" element={<NewReleases />} />
            <Route path="/favorites" element={<Favorites />} />
            <Route path="/random-mix" element={<RandomMix />} />
            <Route path="/playlists" element={<Playlists />} />
            <Route path="/label/:name" element={<LabelAlbums />} />
            <Route path="/statistics" element={<Statistics />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/help" element={<Help />} />
          </Routes>
        </div>
      </main>
      <div 
        className="resizer resizer-queue" 
        onMouseDown={(e) => {
          e.preventDefault();
          setIsDraggingQueue(true);
        }}
        style={{ display: isQueueVisible ? 'block' : 'none' }}
      />
      <QueuePanel />
      <PlayerBar />
      {isFullscreenOpen && (
        <FullscreenPlayer onClose={toggleFullscreen} />
      )}
      <ContextMenu />
    </div>
  );
}

// Tray / media key event handler
function TauriEventBridge() {
  const togglePlay = usePlayerStore(s => s.togglePlay);
  const next = usePlayerStore(s => s.next);
  const previous = usePlayerStore(s => s.previous);
  const { minimizeToTray } = useAuthStore();

  // Spacebar → play/pause, F11 → window fullscreen
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'F11') {
        e.preventDefault();
        const win = getCurrentWindow();
        win.isFullscreen().then(fs => win.setFullscreen(!fs));
        return;
      }
      if (e.code !== 'Space') return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      e.preventDefault();
      togglePlay();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [togglePlay]);

  useEffect(() => {
    const unlisten: Array<() => void> = [];

    listen('media:play-pause', () => togglePlay()).then(u => unlisten.push(u));
    listen('media:next', () => next()).then(u => unlisten.push(u));
    listen('media:prev', () => previous()).then(u => unlisten.push(u));
    listen('tray:play-pause', () => togglePlay()).then(u => unlisten.push(u));
    listen('tray:next', () => next()).then(u => unlisten.push(u));

    // Handle close → minimize to tray if enabled (Tauri 2 approach)
    const win = getCurrentWindow();
    win.onCloseRequested(async (event) => {
      if (minimizeToTray) {
        event.preventDefault();
        await win.hide();
      } else {
        // If not minimizing to tray, we want to exit the app completely
        await invoke('exit_app');
      }
    }).then(u => unlisten.push(u));

    return () => unlisten.forEach(u => u());
  }, [togglePlay, next, previous, minimizeToTray]);

  return null;
}

export default function App() {
  const theme = useThemeStore(s => s.theme);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  return (
    <BrowserRouter>
      <TauriEventBridge />
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/*"
          element={
            <RequireAuth>
              <AppShell />
            </RequireAuth>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}
