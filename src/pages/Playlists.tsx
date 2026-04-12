import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ListMusic, Play, Plus, Trash2, X, CheckSquare2, Check } from 'lucide-react';
import { getPlaylists, createPlaylist, deletePlaylist, SubsonicPlaylist, getPlaylist, buildCoverArtUrl, coverArtCacheKey, updatePlaylist } from '../api/subsonic';
import { usePlayerStore, songToTrack } from '../store/playerStore';
import { usePlaylistStore } from '../store/playlistStore';
import CachedImage from '../components/CachedImage';
import { useTranslation } from 'react-i18next';
import { formatHumanHoursMinutes } from '../utils/formatHumanDuration';
import { showToast } from '../utils/toast';

function formatDuration(seconds: number): string {
  return formatHumanHoursMinutes(seconds);
}

export default function Playlists() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const playTrack = usePlayerStore(s => s.playTrack);
  const openContextMenu = usePlayerStore(s => s.openContextMenu);
  const touchPlaylist = usePlaylistStore((s) => s.touchPlaylist);
  const removeId = usePlaylistStore((s) => s.removeId);

  const [playlists, setPlaylists] = useState<SubsonicPlaylist[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  // ── Multi-selection ──────────────────────────────────────────────────────
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const toggleSelectionMode = () => {
    setSelectionMode(v => !v);
    setSelectedIds(new Set());
  };

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const clearSelection = () => {
    setSelectionMode(false);
    setSelectedIds(new Set());
  };

  const selectedPlaylists = playlists.filter(p => selectedIds.has(p.id));

  useEffect(() => {
    getPlaylists()
      .then(setPlaylists)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (creating) nameInputRef.current?.focus();
  }, [creating]);

  const handleCreate = async () => {
    const name = newName.trim() || t('playlists.unnamed');
    try {
      await createPlaylist(name);
      const updated = await getPlaylists();
      setPlaylists(updated);
    } catch {}
    setCreating(false);
    setNewName('');
  };

  const handlePlay = async (e: React.MouseEvent, pl: SubsonicPlaylist) => {
    e.stopPropagation();
    if (playingId === pl.id) return;
    setPlayingId(pl.id);
    try {
      const data = await getPlaylist(pl.id);
      const tracks = data.songs.map(songToTrack);
      if (tracks.length > 0) {
        touchPlaylist(pl.id);
        playTrack(tracks[0], tracks);
      }
    } catch {}
    setPlayingId(null);
  };

  const handleDelete = async (e: React.MouseEvent, pl: SubsonicPlaylist) => {
    e.stopPropagation();
    if (deleteConfirmId !== pl.id) {
      setDeleteConfirmId(pl.id);
      return;
    }
    try {
      await deletePlaylist(pl.id);
      removeId(pl.id);
      setPlaylists((prev) => prev.filter((p) => p.id !== pl.id));
    } catch {}
    setDeleteConfirmId(null);
  };

  const handleDeleteSelected = async () => {
    if (selectedPlaylists.length === 0) return;
    let deleted = 0;
    for (const pl of selectedPlaylists) {
      try {
        await deletePlaylist(pl.id);
        removeId(pl.id);
        deleted++;
      } catch {
        showToast(t('playlists.deleteFailed', { name: pl.name }), 3000, 'error');
      }
    }
    setPlaylists((prev) => prev.filter((p) => !selectedIds.has(p.id)));
    clearSelection();
    if (deleted > 0) {
      showToast(t('playlists.deleteSuccess', { count: deleted }), 3000, 'info');
    }
  };

  const handleMergeSelected = async (targetPlaylist: SubsonicPlaylist) => {
    if (selectedPlaylists.length === 0) return;
    try {
      const { songs: targetSongs } = await getPlaylist(targetPlaylist.id);
      const targetIds = new Set(targetSongs.map(s => s.id));
      let totalAdded = 0;

      for (const pl of selectedPlaylists) {
        if (pl.id === targetPlaylist.id) continue;
        const { songs } = await getPlaylist(pl.id);
        const newSongs = songs.filter(s => !targetIds.has(s.id));
        if (newSongs.length > 0) {
          newSongs.forEach(s => targetIds.add(s.id));
          totalAdded += newSongs.length;
        }
      }

      if (totalAdded > 0) {
        await updatePlaylist(targetPlaylist.id, Array.from(targetIds));
        touchPlaylist(targetPlaylist.id);
        showToast(t('playlists.mergeSuccess', { count: totalAdded, playlist: targetPlaylist.name }), 3000, 'info');
      } else {
        showToast(t('playlists.mergeNoNewSongs'), 3000, 'info');
      }
      clearSelection();
    } catch {
      showToast(t('playlists.mergeError'), 4000, 'error');
    }
  };

  if (loading) {
    return (
      <div className="content-body" style={{ display: 'flex', justifyContent: 'center', padding: '4rem' }}>
        <div className="spinner" />
      </div>
    );
  }

  return (
    <div className="content-body animate-fade-in">

      {/* ── Header row ── */}
      <div className="playlists-header">
        <h1 className="page-title" style={{ marginBottom: 0 }}>
          {selectionMode && selectedIds.size > 0
            ? t('playlists.selectionCount', { count: selectedIds.size })
            : t('playlists.title')}
        </h1>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          {!(selectionMode && selectedIds.size > 0) && (<>
              {creating ? (
                <>
                  <input
                    ref={nameInputRef}
                    className="input"
                    style={{ width: 220 }}
                    placeholder={t('playlists.createName')}
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleCreate();
                      if (e.key === 'Escape') { setCreating(false); setNewName(''); }
                    }}
                  />
                  <button className="btn btn-primary" onClick={handleCreate}>
                    {t('playlists.create')}
                  </button>
                  <button className="btn btn-surface" onClick={() => { setCreating(false); setNewName(''); }}>
                    {t('playlists.cancel')}
                  </button>
                </>
              ) : (
                <button className="btn btn-primary" onClick={() => setCreating(true)}>
                  <Plus size={15} /> {t('playlists.newPlaylist')}
                </button>
              )}
            </>
          )}
          <button
            className={`btn btn-surface${selectionMode ? ' btn-sort-active' : ''}`}
            onClick={toggleSelectionMode}
            data-tooltip={selectionMode ? t('playlists.cancelSelect') : t('playlists.startSelect')}
            data-tooltip-pos="bottom"
            style={selectionMode ? { background: 'var(--accent)', color: 'var(--ctp-crust)' } : {}}
          >
            <CheckSquare2 size={15} />
            {selectionMode ? t('playlists.cancelSelect') : t('playlists.select')}
          </button>
        </div>
      </div>

      {/* ── Grid ── */}
      {playlists.length === 0 ? (
        <div className="empty-state">{t('playlists.empty')}</div>
      ) : (
        <div className="album-grid-wrap">
          {playlists.map((pl) => (
            <div
              key={pl.id}
              className={`album-card${selectionMode && selectedIds.has(pl.id) ? ' selected' : ''}`}
              onClick={() => {
                if (selectionMode) {
                  toggleSelect(pl.id);
                } else {
                  navigate(`/playlists/${pl.id}`);
                }
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                if (selectionMode && selectedIds.size > 0) {
                  openContextMenu(e.clientX, e.clientY, selectedPlaylists, 'multi-playlist');
                } else {
                  openContextMenu(e.clientX, e.clientY, pl, 'playlist');
                }
              }}
              onMouseLeave={() => { if (deleteConfirmId === pl.id) setDeleteConfirmId(null); }}
              style={selectionMode && selectedIds.has(pl.id) ? {
                outline: '2px solid var(--accent)',
                outlineOffset: '2px',
                borderRadius: 'var(--radius-md)'
              } : {}}
            >
              {selectionMode && (
                <div className={`album-card-select-check${selectedIds.has(pl.id) ? ' album-card-select-check--on' : ''}`}>
                  {selectedIds.has(pl.id) && <Check size={14} strokeWidth={3} />}
                </div>
              )}
              {/* Cover area — server collage or fallback icon */}
              <div className="album-card-cover">
                {pl.coverArt ? (
                  <CachedImage
                    src={buildCoverArtUrl(pl.coverArt, 256)}
                    cacheKey={coverArtCacheKey(pl.coverArt, 256)}
                    alt={pl.name}
                    className="album-card-cover-img"
                  />
                ) : (
                  <div className="album-card-cover-placeholder playlist-card-icon">
                    <ListMusic size={48} strokeWidth={1.2} />
                  </div>
                )}

                {/* Play overlay — same pattern as AlbumCard */}
                <div className="album-card-play-overlay">
                  <button
                    className="album-card-details-btn"
                    onClick={(e) => handlePlay(e, pl)}
                    disabled={playingId === pl.id}
                  >
                    {playingId === pl.id
                      ? <span className="spinner" style={{ width: 14, height: 14 }} />
                      : <Play size={15} fill="currentColor" />
                    }
                  </button>
                </div>

              </div>

              <div className="album-card-info">
                <div className="album-card-title">{pl.name}</div>
                <div className="album-card-artist">
                  {t('playlists.songs', { n: pl.songCount })}
                  {pl.duration > 0 && <> · {formatDuration(pl.duration)}</>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
