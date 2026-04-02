import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Play, ListPlus, Radio, Heart, Download, ChevronRight, User, Disc3, ListMusic, Plus, Info } from 'lucide-react';
import LastfmIcon from './LastfmIcon';
import { lastfmLoveTrack, lastfmUnloveTrack } from '../api/lastfm';
import { usePlayerStore, Track, songToTrack } from '../store/playerStore';
import { SubsonicAlbum, SubsonicArtist, star, unstar, getSimilarSongs2, getTopSongs, buildDownloadUrl, getAlbum, getPlaylists, getPlaylist, createPlaylist, updatePlaylist, SubsonicPlaylist } from '../api/subsonic';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { useDownloadModalStore } from '../store/downloadModalStore';
import { usePlaylistStore } from '../store/playlistStore';
import { open } from '@tauri-apps/plugin-shell';
import { writeFile } from '@tauri-apps/plugin-fs';
import { join } from '@tauri-apps/api/path';
import { useTranslation } from 'react-i18next';

function sanitizeFilename(name: string): string {
  return name
    .replace(/[/\\?%*:|"<>]/g, '-')
    .replace(/\.{2,}/g, '.')
    .replace(/^[\s.]+|[\s.]+$/g, '')
    .substring(0, 200) || 'download';
}

// ── Add-to-Playlist submenu ───────────────────────────────────────
export function AddToPlaylistSubmenu({ songIds, onDone, dropDown }: { songIds: string[]; onDone: () => void; dropDown?: boolean }) {
  const { t } = useTranslation();
  const subRef = useRef<HTMLDivElement>(null);
  const newNameRef = useRef<HTMLInputElement>(null);
  const [playlists, setPlaylists] = useState<SubsonicPlaylist[]>([]);
  const [adding, setAdding] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [flipLeft, setFlipLeft] = useState(false);
  const touchPlaylist = usePlaylistStore((s) => s.touchPlaylist);
  const recentIds = usePlaylistStore((s) => s.recentIds);

  useEffect(() => {
    getPlaylists().then((all) => {
      const sorted = [...all].sort((a, b) => {
        const ai = recentIds.indexOf(a.id);
        const bi = recentIds.indexOf(b.id);
        if (ai === -1 && bi === -1) return a.name.localeCompare(b.name);
        if (ai === -1) return 1;
        if (bi === -1) return -1;
        return ai - bi;
      });
      setPlaylists(sorted);
    }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Flip submenu left if it would overflow the right edge of the viewport
  useLayoutEffect(() => {
    if (subRef.current) {
      const rect = subRef.current.getBoundingClientRect();
      if (rect.right > window.innerWidth - 8) setFlipLeft(true);
    }
  }, []);

  useEffect(() => {
    if (creating) newNameRef.current?.focus();
  }, [creating]);

  const handleAdd = async (pl: SubsonicPlaylist) => {
    setAdding(pl.id);
    try {
      const { songs } = await getPlaylist(pl.id);
      const existingIds = new Set(songs.map((s) => s.id));
      const newIds = songIds.filter((id) => !existingIds.has(id));
      if (newIds.length > 0) {
        await updatePlaylist(pl.id, [...songs.map((s) => s.id), ...newIds]);
      }
      touchPlaylist(pl.id);
    } catch {}
    setAdding(null);
    onDone();
  };

  const handleCreate = async () => {
    const name = newName.trim() || t('playlists.unnamed');
    try {
      const pl = await createPlaylist(name, songIds);
      if (pl?.id) touchPlaylist(pl.id);
    } catch {}
    onDone();
  };

  const subStyle: React.CSSProperties = dropDown
    ? { top: 'calc(100% + 4px)', left: 0, right: 'auto' }
    : flipLeft
      ? { right: 'calc(100% + 4px)', left: 'auto' }
      : { left: 'calc(100% + 4px)', right: 'auto' };

  return (
    <div className="context-submenu" ref={subRef} style={subStyle}>
      {/* New Playlist row */}
      {!creating ? (
        <div
          className="context-menu-item context-submenu-new"
          onClick={e => { e.stopPropagation(); setCreating(true); }}
        >
          <Plus size={13} /> {t('playlists.newPlaylist')}
        </div>
      ) : (
        <div className="context-submenu-create" onClick={e => e.stopPropagation()}>
          <input
            ref={newNameRef}
            className="context-submenu-input"
            placeholder={t('playlists.createName')}
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') handleCreate();
              if (e.key === 'Escape') { setCreating(false); setNewName(''); }
            }}
          />
          <button className="context-submenu-create-btn" onClick={handleCreate}>
            <Plus size={13} />
          </button>
        </div>
      )}

      <div className="context-menu-divider" />

      {playlists.length === 0 && (
        <div className="context-submenu-empty">{t('playlists.empty')}</div>
      )}
      {playlists.map((pl) => (
        <div
          key={pl.id}
          className="context-menu-item"
          onClick={() => handleAdd(pl)}
          style={{ opacity: adding === pl.id ? 0.5 : 1, pointerEvents: adding ? 'none' : undefined }}
        >
          <ListMusic size={13} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pl.name}</span>
        </div>
      ))}
    </div>
  );
}

// Same as AddToPlaylistSubmenu but resolves album songs first
function AlbumToPlaylistSubmenu({ albumId, onDone }: { albumId: string; onDone: () => void }) {
  const [resolvedIds, setResolvedIds] = useState<string[] | null>(null);

  useEffect(() => {
    getAlbum(albumId).then((data) => {
      setResolvedIds(data.songs.map((s) => s.id));
    }).catch(() => setResolvedIds([]));
  }, [albumId]);

  if (resolvedIds === null) {
    return (
      <div className="context-submenu" style={{ display: 'flex', justifyContent: 'center', padding: '0.75rem' }}>
        <div className="spinner" style={{ width: 16, height: 16 }} />
      </div>
    );
  }
  if (resolvedIds.length === 0) return null;
  return <AddToPlaylistSubmenu songIds={resolvedIds} onDone={onDone} />;
}

export default function ContextMenu() {
  const { t } = useTranslation();
  const { contextMenu, closeContextMenu, playTrack, enqueue, queue, currentTrack, removeTrack, lastfmLovedCache, setLastfmLovedForSong, starredOverrides, setStarredOverride, openSongInfo } = usePlayerStore();
  const auth = useAuthStore();
  const requestDownloadFolder = useDownloadModalStore(s => s.requestFolder);
  const navigate = useNavigate();
  const menuRef = useRef<HTMLDivElement>(null);

  // Adjusted coordinates to keep menu on screen
  const [coords, setCoords] = useState({ x: 0, y: 0 });
  const [playlistSubmenuOpen, setPlaylistSubmenuOpen] = useState(false);
  const [playlistSongIds, setPlaylistSongIds] = useState<string[]>([]);

  useEffect(() => {
    if (contextMenu.isOpen) {
      setCoords({ x: contextMenu.x, y: contextMenu.y });
      setPlaylistSubmenuOpen(false);
      setPlaylistSongIds([]);
    }
  }, [contextMenu.isOpen, contextMenu.x, contextMenu.y]);

  useEffect(() => {
    if (contextMenu.isOpen && menuRef.current) {
      const rect = menuRef.current.getBoundingClientRect();
      const winW = window.innerWidth;
      const winH = window.innerHeight;
      let finalX = contextMenu.x;
      let finalY = contextMenu.y;
      if (finalX + rect.width > winW) finalX = winW - rect.width - 10;
      if (finalY + rect.height > winH) finalY = winH - rect.height - 10;
      setCoords({ x: finalX, y: finalY });
    }
  }, [contextMenu.isOpen, contextMenu.x, contextMenu.y]);

  if (!contextMenu.isOpen || !contextMenu.item) return null;

  const { type, item, queueIndex } = contextMenu;

  const isStarred = (id: string, itemStarred?: string) =>
    id in starredOverrides ? starredOverrides[id] : !!itemStarred;

  const handleAction = async (action: () => void | Promise<void>) => {
    closeContextMenu();
    await action();
  };

  const startRadio = async (artistId: string, artistName: string) => {
    try {
      const similar = await getSimilarSongs2(artistId);
       if (similar.length > 0) {
         const top = await getTopSongs(artistName);
         const radioTracks = [...top, ...similar].map(songToTrack);
         playTrack(radioTracks[0], radioTracks);
       }
    } catch (e) {
      console.error('Failed to start radio', e);
    }
  };

  const downloadAlbum = async (albumName: string, albumId: string) => {
    try {
      const folder = auth.downloadFolder || await requestDownloadFolder();
      if (!folder) return;

      const url = buildDownloadUrl(albumId);
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      const buffer = await blob.arrayBuffer();
      const path = await join(folder, `${sanitizeFilename(albumName)}.zip`);
      await writeFile(path, new Uint8Array(buffer));
    } catch (e) {
      console.error('Download failed:', e);
    }
  };

  return (
    <>
      {/* Transparent backdrop — catches all outside clicks cleanly, preventing freeze */}
      <div
        style={{ position: 'fixed', inset: 0, zIndex: 998 }}
        onMouseDown={() => closeContextMenu()}
      />
      <div
        ref={menuRef}
        className="context-menu animate-fade-in"
        style={{ left: coords.x, top: coords.y, zIndex: 999 }}
      >
        {(type === 'song' || type === 'album-song') && (() => {
          const song = item as Track;
          return (
            <>
              <div className="context-menu-item" onClick={() => handleAction(() => playTrack(song, [song]))}>
                <Play size={14} /> {t('contextMenu.playNow')}
              </div>
              <div className="context-menu-item" onClick={() => handleAction(() => {
                if (!currentTrack) {
                  playTrack(song, [song]);
                  return;
                }
                const currentIdx = usePlayerStore.getState().queueIndex;
                const newQueue = [...queue];
                newQueue.splice(currentIdx + 1, 0, song);
                usePlayerStore.setState({ queue: newQueue });
              })}>
                <ChevronRight size={14} /> {t('contextMenu.playNext')}
              </div>
              <div className="context-menu-item" onClick={() => handleAction(() => enqueue([song]))}>
                <ListPlus size={14} /> {t('contextMenu.addToQueue')}
              </div>
              <div
                className={`context-menu-item context-menu-item--submenu ${playlistSubmenuOpen && playlistSongIds[0] === song.id ? 'active' : ''}`}
                onMouseEnter={() => { setPlaylistSongIds([song.id]); setPlaylistSubmenuOpen(true); }}
                onMouseLeave={() => setPlaylistSubmenuOpen(false)}
              >
                <ListMusic size={14} /> {t('contextMenu.addToPlaylist')}
                <ChevronRight size={13} style={{ marginLeft: 'auto' }} />
                {playlistSubmenuOpen && playlistSongIds[0] === song.id && (
                  <AddToPlaylistSubmenu songIds={[song.id]} onDone={() => { setPlaylistSubmenuOpen(false); closeContextMenu(); }} />
                )}
              </div>
             {type === 'album-song' && (
                 <div className="context-menu-item" onClick={() => handleAction(async () => {
                   const albumData = await getAlbum(song.albumId);
                   const tracks = albumData.songs.map(songToTrack);
                   enqueue(tracks);
                 })}>
                  <ListPlus size={14} /> {t('contextMenu.enqueueAlbum')}
                </div>
              )}
              <div className="context-menu-divider" />
              {song.albumId && (
                <div className="context-menu-item" onClick={() => handleAction(() => navigate(`/album/${song.albumId}`))}>
                  <Disc3 size={14} /> {t('contextMenu.openAlbum')}
                </div>
              )}
              <div className="context-menu-item" onClick={() => handleAction(() => startRadio(song.artistId ?? song.artist, song.artist))}>
                <Radio size={14} /> {t('contextMenu.startRadio')}
              </div>
              <div className="context-menu-item" onClick={() => handleAction(() => {
                const starred = isStarred(song.id, song.starred);
                setStarredOverride(song.id, !starred);
                return starred ? unstar(song.id, 'song') : star(song.id, 'song');
              })}>
                <Heart size={14} fill={isStarred(song.id, song.starred) ? 'currentColor' : 'none'} />
                {isStarred(song.id, song.starred) ? t('contextMenu.unfavorite') : t('contextMenu.favorite')}
              </div>
              {auth.lastfmSessionKey && (() => {
                const loveKey = `${song.title}::${song.artist}`;
                const loved = lastfmLovedCache[loveKey] ?? false;
                return (
                  <div className="context-menu-item" onClick={() => handleAction(() => {
                    const newLoved = !loved;
                    setLastfmLovedForSong(song.title, song.artist, newLoved);
                    if (newLoved) lastfmLoveTrack(song, auth.lastfmSessionKey);
                    else lastfmUnloveTrack(song, auth.lastfmSessionKey);
                  })}>
                    <LastfmIcon size={14} />
                    {loved ? t('contextMenu.lfmUnlove') : t('contextMenu.lfmLove')}
                  </div>
                );
              })()}
              <div className="context-menu-divider" />
              <div className="context-menu-item" onClick={() => handleAction(() => openSongInfo(song.id))}>
                <Info size={14} /> {t('contextMenu.songInfo')}
              </div>
            </>
          );
        })()}

        {type === 'album' && (() => {
          const album = item as SubsonicAlbum;
          return (
            <>
              <div className="context-menu-item" onClick={() => handleAction(() => navigate(`/album/${album.id}`))}>
                <Play size={14} /> {t('contextMenu.openAlbum')}
              </div>
              <div className="context-menu-divider" />
              <div className="context-menu-item" onClick={() => handleAction(() => navigate(`/artist/${album.artistId}`))}>
                <User size={14} /> {t('contextMenu.goToArtist')}
              </div>
              <div className="context-menu-item" onClick={() => handleAction(() => {
                const starred = isStarred(album.id, album.starred);
                setStarredOverride(album.id, !starred);
                return starred ? unstar(album.id, 'album') : star(album.id, 'album');
              })}>
                <Heart size={14} fill={isStarred(album.id, album.starred) ? 'currentColor' : 'none'} />
                {isStarred(album.id, album.starred) ? t('contextMenu.unfavoriteAlbum') : t('contextMenu.favoriteAlbum')}
              </div>
              <div className="context-menu-item" onClick={() => handleAction(() => downloadAlbum(album.name, album.id))}>
                <Download size={14} /> {t('contextMenu.download')}
              </div>
              <div
                className={`context-menu-item context-menu-item--submenu ${playlistSubmenuOpen && playlistSongIds[0] === `album:${album.id}` ? 'active' : ''}`}
                onMouseEnter={() => { setPlaylistSongIds([`album:${album.id}`]); setPlaylistSubmenuOpen(true); }}
                onMouseLeave={() => setPlaylistSubmenuOpen(false)}
              >
                <ListMusic size={14} /> {t('contextMenu.addToPlaylist')}
                <ChevronRight size={13} style={{ marginLeft: 'auto' }} />
                {playlistSubmenuOpen && playlistSongIds[0] === `album:${album.id}` && (
                  <AlbumToPlaylistSubmenu albumId={album.id} onDone={() => { setPlaylistSubmenuOpen(false); closeContextMenu(); }} />
                )}
              </div>
            </>
          );
        })()}

        {type === 'artist' && (() => {
          const artist = item as SubsonicArtist;
          return (
            <>
              <div className="context-menu-item" onClick={() => handleAction(() => startRadio(artist.id, artist.name))}>
                <Radio size={14} /> {t('contextMenu.startRadio')}
              </div>
              <div className="context-menu-divider" />
              <div className="context-menu-item" onClick={() => handleAction(() => {
                const starred = isStarred(artist.id, artist.starred);
                setStarredOverride(artist.id, !starred);
                return starred ? unstar(artist.id, 'artist') : star(artist.id, 'artist');
              })}>
                <Heart size={14} fill={isStarred(artist.id, artist.starred) ? 'currentColor' : 'none'} />
                {isStarred(artist.id, artist.starred) ? t('contextMenu.unfavoriteArtist') : t('contextMenu.favoriteArtist')}
              </div>
            </>
          );
        })()}

        {type === 'queue-item' && (() => {
          const song = item as Track;
          return (
            <>
              <div className="context-menu-item" onClick={() => handleAction(() => playTrack(song, queue))}>
                <Play size={14} /> {t('contextMenu.playNow')}
              </div>
              <div className="context-menu-item" style={{ color: 'var(--danger)' }} onClick={() => handleAction(() => {
                if (queueIndex !== undefined) removeTrack(queueIndex);
              })}>
                {t('contextMenu.removeFromQueue')}
              </div>
              <div
                className={`context-menu-item context-menu-item--submenu ${playlistSubmenuOpen && playlistSongIds[0] === song.id ? 'active' : ''}`}
                onMouseEnter={() => { setPlaylistSongIds([song.id]); setPlaylistSubmenuOpen(true); }}
                onMouseLeave={() => setPlaylistSubmenuOpen(false)}
              >
                <ListMusic size={14} /> {t('contextMenu.addToPlaylist')}
                <ChevronRight size={13} style={{ marginLeft: 'auto' }} />
                {playlistSubmenuOpen && playlistSongIds[0] === song.id && (
                  <AddToPlaylistSubmenu songIds={[song.id]} onDone={() => { setPlaylistSubmenuOpen(false); closeContextMenu(); }} />
                )}
              </div>
              <div className="context-menu-divider" />
              {song.albumId && (
                <div className="context-menu-item" onClick={() => handleAction(() => navigate(`/album/${song.albumId}`))}>
                  <Disc3 size={14} /> {t('contextMenu.openAlbum')}
                </div>
              )}
              <div className="context-menu-item" onClick={() => handleAction(() => {
                const starred = isStarred(song.id, song.starred);
                setStarredOverride(song.id, !starred);
                return starred ? unstar(song.id, 'song') : star(song.id, 'song');
              })}>
                <Heart size={14} fill={isStarred(song.id, song.starred) ? 'currentColor' : 'none'} />
                {isStarred(song.id, song.starred) ? t('contextMenu.unfavorite') : t('contextMenu.favorite')}
              </div>
              {auth.lastfmSessionKey && (() => {
                const loveKey = `${song.title}::${song.artist}`;
                const loved = lastfmLovedCache[loveKey] ?? false;
                return (
                  <div className="context-menu-item" onClick={() => handleAction(() => {
                    const newLoved = !loved;
                    setLastfmLovedForSong(song.title, song.artist, newLoved);
                    if (newLoved) lastfmLoveTrack(song, auth.lastfmSessionKey);
                    else lastfmUnloveTrack(song, auth.lastfmSessionKey);
                  })}>
                    <LastfmIcon size={14} />
                    {loved ? t('contextMenu.lfmUnlove') : t('contextMenu.lfmLove')}
                  </div>
                );
              })()}
              <div className="context-menu-item" onClick={() => handleAction(() => startRadio(song.artistId ?? song.artist, song.artist))}>
                <Radio size={14} /> {t('contextMenu.startRadio')}
              </div>
              <div className="context-menu-divider" />
              <div className="context-menu-item" onClick={() => handleAction(() => openSongInfo(song.id))}>
                <Info size={14} /> {t('contextMenu.songInfo')}
              </div>
            </>
          );
        })()}
      </div>
    </>
  );
}
