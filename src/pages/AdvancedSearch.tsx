import React, { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Play, SlidersVertical } from 'lucide-react';
import {
  search, getGenres, getAlbumsByGenre, getAlbumList, getRandomSongs,
  SubsonicGenre, SubsonicArtist, SubsonicAlbum, SubsonicSong,
} from '../api/subsonic';
import { usePlayerStore, songToTrack } from '../store/playerStore';
import { useTranslation } from 'react-i18next';
import AlbumRow from '../components/AlbumRow';
import ArtistRow from '../components/ArtistRow';
import CustomSelect from '../components/CustomSelect';
import { useDragDrop } from '../contexts/DragDropContext';
import { useAuthStore } from '../store/authStore';
import { useShallow } from 'zustand/react/shallow';

type ResultType = 'all' | 'artists' | 'albums' | 'songs';

interface SearchOpts {
  query: string;
  genre: string;
  yearFrom: string;
  yearTo: string;
  resultType: ResultType;
}

interface Results {
  artists: SubsonicArtist[];
  albums: SubsonicAlbum[];
  songs: SubsonicSong[];
}

export default function AdvancedSearch() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const qFromUrl = params.get('q') ?? '';
  const navigate = useNavigate();
  const psyDrag = useDragDrop();

  const { playTrack, openContextMenu } = usePlayerStore(
    useShallow(s => ({
      playTrack: s.playTrack,
      openContextMenu: s.openContextMenu,
    }))
  );

  const [contextMenuSongId, setContextMenuSongId] = useState<string | null>(null);
  const contextMenuOpen = usePlayerStore(s => s.contextMenu.isOpen);

  useEffect(() => {
    if (!contextMenuOpen) setContextMenuSongId(null);
  }, [contextMenuOpen]);

  const [query, setQuery] = useState(params.get('q') ?? '');
  const [genre, setGenre] = useState('');
  const [yearFrom, setYearFrom] = useState('');
  const [yearTo, setYearTo] = useState('');
  const [resultType, setResultType] = useState<ResultType>('all');
  const [genres, setGenres] = useState<SubsonicGenre[]>([]);
  const [results, setResults] = useState<Results | null>(null);
  const total = results
    ? results.artists.length + results.albums.length + results.songs.length
    : 0;
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [genreNote, setGenreNote] = useState(false);
  const musicLibraryFilterVersion = useAuthStore(s => s.musicLibraryFilterVersion);

  const runSearch = async (opts: SearchOpts) => {
    setLoading(true);
    setHasSearched(true);
    setGenreNote(false);
    const { query: q, genre: g, yearFrom: yf, yearTo: yt, resultType: rt } = opts;
    const from = yf ? parseInt(yf) : null;
    const to = yt ? parseInt(yt) : null;

    let artists: SubsonicArtist[] = [];
    let albums: SubsonicAlbum[] = [];
    let songs: SubsonicSong[] = [];

    try {
      if (q.trim()) {
        const r = await search(q.trim(), { artistCount: 30, albumCount: 50, songCount: 100 });
        artists = r.artists;
        albums = r.albums;
        songs = r.songs;

        if (g) {
          albums = albums.filter(a => a.genre?.toLowerCase() === g.toLowerCase());
          songs = songs.filter(s => s.genre?.toLowerCase() === g.toLowerCase());
        }
        if (from !== null) {
          albums = albums.filter(a => !a.year || a.year >= from);
          songs = songs.filter(s => !s.year || s.year >= from);
        }
        if (to !== null) {
          albums = albums.filter(a => !a.year || a.year <= to);
          songs = songs.filter(s => !s.year || s.year <= to);
        }
      } else if (g) {
        const [albumRes, songRes] = await Promise.all([
          rt === 'songs' || rt === 'artists' ? Promise.resolve([]) : getAlbumsByGenre(g, 50),
          rt === 'albums' || rt === 'artists' ? Promise.resolve([]) : getRandomSongs(100, g),
        ]);
        albums = albumRes as SubsonicAlbum[];
        songs = songRes as SubsonicSong[];
        if (from !== null) albums = albums.filter(a => !a.year || a.year >= from);
        if (to !== null) albums = albums.filter(a => !a.year || a.year <= to);
        if (songs.length > 0) setGenreNote(true);
      } else if (from !== null || to !== null) {
        const fromYear = from ?? 1900;
        const toYear = to ?? new Date().getFullYear();
        albums = await getAlbumList('byYear', 100, 0, { fromYear, toYear });
      }

      setResults({
        artists: rt === 'albums' || rt === 'songs' ? [] : artists,
        albums: rt === 'artists' || rt === 'songs' ? [] : albums,
        songs: rt === 'artists' || rt === 'albums' ? [] : songs,
      });
    } catch {
      setResults({ artists: [], albums: [], songs: [] });
    }
    setLoading(false);
  };

  useEffect(() => {
    getGenres().then(data =>
      setGenres(data.sort((a, b) => a.value.localeCompare(b.value)))
    ).catch(() => {});
    if (qFromUrl) runSearch({ query: qFromUrl, genre: '', yearFrom: '', yearTo: '', resultType: 'all' });
  }, [musicLibraryFilterVersion, qFromUrl]);

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    runSearch({ query, genre, yearFrom, yearTo, resultType });
  };

  const typeOptions: { id: ResultType; label: string }[] = [
    { id: 'all',     label: t('search.advancedAll') },
    { id: 'artists', label: t('search.artists') },
    { id: 'albums',  label: t('search.albums') },
    { id: 'songs',   label: t('search.songs') },
  ];

  const genreSelectOptions = [
    { value: '', label: t('search.advancedAllGenres') },
    ...genres.map(g => ({ value: g.value, label: g.value })),
  ];

  return (
    <div className="content-body animate-fade-in">
      <div style={{ marginBottom: '1.5rem' }}>
        <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <SlidersVertical size={22} style={{ color: 'var(--accent)', flexShrink: 0 }} />
          {t('search.advanced')}
        </h1>
      </div>

      {/* ── Filter panel ──────────────────────────────────────── */}
      <form onSubmit={handleSubmit}>
        <div className="settings-card" style={{ padding: '1.25rem', marginBottom: '2rem' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>

            {/* Row 1: Search term */}
            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
              <span style={{ fontSize: 13, color: 'var(--text-muted)', minWidth: 90, flexShrink: 0 }}>
                {t('search.advancedSearchTerm')}
              </span>
              <input
                className="input"
                type="text"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder={t('search.advancedSearchPlaceholder')}
                style={{ flex: 1 }}
                autoFocus
              />
            </div>

            {/* Row 2: Genre + Year */}
            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13, color: 'var(--text-muted)', minWidth: 90, flexShrink: 0 }}>
                {t('search.advancedGenre')}
              </span>
              <div style={{ minWidth: 240, flex: '1 1 240px', maxWidth: 360 }}>
                <CustomSelect
                  value={genre}
                  options={genreSelectOptions}
                  onChange={setGenre}
                />
              </div>

              <span style={{ fontSize: 13, color: 'var(--text-muted)', marginLeft: '0.75rem', flexShrink: 0 }}>
                {t('search.advancedYear')}
              </span>
              <input
                className="input"
                type="number"
                min={1900}
                max={new Date().getFullYear()}
                value={yearFrom}
                onChange={e => setYearFrom(e.target.value)}
                placeholder={t('search.advancedYearFrom')}
                style={{ width: 96 }}
              />
              <span style={{ color: 'var(--text-muted)', fontSize: 14 }}>–</span>
              <input
                className="input"
                type="number"
                min={1900}
                max={new Date().getFullYear()}
                value={yearTo}
                onChange={e => setYearTo(e.target.value)}
                placeholder={t('search.advancedYearTo')}
                style={{ width: 96 }}
              />
            </div>

            {/* Row 3: Result type + Search button */}
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
                {typeOptions.map(opt => (
                  <button
                    key={opt.id}
                    type="button"
                    className={`btn ${resultType === opt.id ? 'btn-primary' : 'btn-surface'}`}
                    style={{ fontSize: 12, padding: '4px 14px' }}
                    onClick={() => setResultType(opt.id)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <button
                className="btn btn-primary"
                type="submit"
                disabled={loading}
                style={{ minWidth: 100 }}
              >
                {loading
                  ? <div className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />
                  : t('search.advancedSearch')
                }
              </button>
            </div>
          </div>
        </div>
      </form>

      {/* ── Results ───────────────────────────────────────────── */}
      {!hasSearched ? (
        <div className="empty-state" style={{ opacity: 0.6 }}>
          {t('search.advancedEmpty')}
        </div>
      ) : loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '4rem' }}>
          <div className="spinner" />
        </div>
      ) : total === 0 ? (
        <div className="empty-state">{t('search.advancedNoResults')}</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '3rem' }}>

          {results && results.artists.length > 0 && (
            <ArtistRow
              title={`${t('search.artists')} (${results.artists.length})`}
              artists={results.artists}
            />
          )}

          {results && results.albums.length > 0 && (
            <AlbumRow
              title={`${t('search.albums')} (${results.albums.length})`}
              albums={results.albums}
            />
          )}

          {results && results.songs.length > 0 && (
            <section>
              <h2 className="section-title" style={{ marginBottom: '0.75rem' }}>
                {t('search.songs')} ({results.songs.length})
                {genreNote && (
                  <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--text-muted)', marginLeft: '0.75rem' }}>
                    — {t('search.advancedGenreNote')}
                  </span>
                )}
              </h2>
              <div className="tracklist">
                <div className="tracklist-header" style={{ gridTemplateColumns: '60px minmax(150px, 1fr) minmax(80px, 1fr) minmax(80px, 1fr) 90px 65px' }}>
                  <span />
                  <span>{t('randomMix.trackTitle')}</span>
                  <span>{t('randomMix.trackArtist')}</span>
                  <span>{t('randomMix.trackAlbum')}</span>
                  <span>{t('randomMix.trackGenre')}</span>
                  <span style={{ textAlign: 'right' }}>{t('randomMix.trackDuration')}</span>
                </div>
                {results.songs.map(song => {
                  const track = songToTrack(song);
                  return (
                    <div
                      key={song.id}
                      className={`track-row${contextMenuSongId === song.id ? ' context-active' : ''}`}
                      style={{ gridTemplateColumns: '60px minmax(150px, 1fr) minmax(80px, 1fr) minmax(80px, 1fr) 90px 65px' }}
                      onDoubleClick={() => playTrack(track, results.songs.map(songToTrack))}
                      role="row"
                      onContextMenu={e => {
                        e.preventDefault();
                        setContextMenuSongId(song.id);
                        openContextMenu(e.clientX, e.clientY, track, 'song');
                      }}
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
                      <button
                        className="btn btn-ghost"
                        style={{ padding: 4 }}
                        onClick={e => { e.stopPropagation(); playTrack(track, results.songs.map(songToTrack)); }}
                      >
                        <Play size={13} fill="currentColor" />
                      </button>
                      <div className="track-info">
                        <span className="track-title">{song.title}</span>
                      </div>
                      <div className="track-artist-cell">
                        <span
                          className={`track-artist${song.artistId ? ' track-artist-link' : ''}`}
                          style={{ cursor: song.artistId ? 'pointer' : 'default' }}
                          onClick={() => song.artistId && navigate(`/artist/${song.artistId}`)}
                        >
                          {song.artist}
                        </span>
                      </div>
                      <div className="track-info">
                        <span
                          className="track-title"
                          style={{ fontSize: '0.85rem', color: 'var(--subtext0)', cursor: 'pointer' }}
                          onClick={() => navigate(`/album/${song.albumId}`)}
                        >
                          {song.album}
                        </span>
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {song.genre ?? '—'}
                      </div>
                      <span className="track-duration" style={{ textAlign: 'right' }}>
                        {Math.floor(song.duration / 60)}:{(song.duration % 60).toString().padStart(2, '0')}
                      </span>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
