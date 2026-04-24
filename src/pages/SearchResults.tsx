import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Play, Search } from 'lucide-react';
import { search, SearchResults as ISearchResults, SubsonicSong } from '../api/subsonic';
import { usePlayerStore, songToTrack } from '../store/playerStore';
import AlbumRow from '../components/AlbumRow';
import ArtistRow from '../components/ArtistRow';
import { useTranslation } from 'react-i18next';
import { useDragDrop } from '../contexts/DragDropContext';
import { useAuthStore } from '../store/authStore';
import { useOrbitSongRowBehavior } from '../hooks/useOrbitSongRowBehavior';
import { useThemeStore } from '../store/themeStore';
import { useShallow } from 'zustand/react/shallow';

function formatDuration(s: number) {
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
}

export default function SearchResults() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const query = params.get('q') ?? '';
  const [results, setResults] = useState<ISearchResults | null>(null);
  const [loading, setLoading] = useState(false);
  const musicLibraryFilterVersion = useAuthStore(s => s.musicLibraryFilterVersion);
  const showBitrate = useThemeStore(s => s.showBitrate);
  const psyDrag = useDragDrop();

  const { playTrack, enqueue, openContextMenu, currentTrack } = usePlayerStore(
    useShallow(s => ({
      playTrack: s.playTrack,
      enqueue: s.enqueue,
      openContextMenu: s.openContextMenu,
      currentTrack: s.currentTrack,
    }))
  );

  const [contextMenuSongId, setContextMenuSongId] = useState<string | null>(null);
  const contextMenuOpen = usePlayerStore(s => s.contextMenu.isOpen);

  useEffect(() => {
    if (!contextMenuOpen) setContextMenuSongId(null);
  }, [contextMenuOpen]);

  useEffect(() => {
    if (!query.trim()) { setResults(null); return; }
    setLoading(true);
    search(query, { artistCount: 20, albumCount: 20, songCount: 50 })
      .then(r => setResults(r))
      .finally(() => setLoading(false));
  }, [query, musicLibraryFilterVersion]);

  const hasResults = results && (results.artists.length || results.albums.length || results.songs.length);

  const { orbitActive, addTrackToOrbit } = useOrbitSongRowBehavior();

  const playSong = (song: SubsonicSong, list: SubsonicSong[]) => {
    if (orbitActive) { addTrackToOrbit(song.id); return; }
    playTrack(songToTrack(song), list.map(songToTrack));
  };

  return (
    <div className="content-body animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '3rem' }}>
      <div style={{ marginBottom: '-1.5rem' }}>
        <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <Search size={22} />
          {query ? t('search.resultsFor', { query }) : t('search.title')}
        </h1>
      </div>

      {loading && (
        <div className="loading-center"><div className="spinner" /></div>
      )}

      {!loading && query && !hasResults && (
        <div className="empty-state">{t('search.noResults', { query })}</div>
      )}

      {!loading && results && (
        <>
          {results.artists.length > 0 && (
            <ArtistRow title={t('search.artists')} artists={results.artists} />
          )}

          {results.albums.length > 0 && (
            <AlbumRow title={t('search.albums')} albums={results.albums} />
          )}

          {results.songs.length > 0 && (
            <section className="album-row-section">
              <div className="album-row-header" style={{ marginBottom: '1rem' }}>
                <h2 className="section-title" style={{ marginBottom: 0 }}>{t('search.songs')}</h2>
              </div>
              <div className="tracklist" style={{ padding: 0 }}>
                <div className="tracklist-header" style={{ gridTemplateColumns: '60px minmax(150px, 1fr) minmax(80px, 1fr) minmax(80px, 1fr) 100px 65px' }}>
                  <div />
                  <div>{t('albumDetail.trackTitle')}</div>
                  <div>{t('albumDetail.trackArtist')}</div>
                  <div>{t('search.album')}</div>
                  <div>{t('albumDetail.trackFormat')}</div>
                  <div style={{ textAlign: 'right' }}>{t('albumDetail.trackDuration')}</div>
                </div>
                {results.songs.map(song => (
                  <div
                    key={song.id}
                    className={`track-row${currentTrack?.id === song.id ? ' active' : ''}${contextMenuSongId === song.id ? ' context-active' : ''}`}
                    style={{ gridTemplateColumns: '60px minmax(150px, 1fr) minmax(80px, 1fr) minmax(80px, 1fr) 100px 65px' }}
                    onDoubleClick={() => playSong(song, results.songs)}
                    onContextMenu={e => {
                      e.preventDefault();
                      setContextMenuSongId(song.id);
                      openContextMenu(e.clientX, e.clientY, songToTrack(song), 'album-song');
                    }}
                    role="row"
                    onMouseDown={e => {
                      if (e.button !== 0) return;
                      e.preventDefault();
                      const sx = e.clientX, sy = e.clientY;
                      const track = songToTrack(song);
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
                      onClick={e => { e.stopPropagation(); playSong(song, results.songs); }}
                    >
                      <Play size={14} fill="currentColor" />
                    </button>
                    <div className="track-info">
                      <span className="track-title" title={song.title}>{song.title}</span>
                    </div>
                    <div className="track-artist-cell"><span className="track-artist" title={song.artist}>{song.artist}</span></div>
                    <div className="track-artist-cell"><span className="track-artist" title={song.album}>{song.album}</span></div>
                    <span className="track-codec" style={{ alignSelf: 'center' }}>
                      {[song.suffix?.toUpperCase(), showBitrate && song.bitRate ? `${song.bitRate} kbps` : ''].filter(Boolean).join(' · ')}
                    </span>
                    <span className="track-duration" style={{ textAlign: 'right' }}>
                      {formatDuration(song.duration)}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
