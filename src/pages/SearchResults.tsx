import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Play, Search } from 'lucide-react';
import { search, SearchResults as ISearchResults, SubsonicSong } from '../api/subsonic';
import { usePlayerStore } from '../store/playerStore';
import AlbumRow from '../components/AlbumRow';
import ArtistRow from '../components/ArtistRow';
import { useTranslation } from 'react-i18next';

function formatDuration(s: number) {
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
}

export default function SearchResults() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const query = params.get('q') ?? '';
  const [results, setResults] = useState<ISearchResults | null>(null);
  const [loading, setLoading] = useState(false);
  const playTrack = usePlayerStore(s => s.playTrack);
  const currentTrack = usePlayerStore(s => s.currentTrack);

  useEffect(() => {
    if (!query.trim()) { setResults(null); return; }
    setLoading(true);
    search(query, { artistCount: 20, albumCount: 20, songCount: 50 })
      .then(r => setResults(r))
      .finally(() => setLoading(false));
  }, [query]);

  const hasResults = results && (results.artists.length || results.albums.length || results.songs.length);

  const playSong = (song: SubsonicSong, list: SubsonicSong[]) => {
    playTrack({
      id: song.id, title: song.title, artist: song.artist, album: song.album,
      albumId: song.albumId, artistId: song.artistId, duration: song.duration,
      coverArt: song.coverArt, year: song.year, bitRate: song.bitRate,
      suffix: song.suffix, userRating: song.userRating,
    }, list.map(s => ({
      id: s.id, title: s.title, artist: s.artist, album: s.album,
      albumId: s.albumId, artistId: s.artistId, duration: s.duration,
      coverArt: s.coverArt, year: s.year, bitRate: s.bitRate,
      suffix: s.suffix, userRating: s.userRating,
    })));
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
                <div className="tracklist-header" style={{ gridTemplateColumns: '36px minmax(100px, 2fr) minmax(80px, 1.2fr) minmax(80px, 1.2fr) 100px 60px' }}>
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
                    className={`track-row${currentTrack?.id === song.id ? ' active' : ''}`}
                    style={{ gridTemplateColumns: '36px minmax(100px, 2fr) minmax(80px, 1.2fr) minmax(80px, 1.2fr) 100px 60px' }}
                    onDoubleClick={() => playSong(song, results.songs)}
                    role="row"
                    draggable
                    onDragStart={e => {
                      e.dataTransfer.effectAllowed = 'copy';
                      const track = {
                        id: song.id, title: song.title, artist: song.artist, album: song.album,
                        albumId: song.albumId, artistId: song.artistId, duration: song.duration,
                        coverArt: song.coverArt, year: song.year, bitRate: song.bitRate,
                        suffix: song.suffix, userRating: song.userRating,
                      };
                      e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'song', track }));
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
                      {[song.suffix?.toUpperCase(), song.bitRate ? `${song.bitRate} kbps` : ''].filter(Boolean).join(' · ')}
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
