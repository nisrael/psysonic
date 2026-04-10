import React, { useState, useEffect } from 'react';
import { Play, Heart, ListPlus, X, ChevronDown, Check } from 'lucide-react';
import { useTracklistColumns, type ColDef } from '../utils/useTracklistColumns';
import { SubsonicSong } from '../api/subsonic';
import { Track, usePlayerStore, songToTrack } from '../store/playerStore';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useDragDrop } from '../contexts/DragDropContext';
import { AddToPlaylistSubmenu } from './ContextMenu';
import { useIsMobile } from '../hooks/useIsMobile';
import StarRating from './StarRating';

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function codecLabel(song: { suffix?: string; bitRate?: number }): string {
  const parts: string[] = [];
  if (song.suffix) parts.push(song.suffix.toUpperCase());
  if (song.bitRate) parts.push(`${song.bitRate}`);
  return parts.join(' ');
}

// ── Column configuration ──────────────────────────────────────────────────────
// 'num'   → always 60 px fixed, no resize handle
// 'title' → minmax(150px, 1fr) via flex:true, absorbs window-resize changes
// rest    → persistent px values from useTracklistColumns hook

const COLUMNS: readonly ColDef[] = [
  { key: 'num',      i18nKey: null,            minWidth: 60,  defaultWidth: 60,  required: true  },
  { key: 'title',    i18nKey: 'trackTitle',    minWidth: 150, defaultWidth: 0,   required: true,  flex: true },
  { key: 'artist',   i18nKey: 'trackArtist',   minWidth: 80,  defaultWidth: 180, required: false },
  { key: 'favorite', i18nKey: 'trackFavorite', minWidth: 50,  defaultWidth: 70,  required: false },
  { key: 'rating',   i18nKey: 'trackRating',   minWidth: 80,  defaultWidth: 120, required: false },
  { key: 'duration', i18nKey: 'trackDuration', minWidth: 72,  defaultWidth: 92,  required: false },
  { key: 'format',   i18nKey: 'trackFormat',   minWidth: 60,  defaultWidth: 90,  required: false },
  { key: 'genre',    i18nKey: 'trackGenre',    minWidth: 60,  defaultWidth: 90,  required: false },
];

type ColKey = 'num' | 'title' | 'artist' | 'favorite' | 'rating' | 'duration' | 'format' | 'genre';

// Columns where header label is centred in the cell (matches row controls below)
const CENTERED_COLS = new Set<ColKey>(['favorite', 'rating', 'duration']);

// ── Props ─────────────────────────────────────────────────────────────────────

interface AlbumTrackListProps {
  songs: SubsonicSong[];
  hasVariousArtists: boolean;
  currentTrack: Track | null;
  isPlaying: boolean;
  ratings: Record<string, number>;
  /** Merged after local `ratings` (e.g. skip→1★ optimistic updates). */
  userRatingOverrides: Record<string, number>;
  starredSongs: Set<string>;
  onPlaySong: (song: SubsonicSong) => void;
  onRate: (songId: string, rating: number) => void;
  onToggleSongStar: (song: SubsonicSong, e: React.MouseEvent) => void;
  onContextMenu: (x: number, y: number, track: Track, type: 'song' | 'album' | 'artist' | 'queue-item' | 'album-song') => void;
}

export default function AlbumTrackList({
  songs,
  hasVariousArtists,
  currentTrack,
  isPlaying,
  ratings,
  userRatingOverrides,
  starredSongs,
  onPlaySong,
  onRate,
  onToggleSongStar,
  onContextMenu,
}: AlbumTrackListProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [contextMenuSongId, setContextMenuSongId] = useState<string | null>(null);
  const contextMenuOpen = usePlayerStore(s => s.contextMenu.isOpen);
  const psyDrag = useDragDrop();

  // ── Bulk select ───────────────────────────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [lastSelectedIdx, setLastSelectedIdx] = useState<number | null>(null);
  const [showPlPicker, setShowPlPicker] = useState(false);

  // ── Column state (resize, visibility, picker) via shared hook ────────────
  const {
    colWidths, colVisible, visibleCols, gridStyle,
    startResize, toggleColumn,
    pickerOpen, setPickerOpen, pickerRef, tracklistRef,
  } = useTracklistColumns(COLUMNS, 'psysonic_tracklist_columns');

  const toggleSelect = (id: string, globalIdx: number, shift: boolean) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (shift && lastSelectedIdx !== null) {
        const from = Math.min(lastSelectedIdx, globalIdx);
        const to = Math.max(lastSelectedIdx, globalIdx);
        songs.slice(from, to + 1).forEach(s => next.add(s.id));
      } else {
        next.has(id) ? next.delete(id) : next.add(id);
      }
      return next;
    });
    setLastSelectedIdx(globalIdx);
  };

  const allSelected = selectedIds.size === songs.length && songs.length > 0;
  const toggleAll = () => setSelectedIds(allSelected ? new Set() : new Set(songs.map(s => s.id)));

  useEffect(() => {
    if (!contextMenuOpen) setContextMenuSongId(null);
  }, [contextMenuOpen]);

  useEffect(() => {
    if (!showPlPicker) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.bulk-pl-picker-wrap')) setShowPlPicker(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showPlPicker]);

  const discs = new Map<number, SubsonicSong[]>();
  songs.forEach(song => {
    const disc = song.discNumber ?? 1;
    if (!discs.has(disc)) discs.set(disc, []);
    discs.get(disc)!.push(song);
  });
  const discNums = Array.from(discs.keys()).sort((a, b) => a - b);
  const isMultiDisc = discNums.length > 1;

  const inSelectMode = selectedIds.size > 0;

  // ── Header cell renderer ──────────────────────────────────────────────────
  const renderHeaderCell = (colDef: ColDef, colIndex: number) => {
    const key = colDef.key as ColKey;
    const isLastCol = colIndex === visibleCols.length - 1;
    const isCentered = CENTERED_COLS.has(key);
    const label = colDef.i18nKey ? t(`albumDetail.${colDef.i18nKey as string}`) : '';

    // num header: checkbox + # label, mirrors row-cell layout exactly
    if (key === 'num') {
      return (
        <div key={key} className="track-num">
          <span
            className={`bulk-check${allSelected ? ' checked' : ''}${inSelectMode ? ' bulk-check-visible' : ''}`}
            onClick={e => { e.stopPropagation(); toggleAll(); }}
            style={{ cursor: 'pointer' }}
          />
          <span className="track-num-number">#</span>
        </div>
      );
    }

    // title (1fr): label + divider on RIGHT edge that controls the NEXT px column (drag→shrinks it)
    if (key === 'title') {
      const hasNextCol = colIndex + 1 < visibleCols.length;
      return (
        <div key={key} style={{ position: 'relative', padding: 0, margin: 0, minWidth: 0, overflow: 'hidden' }}>
          <div style={{ display: 'flex', width: '100%', height: '100%', alignItems: 'center', justifyContent: 'flex-start', paddingLeft: 12 }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
          </div>
          {hasNextCol && (
            <div className="col-resize-handle" onMouseDown={e => startResize(e, colIndex + 1, -1)} />
          )}
        </div>
      );
    }

    // px-width columns: centred (compact controls) or left-aligned label + right-edge divider
    const isResizable = !isLastCol;
    return (
      <div key={key} style={{ position: 'relative', padding: 0, margin: 0, minWidth: 0, overflow: 'hidden' }}>
        <div
          style={{
            display: 'flex',
            width: '100%',
            height: '100%',
            alignItems: 'center',
            justifyContent: isCentered ? 'center' : 'flex-start',
            paddingLeft: isCentered ? 0 : 12,
          }}
        >
          <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
        </div>
        {isResizable && (
          <div className="col-resize-handle" onMouseDown={e => startResize(e, colIndex, 1)} />
        )}
      </div>
    );
  };

  // ── Row cell renderer ─────────────────────────────────────────────────────
  const renderRowCell = (key: ColKey, song: SubsonicSong, globalIdx: number) => {
    switch (key) {
      case 'num':
        return (
          <div
            key="num"
            className={`track-num${currentTrack?.id === song.id ? ' track-num-active' : ''}${currentTrack?.id === song.id && !isPlaying ? ' track-num-paused' : ''}`}
            style={{ cursor: 'pointer' }}
            onClick={e => { e.stopPropagation(); onPlaySong(song); }}
          >
            <span
              className={`bulk-check${selectedIds.has(song.id) ? ' checked' : ''}${inSelectMode ? ' bulk-check-visible' : ''}`}
              onClick={e => { e.stopPropagation(); toggleSelect(song.id, globalIdx, e.shiftKey); }}
            />
            {currentTrack?.id === song.id && isPlaying && (
              <span className="track-num-eq">
                <div className="eq-bars"><span className="eq-bar" /><span className="eq-bar" /><span className="eq-bar" /></div>
              </span>
            )}
            <span className="track-num-play"><Play size={13} fill="currentColor" /></span>
            <span className="track-num-number">{song.track ?? '—'}</span>
          </div>
        );
      case 'title':
        return (
          <div key="title" className="track-info">
            <span className="track-title">{song.title}</span>
          </div>
        );
      case 'artist': {
        const artistRefs = song.artists && song.artists.length > 0
          ? song.artists
          : [{ id: song.artistId, name: song.artist }];
        return (
          <div key="artist" className="track-artist-cell">
            {artistRefs.map((a, i) => (
              <React.Fragment key={a.id ?? a.name ?? i}>
                {i > 0 && <span className="track-artist-sep">&nbsp;·&nbsp;</span>}
                <span
                  className={`track-artist${a.id ? ' track-artist-link' : ''}`}
                  style={{ cursor: a.id ? 'pointer' : 'default' }}
                  onClick={e => { if (a.id) { e.stopPropagation(); navigate(`/artist/${a.id}`); } }}
                >
                  {a.name ?? song.artist}
                </span>
              </React.Fragment>
            ))}
          </div>
        );
      }
      case 'favorite':
        return (
          <div key="favorite" className="track-star-cell">
            <button
              className={`btn btn-ghost track-star-btn${starredSongs.has(song.id) ? ' is-starred' : ''}`}
              onClick={e => onToggleSongStar(song, e)}
              data-tooltip={starredSongs.has(song.id) ? t('albumDetail.favoriteRemove') : t('albumDetail.favoriteAdd')}
            >
              <Heart size={14} fill={starredSongs.has(song.id) ? 'currentColor' : 'none'} />
            </button>
          </div>
        );
      case 'rating':
        return (
          <StarRating
            key="rating"
            value={ratings[song.id] ?? userRatingOverrides[song.id] ?? song.userRating ?? 0}
            onChange={r => onRate(song.id, r)}
          />
        );
      case 'duration':
        return (
          <div key="duration" className="track-duration">
            {formatDuration(song.duration)}
          </div>
        );
      case 'format':
        return (
          <div key="format" className="track-meta">
            {(song.suffix || song.bitRate) && (
              <span className="track-codec">{codecLabel(song)}</span>
            )}
          </div>
        );
      case 'genre':
        return (
          <div key="genre" className="track-genre">
            {song.genre ?? '—'}
          </div>
        );
      default:
        return null;
    }
  };

  // ── Mobile tracklist ─────────────────────────────────────────────────────
  if (isMobile) {
    return (
      <div className="tracklist-mobile">
        {discNums.map(discNum => (
          <div key={discNum}>
            {isMultiDisc && (
              <div className="disc-header">
                <span className="disc-icon">💿</span> CD {discNum}
              </div>
            )}
            {discs.get(discNum)!.map(song => {
              const isActive = currentTrack?.id === song.id;
              return (
                <div
                  key={song.id}
                  className={`tracklist-mobile-row${isActive ? ' active' : ''}${contextMenuSongId === song.id ? ' context-active' : ''}`}
                  onClick={() => onPlaySong(song)}
                  onContextMenu={e => {
                    e.preventDefault();
                    setContextMenuSongId(song.id);
                    onContextMenu(e.clientX, e.clientY, songToTrack(song), 'album-song');
                  }}
                >
                  <div className="tracklist-mobile-main">
                    {isActive && isPlaying ? (
                      <span className="tracklist-mobile-eq">
                        <div className="eq-bars"><span className="eq-bar" /><span className="eq-bar" /><span className="eq-bar" /></div>
                      </span>
                    ) : (
                      <span className="tracklist-mobile-num">{song.track ?? ''}</span>
                    )}
                    <span className="tracklist-mobile-title">{song.title}</span>
                  </div>
                  <span className="tracklist-mobile-duration">{formatDuration(song.duration)}</span>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="tracklist" ref={tracklistRef}>

      {/* ── Bulk action bar ── */}
      {inSelectMode && (
        <div className="bulk-action-bar">
          <span className="bulk-action-count">
            {t('common.bulkSelected', { count: selectedIds.size })}
          </span>
          <div className="bulk-pl-picker-wrap">
            <button
              className="btn btn-surface btn-sm"
              onClick={() => setShowPlPicker(v => !v)}
            >
              <ListPlus size={14} />
              {t('common.bulkAddToPlaylist')}
            </button>
            {showPlPicker && (
              <AddToPlaylistSubmenu
                songIds={[...selectedIds]}
                onDone={() => { setShowPlPicker(false); setSelectedIds(new Set()); }}
                dropDown
              />
            )}
          </div>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => setSelectedIds(new Set())}
          >
            <X size={13} />
            {t('common.bulkClear')}
          </button>
        </div>
      )}

      {/* ── Header ── */}
      <div style={{ position: 'relative' }}>
        <div className="tracklist-header" style={gridStyle}>
          {visibleCols.map((colDef, colIndex) => renderHeaderCell(colDef, colIndex))}
        </div>

        {/* Column visibility picker */}
        <div className="tracklist-col-picker" ref={pickerRef}>
          <button
            className="tracklist-col-picker-btn"
            onClick={e => { e.stopPropagation(); setPickerOpen(v => !v); }}
            data-tooltip={t('albumDetail.columns')}
          >
            <ChevronDown size={14} />
          </button>
          {pickerOpen && (
            <div className="tracklist-col-picker-menu">
              <div className="tracklist-col-picker-label">{t('albumDetail.columns')}</div>
              {COLUMNS.filter(c => !c.required).map(c => {
                const label = c.i18nKey ? t(`albumDetail.${c.i18nKey as string}`) : c.key;
                const isOn = colVisible.has(c.key);
                return (
                  <button
                    key={c.key}
                    className={`tracklist-col-picker-item${isOn ? ' active' : ''}`}
                    onClick={() => toggleColumn(c.key)}
                  >
                    <span className="tracklist-col-picker-check">
                      {isOn && <Check size={13} />}
                    </span>
                    {label}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── Tracks ── */}
      {discNums.map(discNum => (
        <div key={discNum}>
          {isMultiDisc && (
            <div className="disc-header">
              <span className="disc-icon">💿</span>
              CD {discNum}
            </div>
          )}
          {discs.get(discNum)!.map((song) => {
            const globalIdx = songs.indexOf(song);
            return (
              <div
                key={song.id}
                className={`track-row track-row-va${currentTrack?.id === song.id ? ' active' : ''}${contextMenuSongId === song.id ? ' context-active' : ''}${selectedIds.has(song.id) ? ' bulk-selected' : ''}`}
                style={gridStyle}
                onClick={e => {
                  if ((e.target as HTMLElement).closest('button, a, input')) return;
                  if (inSelectMode) {
                    toggleSelect(song.id, globalIdx, e.shiftKey);
                  } else {
                    onPlaySong(song);
                  }
                }}
                onContextMenu={e => {
                  e.preventDefault();
                  setContextMenuSongId(song.id);
                  onContextMenu(e.clientX, e.clientY, songToTrack(song), 'album-song');
                }}
                role="row"
                onMouseDown={e => {
                  if (e.button !== 0) return;
                  e.preventDefault();
                  const sx = e.clientX, sy = e.clientY;
                  const onMove = (me: MouseEvent) => {
                    if (Math.abs(me.clientX - sx) > 5 || Math.abs(me.clientY - sy) > 5) {
                      document.removeEventListener('mousemove', onMove);
                      document.removeEventListener('mouseup', onUp);
                      psyDrag.startDrag({ data: JSON.stringify({ type: 'song', track: songToTrack(song) }), label: song.title }, me.clientX, me.clientY);
                    }
                  };
                  const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
                  document.addEventListener('mousemove', onMove);
                  document.addEventListener('mouseup', onUp);
                }}
              >
                {visibleCols.map(colDef => renderRowCell(colDef.key as ColKey, song, globalIdx))}
              </div>
            );
          })}
        </div>
      ))}

    </div>
  );
}
