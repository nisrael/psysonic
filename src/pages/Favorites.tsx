import React, { useEffect, useRef, useState } from 'react';
import { useTracklistColumns, type ColDef } from '../utils/useTracklistColumns';
import AlbumRow from '../components/AlbumRow';
import ArtistRow from '../components/ArtistRow';
import CachedImage from '../components/CachedImage';
import {
  getStarred, getInternetRadioStations,
  SubsonicAlbum, SubsonicArtist, SubsonicSong, InternetRadioStation,
  buildCoverArtUrl, coverArtCacheKey,
} from '../api/subsonic';
import { usePlayerStore, songToTrack } from '../store/playerStore';
import { Cast, ChevronDown, ChevronLeft, ChevronRight, Check, Heart, ListPlus, Play, Star, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { unstar } from '../api/subsonic';
import { useDragDrop } from '../contexts/DragDropContext';
import { useAuthStore } from '../store/authStore';

const FAV_COLUMNS: readonly ColDef[] = [
  { key: 'num',      i18nKey: null,            minWidth: 60,  defaultWidth: 60,  required: true  },
  { key: 'title',    i18nKey: 'trackTitle',    minWidth: 150, defaultWidth: 0,   required: true,  flex: true },
  { key: 'artist',   i18nKey: 'trackArtist',   minWidth: 80,  defaultWidth: 180, required: false },
  { key: 'duration', i18nKey: 'trackDuration', minWidth: 72,  defaultWidth: 92,  required: false },
  { key: 'remove',   i18nKey: null,            minWidth: 36,  defaultWidth: 36,  required: true  },
];

export default function Favorites() {
  const { t } = useTranslation();
  const [albums, setAlbums] = useState<SubsonicAlbum[]>([]);
  const [artists, setArtists] = useState<SubsonicArtist[]>([]);
  const [songs, setSongs] = useState<SubsonicSong[]>([]);
  const [radioStations, setRadioStations] = useState<InternetRadioStation[]>([]);
  const [loading, setLoading] = useState(true);

  // ── Column resize/visibility (must be before early return) ───────────────
  const {
    colVisible, visibleCols, gridStyle,
    startResize, toggleColumn,
    pickerOpen, setPickerOpen, pickerRef, tracklistRef,
  } = useTracklistColumns(FAV_COLUMNS, 'psysonic_favorites_columns');

  const { playTrack, enqueue, playRadio, stop } = usePlayerStore();
  const currentTrack = usePlayerStore(s => s.currentTrack);
  const currentRadio = usePlayerStore(s => s.currentRadio);
  const isPlaying = usePlayerStore(s => s.isPlaying);
  const starredOverrides = usePlayerStore(s => s.starredOverrides);
  const setStarredOverride = usePlayerStore(s => s.setStarredOverride);
  const psyDrag = useDragDrop();

  function removeSong(id: string) {
    unstar(id, 'song').catch(() => {});
    setStarredOverride(id, false);
    setSongs(prev => prev.filter(s => s.id !== id));
  }

  function unfavoriteStation(id: string) {
    setRadioStations(prev => prev.filter(s => s.id !== id));
    try {
      const next = new Set<string>(JSON.parse(localStorage.getItem('psysonic_radio_favorites') ?? '[]'));
      next.delete(id);
      localStorage.setItem('psysonic_radio_favorites', JSON.stringify([...next]));
    } catch { /* ignore */ }
  }

  const openContextMenu = usePlayerStore(s => s.openContextMenu);
  const navigate = useNavigate();
  const musicLibraryFilterVersion = useAuthStore(s => s.musicLibraryFilterVersion);

  useEffect(() => {
    const loadAll = async () => {
      const [starredResult] = await Promise.allSettled([
        getStarred(),
      ]);
      if (starredResult.status === 'fulfilled') {
        setAlbums(starredResult.value.albums);
        setArtists(starredResult.value.artists);
        setSongs(starredResult.value.songs);
      }

      // Radio favorites: read IDs from localStorage, fetch all stations, filter
      try {
        const favIds = new Set<string>(JSON.parse(localStorage.getItem('psysonic_radio_favorites') ?? '[]'));
        if (favIds.size > 0) {
          const all = await getInternetRadioStations();
          setRadioStations(all.filter(s => favIds.has(s.id)));
        }
      } catch { /* ignore */ }

      setLoading(false);
    };
    loadAll();
  }, [musicLibraryFilterVersion]);

  if (loading) {
    return (
      <div className="content-body" style={{ display: 'flex', justifyContent: 'center', padding: '4rem' }}>
        <div className="spinner" />
      </div>
    );
  }

  const visibleSongs = songs.filter(s => starredOverrides[s.id] !== false);
  const hasAnyFavorites = albums.length > 0 || artists.length > 0 || visibleSongs.length > 0 || radioStations.length > 0;

  return (
    <div className="content-body animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '3rem' }}>
      <div style={{ marginBottom: '-1.5rem' }}>
        <h1 className="page-title">{t('favorites.title')}</h1>
      </div>

      {!hasAnyFavorites ? (
        <div className="empty-state">{t('favorites.empty')}</div>
      ) : (
        <>
          {artists.length > 0 && (
            <ArtistRow title={t('favorites.artists')} artists={artists} />
          )}

          {albums.length > 0 && (
            <AlbumRow title={t('favorites.albums')} albums={albums} />
          )}

          {radioStations.length > 0 && (
            <RadioStationRow
              title={t('favorites.stations')}
              stations={radioStations}
              currentRadio={currentRadio}
              isPlaying={isPlaying}
              onPlay={s => {
                if (currentRadio?.id === s.id && isPlaying) stop();
                else playRadio(s);
              }}
              onUnfavorite={unfavoriteStation}
            />
          )}

          {visibleSongs.length > 0 && (
            <section className="album-row-section">
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '0.75rem' }}>
                <h2 className="section-title" style={{ margin: 0 }}>{t('favorites.songs')}</h2>
                <button
                  className="btn btn-primary"
                  onClick={() => {
                    const tracks = visibleSongs.map(songToTrack);
                    playTrack(tracks[0], tracks);
                  }}
                >
                  <Play size={15} />
                  {t('favorites.playAll')}
                </button>
                <button
                  className="btn btn-surface"
                  onClick={() => {
                    const tracks = visibleSongs.map(songToTrack);
                    enqueue(tracks);
                  }}
                >
                  <ListPlus size={15} />
                  {t('favorites.enqueueAll')}
                </button>
              </div>
              <div className="tracklist" style={{ padding: 0 }} ref={tracklistRef}>
                <div style={{ position: 'relative' }}>
                  <div className="tracklist-header tracklist-va" style={gridStyle}>
                    {visibleCols.map((colDef, colIndex) => {
                      const key = colDef.key;
                      const isLastCol = colIndex === visibleCols.length - 1;
                      const label = colDef.i18nKey ? t(`albumDetail.${colDef.i18nKey}`) : '';
                      if (key === 'num') return <div key="num" className="track-num"><span className="track-num-number">#</span></div>;
                      if (key === 'title') {
                        const hasNextCol = colIndex + 1 < visibleCols.length;
                        return (
                          <div key="title" style={{ position: 'relative', padding: 0, margin: 0, minWidth: 0, overflow: 'hidden' }}>
                            <div style={{ display: 'flex', width: '100%', height: '100%', alignItems: 'center', justifyContent: 'flex-start', paddingLeft: 12 }}>
                              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
                            </div>
                            {hasNextCol && <div className="col-resize-handle" onMouseDown={e => startResize(e, colIndex + 1, -1)} />}
                          </div>
                        );
                      }
                      if (key === 'remove') return <div key="remove" />;
                      const isCentered = key === 'duration';
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
                          {!isLastCol && <div className="col-resize-handle" onMouseDown={e => startResize(e, colIndex, 1)} />}
                        </div>
                      );
                    })}
                  </div>
                  <div className="tracklist-col-picker" ref={pickerRef}>
                    <button className="tracklist-col-picker-btn" onClick={e => { e.stopPropagation(); setPickerOpen(v => !v); }} data-tooltip={t('albumDetail.columns')}>
                      <ChevronDown size={14} />
                    </button>
                    {pickerOpen && (
                      <div className="tracklist-col-picker-menu">
                        <div className="tracklist-col-picker-label">{t('albumDetail.columns')}</div>
                        {FAV_COLUMNS.filter(c => !c.required).map(c => {
                          const label = c.i18nKey ? t(`albumDetail.${c.i18nKey}`) : c.key;
                          const isOn = colVisible.has(c.key);
                          return (
                            <button key={c.key} className={`tracklist-col-picker-item${isOn ? ' active' : ''}`} onClick={() => toggleColumn(c.key)}>
                              <span className="tracklist-col-picker-check">{isOn && <Check size={13} />}</span>
                              {label}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
                {visibleSongs.map((song, i) => {
                  const track = songToTrack(song);
                  return (
                    <div
                      key={song.id}
                      className="track-row track-row-va"
                      style={gridStyle}
                      onClick={e => {
                        if ((e.target as HTMLElement).closest('button, a, input')) return;
                        playTrack(track, visibleSongs.map(songToTrack));
                      }}
                      onContextMenu={e => { e.preventDefault(); openContextMenu(e.clientX, e.clientY, track, 'song'); }}
                      role="row"
                      onMouseDown={e => {
                        if (e.button !== 0) return;
                        e.preventDefault();
                        const sx = e.clientX, sy = e.clientY;
                        const onMove = (me: MouseEvent) => {
                          if (Math.abs(me.clientX - sx) > 5 || Math.abs(me.clientY - sy) > 5) {
                            document.removeEventListener('mousemove', onMove);
                            document.removeEventListener('mouseup', onUp);
                            psyDrag.startDrag({ data: JSON.stringify({ type: 'song', track }), label: song.title }, me.clientX, me.clientY);
                          }
                        };
                        const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
                        document.addEventListener('mousemove', onMove);
                        document.addEventListener('mouseup', onUp);
                      }}
                    >
                      {visibleCols.map(colDef => {
                        switch (colDef.key) {
                          case 'num': return (
                            <div key="num" className={`track-num${currentTrack?.id === song.id ? ' track-num-active' : ''}${currentTrack?.id === song.id && !isPlaying ? ' track-num-paused' : ''}`} style={{ cursor: 'pointer' }} onClick={e => { e.stopPropagation(); playTrack(track, visibleSongs.map(songToTrack)); }}>
                              {currentTrack?.id === song.id && isPlaying && <span className="track-num-eq"><div className="eq-bars"><span className="eq-bar" /><span className="eq-bar" /><span className="eq-bar" /></div></span>}
                              <span className="track-num-play"><Play size={13} fill="currentColor" /></span>
                              <span className="track-num-number">{i + 1}</span>
                            </div>
                          );
                          case 'title': return <div key="title" className="track-info"><span className="track-title">{song.title}</span></div>;
                          case 'artist': return (
                            <div key="artist" className="track-artist-cell">
                              <span className={`track-artist${song.artistId ? ' track-artist-link' : ''}`} style={{ cursor: song.artistId ? 'pointer' : 'default' }} onClick={() => song.artistId && navigate(`/artist/${song.artistId}`)}>{song.artist}</span>
                            </div>
                          );
                          case 'duration': return (
                            <div key="duration" className="track-duration">
                              {Math.floor(song.duration / 60)}:{(song.duration % 60).toString().padStart(2, '0')}
                            </div>
                          );
                          case 'remove': return (
                            <div key="remove" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              <button className="btn-icon fav-remove-btn" data-tooltip={t('favorites.removeSong')} onClick={e => { e.stopPropagation(); removeSong(song.id); }} aria-label={t('favorites.removeSong')}>
                                <X size={14} />
                              </button>
                            </div>
                          );
                          default: return null;
                        }
                      })}
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

// ── Radio Station Row ─────────────────────────────────────────────────────────

interface RadioStationRowProps {
  title: string;
  stations: InternetRadioStation[];
  currentRadio: InternetRadioStation | null;
  isPlaying: boolean;
  onPlay: (s: InternetRadioStation) => void;
  onUnfavorite: (id: string) => void;
}

function RadioStationRow({ title, stations, currentRadio, isPlaying, onPlay, onUnfavorite }: RadioStationRowProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showLeft, setShowLeft] = useState(false);
  const [showRight, setShowRight] = useState(true);

  const handleScroll = () => {
    if (!scrollRef.current) return;
    const { scrollLeft, scrollWidth, clientWidth } = scrollRef.current;
    setShowLeft(scrollLeft > 0);
    setShowRight(scrollLeft < scrollWidth - clientWidth - 5);
  };

  const scroll = (dir: 'left' | 'right') => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollBy({ left: dir === 'left' ? -scrollRef.current.clientWidth * 0.75 : scrollRef.current.clientWidth * 0.75, behavior: 'smooth' });
  };

  return (
    <section className="album-row-section">
      <div className="album-row-header">
        <h2 className="section-title" style={{ marginBottom: 0 }}>{title}</h2>
        <div className="album-row-nav">
          <button className={`nav-btn${!showLeft ? ' disabled' : ''}`} onClick={() => scroll('left')} disabled={!showLeft}>
            <ChevronLeft size={20} />
          </button>
          <button className={`nav-btn${!showRight ? ' disabled' : ''}`} onClick={() => scroll('right')} disabled={!showRight}>
            <ChevronRight size={20} />
          </button>
        </div>
      </div>
      <div className="album-grid-wrapper">
        <div className="album-grid" ref={scrollRef} onScroll={handleScroll}>
          {stations.map(s => (
            <RadioFavCard
              key={s.id}
              station={s}
              isActive={currentRadio?.id === s.id}
              isPlaying={isPlaying}
              onPlay={() => onPlay(s)}
              onUnfavorite={() => onUnfavorite(s.id)}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

// ── Radio Favorite Card ───────────────────────────────────────────────────────

interface RadioFavCardProps {
  station: InternetRadioStation;
  isActive: boolean;
  isPlaying: boolean;
  onPlay: () => void;
  onUnfavorite: () => void;
}

function RadioFavCard({ station: s, isActive, isPlaying, onPlay, onUnfavorite }: RadioFavCardProps) {
  const { t } = useTranslation();
  return (
    <div className={`album-card${isActive ? ' radio-card-active' : ''}`}>
      <div className="album-card-cover">
        {s.coverArt ? (
          <CachedImage
            src={buildCoverArtUrl(`ra-${s.id}`, 256)}
            cacheKey={coverArtCacheKey(`ra-${s.id}`, 256)}
            alt={s.name}
            className="album-card-cover-img"
          />
        ) : (
          <div className="album-card-cover-placeholder playlist-card-icon">
            <Cast size={48} strokeWidth={1.2} />
          </div>
        )}
        {isActive && isPlaying && (
          <div className="radio-live-overlay">
            <span className="radio-live-badge">{t('radio.live')}</span>
          </div>
        )}
        <div className="album-card-play-overlay">
          <button className="album-card-details-btn" onClick={onPlay}>
            {isActive && isPlaying ? <X size={15} /> : <Cast size={14} />}
          </button>
        </div>
      </div>
      <div className="album-card-info">
        <div className="album-card-title">{s.name}</div>
        <div className="album-card-artist" style={{ display: 'flex', alignItems: 'center' }}>
          <button
            className="radio-favorite-btn active"
            style={{ background: 'none', border: 'none', padding: '2px', cursor: 'pointer', display: 'flex' }}
            onClick={onUnfavorite}
            data-tooltip={t('radio.unfavorite')}
          >
            <Heart size={12} fill="currentColor" />
          </button>
        </div>
      </div>
    </div>
  );
}
