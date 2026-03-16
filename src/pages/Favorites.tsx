import React, { useEffect, useState } from 'react';
import AlbumRow from '../components/AlbumRow';
import ArtistRow from '../components/ArtistRow';
import { getStarred, SubsonicAlbum, SubsonicArtist, SubsonicSong } from '../api/subsonic';
import { usePlayerStore } from '../store/playerStore';
import { Play, ListPlus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

export default function Favorites() {
  const { t } = useTranslation();
  const [albums, setAlbums] = useState<SubsonicAlbum[]>([]);
  const [artists, setArtists] = useState<SubsonicArtist[]>([]);
  const [songs, setSongs] = useState<SubsonicSong[]>([]);
  const [loading, setLoading] = useState(true);

  const { playTrack, enqueue } = usePlayerStore();
  const openContextMenu = usePlayerStore(s => s.openContextMenu);
  const navigate = useNavigate();

  useEffect(() => {
    getStarred()
      .then(res => {
        setAlbums(res.albums);
        setArtists(res.artists);
        setSongs(res.songs);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="content-body" style={{ display: 'flex', justifyContent: 'center', padding: '4rem' }}>
        <div className="spinner" />
      </div>
    );
  }

  const hasAnyFavorites = albums.length > 0 || artists.length > 0 || songs.length > 0;

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

          {songs.length > 0 && (
            <section className="album-row-section">
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '0.75rem' }}>
                <h2 className="section-title" style={{ margin: 0 }}>{t('favorites.songs')}</h2>
                <button
                  className="btn btn-surface"
                  onClick={() => {
                    const tracks = songs.map(s => ({
                      id: s.id, title: s.title, artist: s.artist, album: s.album,
                      albumId: s.albumId, artistId: s.artistId, duration: s.duration, coverArt: s.coverArt,
                      track: s.track, year: s.year, bitRate: s.bitRate, suffix: s.suffix, userRating: s.userRating,
                    }));
                    enqueue(tracks);
                  }}
                >
                  <ListPlus size={15} />
                  {t('favorites.enqueueAll')}
                </button>
              </div>
              <div className="tracklist" style={{ padding: 0 }}>
                <div className="tracklist-header tracklist-va">
                  <div className="col-center">#</div>
                  <div>{t('albumDetail.trackTitle')}</div>
                  <div>{t('albumDetail.trackArtist')}</div>
                  <div className="col-center">{t('albumDetail.trackDuration')}</div>
                </div>
                {songs.map((song, i) => {
                  const track = {
                    id: song.id, title: song.title, artist: song.artist, album: song.album,
                    albumId: song.albumId, artistId: song.artistId, duration: song.duration, coverArt: song.coverArt,
                    track: song.track, year: song.year, bitRate: song.bitRate, suffix: song.suffix, userRating: song.userRating,
                  };
                  return (
                    <div
                      key={song.id}
                      className="track-row track-row-va"
                      onDoubleClick={() => playTrack(song, songs)}
                      onContextMenu={e => { e.preventDefault(); openContextMenu(e.clientX, e.clientY, track, 'song'); }}
                      role="row"
                      draggable
                      onDragStart={e => {
                        e.dataTransfer.effectAllowed = 'copy';
                        e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'song', track }));
                      }}
                    >
                      <div className="track-num col-center" onClick={() => playTrack(song, songs)} style={{ cursor: 'pointer' }}>
                        {i + 1}
                      </div>
                      <div className="track-info">
                        <span className="track-title" data-tooltip={song.title}>{song.title}</span>
                      </div>
                      <div className="track-artist-cell">
                        <span
                          className="track-artist"
                          style={{ cursor: song.artistId ? 'pointer' : 'default' }}
                          onClick={() => song.artistId && navigate(`/artist/${song.artistId}`)}
                        >{song.artist}</span>
                      </div>
                      <div className="track-duration">
                        {Math.floor(song.duration / 60)}:{(song.duration % 60).toString().padStart(2, '0')}
                      </div>
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
