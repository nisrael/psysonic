import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Play, ListPlus, Radio, Heart, Download, ChevronRight, User, Disc3, ListMusic, Plus, Info, Sparkles } from 'lucide-react';
import LastfmIcon from './LastfmIcon';
import StarRating from './StarRating';
import { lastfmLoveTrack, lastfmUnloveTrack } from '../api/lastfm';
import { usePlayerStore, Track, songToTrack } from '../store/playerStore';
import { useShallow } from 'zustand/react/shallow';
import { SubsonicAlbum, SubsonicArtist, star, unstar, getSimilarSongs2, getSimilarSongs, getTopSongs, buildDownloadUrl, getAlbum, getPlaylists, getPlaylist, createPlaylist, updatePlaylist, SubsonicPlaylist, setRating } from '../api/subsonic';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { useDownloadModalStore } from '../store/downloadModalStore';
import { usePlaylistStore } from '../store/playlistStore';
import { open } from '@tauri-apps/plugin-shell';
import { join } from '@tauri-apps/api/path';
import { invoke } from '@tauri-apps/api/core';
import { useZipDownloadStore } from '../store/zipDownloadStore';
import { useTranslation } from 'react-i18next';
import { showToast } from '../utils/toast';

function sanitizeFilename(name: string): string {
  return name
    .replace(/[/\\?%*:|"<>]/g, '-')
    .replace(/\.{2,}/g, '.')
    .replace(/^[\s.]+|[\s.]+$/g, '')
    .substring(0, 200) || 'download';
}

/** Fisher-Yates in-place shuffle — returns a new array, does not mutate the input. */
function shuffleArray<T>(arr: T[]): T[] {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
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
  const { contextMenu, closeContextMenu, playTrack, enqueue, queue, currentTrack, removeTrack, lastfmLovedCache, setLastfmLovedForSong, starredOverrides, setStarredOverride, openSongInfo, userRatingOverrides, setUserRatingOverride } = usePlayerStore(
    useShallow(s => ({
      contextMenu: s.contextMenu,
      closeContextMenu: s.closeContextMenu,
      playTrack: s.playTrack,
      enqueue: s.enqueue,
      queue: s.queue,
      currentTrack: s.currentTrack,
      removeTrack: s.removeTrack,
      lastfmLovedCache: s.lastfmLovedCache,
      setLastfmLovedForSong: s.setLastfmLovedForSong,
      starredOverrides: s.starredOverrides,
      setStarredOverride: s.setStarredOverride,
      openSongInfo: s.openSongInfo,
      userRatingOverrides: s.userRatingOverrides,
      setUserRatingOverride: s.setUserRatingOverride,
    }))
  );
  const auth = useAuthStore();
  const audiomuseNavidromeEnabled = !!(auth.activeServerId && auth.audiomuseNavidromeByServer[auth.activeServerId]);
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

  const startRadio = async (artistId: string, artistName: string, seedTrack?: Track) => {
    if (seedTrack) {
      // Start playback immediately based on current state
      const state = usePlayerStore.getState();
      if (state.currentTrack?.id === seedTrack.id) {
        if (!state.isPlaying) state.resume();
        // Already playing this track — don't restart
      } else {
        playTrack(seedTrack, [seedTrack]);
      }
      // Load radio queue in background — enqueueRadio replaces any pending radio
      // tracks so clicking "Start Radio" again never stacks duplicate batches.
      // Shuffle so the follow-up tracks feel fresh instead of always being the
      // same "Top 5" in the same order every time.
      try {
        const [similar, top] = await Promise.all([getSimilarSongs2(artistId), getTopSongs(artistName)]);
        // Keep artist top songs and similar-by-artist in two blocks (each shuffled), not one blended pile —
        // otherwise this feels the same as Instant Mix (track-based similar only).
        const topTracks = shuffleArray(
          top.map(songToTrack).filter(t => t.id !== seedTrack.id).map(t => ({ ...t, radioAdded: true as const }))
        );
        const similarTracks = shuffleArray(
          similar.map(songToTrack).filter(t => t.id !== seedTrack.id).map(t => ({ ...t, radioAdded: true as const }))
        );
        const radioTracks = [...topTracks, ...similarTracks];
        if (radioTracks.length > 0) usePlayerStore.getState().enqueueRadio(radioTracks, artistId);
      } catch (e) {
        console.error('Failed to load radio queue', e);
      }
    } else {
      // Artist radio: fire both calls immediately but don't wait for the slow one.
      // getTopSongs is fast (local library) — start playback as soon as it resolves.
      // getSimilarSongs2 is slow (Last.fm) — enrich the queue in the background.
      const similarPromise = getSimilarSongs2(artistId).catch(() => [] as Awaited<ReturnType<typeof getSimilarSongs2>>);
      try {
        const top = await getTopSongs(artistName);
        // Shuffle so each Radio session starts from a different track rather
        // than always kicking off with the #1 most-played song.
        const topTracks = shuffleArray(
          top.map(t => ({ ...songToTrack(t), radioAdded: true as const }))
        );
        if (topTracks.length === 0) {
          // No local top songs — fall back to waiting for similar tracks
          const similar = await similarPromise;
          const fallback = shuffleArray(
            similar.map(t => ({ ...songToTrack(t), radioAdded: true as const }))
          );
          if (fallback.length === 0) return;
          const state = usePlayerStore.getState();
          if (state.currentTrack) {
            state.enqueueRadio(fallback, artistId);
          } else {
            state.setRadioArtistId(artistId);
            playTrack(fallback[0], fallback);
          }
          return;
        }
        // Start playback from the first shuffled top track only.
        // No other tracks are queued yet — positions 2+ will be filled
        // exclusively by the similar-songs result below.
        const state = usePlayerStore.getState();
        if (state.currentTrack) {
          state.enqueueRadio([topTracks[0]], artistId);
        } else {
          state.setRadioArtistId(artistId);
          playTrack(topTracks[0], [topTracks[0]]);
        }
        // Populate positions 2+ from similar songs only — never from the
        // remaining top tracks.  Mixing in topTracks.slice(1) meant that when
        // getSimilarSongs2 returned nothing (no Last.fm, small library, etc.)
        // the queue fell back to the same top-4 the user just heard.
        // If similarTracks is also empty, the proactive top-up in next()
        // will refill the queue when the first track nears its end.
        similarPromise.then(similar => {
          const similarTracks = shuffleArray(
            similar
              .map(t => ({ ...songToTrack(t), radioAdded: true as const }))
              .filter(t => t.id !== topTracks[0].id)
          );
          if (similarTracks.length === 0) return;
          const { queue, queueIndex } = usePlayerStore.getState();
          const pendingRadio = queue.slice(queueIndex + 1).filter(t => t.radioAdded);
          usePlayerStore.getState().enqueueRadio([...pendingRadio, ...similarTracks], artistId);
        });
      } catch (e) {
        console.error('Failed to start radio', e);
      }
    }
  };

  const startInstantMix = async (song: Track) => {
    const state = usePlayerStore.getState();
    if (state.currentTrack?.id === song.id) {
      if (!state.isPlaying) state.resume();
    } else {
      playTrack(song, [song]);
    }
    const serverId = useAuthStore.getState().activeServerId;
    try {
      const similar = await getSimilarSongs(song.id, 50);
      if (serverId) useAuthStore.getState().setAudiomuseNavidromeIssue(serverId, false);
      const shuffled = shuffleArray(
        similar
          .filter(s => s.id !== song.id)
          .map(s => ({ ...songToTrack(s), radioAdded: true as const }))
      );
      if (shuffled.length > 0) {
        const aid = song.artistId?.trim() || undefined;
        usePlayerStore.getState().enqueueRadio(shuffled, aid);
      }
    } catch (e) {
      console.error('Instant mix failed', e);
      if (serverId) useAuthStore.getState().setAudiomuseNavidromeIssue(serverId, true);
      showToast(t('contextMenu.instantMixFailed'), 5000, 'error');
    }
  };

  const downloadAlbum = async (albumName: string, albumId: string) => {
    const folder = auth.downloadFolder || await requestDownloadFolder();
    if (!folder) return;

    const filename = `${sanitizeFilename(albumName)}.zip`;
    const destPath = await join(folder, filename);
    const url = buildDownloadUrl(albumId);
    const id = crypto.randomUUID();

    const { start, complete, fail } = useZipDownloadStore.getState();
    start(id, filename);
    try {
      await invoke('download_zip', { id, url, destPath });
      complete(id);
    } catch (e) {
      fail(id);
      console.error('ZIP download failed:', e);
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
              <div className="context-menu-item" onClick={() => handleAction(() => startRadio(song.artistId ?? song.artist, song.artist, song))}>
                <Radio size={14} /> {t('contextMenu.startRadio')}
              </div>
              {audiomuseNavidromeEnabled && (
                <div className="context-menu-item" onClick={() => handleAction(() => startInstantMix(song))}>
                  <Sparkles size={14} /> {t('contextMenu.instantMix')}
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
              <div className="context-menu-divider" />
              <div className="context-menu-rating-row" onClick={e => e.stopPropagation()}>
                <StarRating
                  value={userRatingOverrides[song.id] ?? song.userRating ?? 0}
                  onChange={r => { setUserRatingOverride(song.id, r); setRating(song.id, r).catch(() => {}); }}
                  ariaLabel={t('albumDetail.ratingLabel')}
                />
              </div>
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
              <div className="context-menu-item" onClick={() => handleAction(() => startRadio(song.artistId ?? song.artist, song.artist, song))}>
                <Radio size={14} /> {t('contextMenu.startRadio')}
              </div>
              {audiomuseNavidromeEnabled && (
                <div className="context-menu-item" onClick={() => handleAction(() => startInstantMix(song))}>
                  <Sparkles size={14} /> {t('contextMenu.instantMix')}
                </div>
              )}
              <div className="context-menu-divider" />
              <div className="context-menu-rating-row" onClick={e => e.stopPropagation()}>
                <StarRating
                  value={userRatingOverrides[song.id] ?? song.userRating ?? 0}
                  onChange={r => { setUserRatingOverride(song.id, r); setRating(song.id, r).catch(() => {}); }}
                  ariaLabel={t('albumDetail.ratingLabel')}
                />
              </div>
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
