import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getAlbum, getArtist, getArtistInfo, setRating, buildCoverArtUrl, coverArtCacheKey, buildDownloadUrl, star, unstar, SubsonicSong, SubsonicAlbum } from '../api/subsonic';
import { usePlayerStore } from '../store/playerStore';
import { useAuthStore } from '../store/authStore';
import { writeFile } from '@tauri-apps/plugin-fs';
import { join } from '@tauri-apps/api/path';
import AlbumCard from '../components/AlbumCard';
import AlbumHeader from '../components/AlbumHeader';
import AlbumTrackList from '../components/AlbumTrackList';
import { useCachedUrl } from '../components/CachedImage';
import { useTranslation } from 'react-i18next';

function sanitizeFilename(name: string): string {
  return name
    .replace(/[/\\?%*:|"<>]/g, '-')
    .replace(/\.{2,}/g, '.')
    .replace(/^[\s.]+|[\s.]+$/g, '')
    .substring(0, 200) || 'download';
}

export default function AlbumDetail() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const auth = useAuthStore();
  const playTrack = usePlayerStore(s => s.playTrack);
  const enqueue = usePlayerStore(s => s.enqueue);
  const openContextMenu = usePlayerStore(s => s.openContextMenu);
  const currentTrack = usePlayerStore(s => s.currentTrack);
  const isPlaying = usePlayerStore(s => s.isPlaying);

  const [album, setAlbum] = useState<Awaited<ReturnType<typeof getAlbum>> | null>(null);
  const [relatedAlbums, setRelatedAlbums] = useState<SubsonicAlbum[]>([]);
  const [ratings, setRatings] = useState<Record<string, number>>({});
  const [bio, setBio] = useState<string | null>(null);
  const [bioOpen, setBioOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [isStarred, setIsStarred] = useState(false);
  const [starredSongs, setStarredSongs] = useState<Set<string>>(new Set());
  const [hoveredSongId, setHoveredSongId] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    setRelatedAlbums([]);
    getAlbum(id).then(async data => {
      setAlbum(data);
      setIsStarred(!!data.album.starred);
      const initialStarred = new Set<string>();
      data.songs.forEach(s => { if (s.starred) initialStarred.add(s.id); });
      setStarredSongs(initialStarred);
      setLoading(false);
      try {
        const artistData = await getArtist(data.album.artistId);
        setRelatedAlbums(artistData.albums.filter(a => a.id !== id));
      } catch (e) {
        console.error('Failed to fetch related albums', e);
      }
    }).catch(() => setLoading(false));
  }, [id]);

  const handlePlayAll = () => {
    if (!album) return;
    const tracks = album.songs.map(s => ({
      id: s.id, title: s.title, artist: s.artist, album: s.album,
      albumId: s.albumId, artistId: s.artistId, duration: s.duration, coverArt: s.coverArt,
      track: s.track, year: s.year, bitRate: s.bitRate, suffix: s.suffix, userRating: s.userRating,
    }));
    if (tracks[0]) playTrack(tracks[0], tracks);
  };

  const handleEnqueueAll = () => {
    if (!album) return;
    const tracks = album.songs.map(s => ({
      id: s.id, title: s.title, artist: s.artist, album: s.album,
      albumId: s.albumId, artistId: s.artistId, duration: s.duration, coverArt: s.coverArt,
      track: s.track, year: s.year, bitRate: s.bitRate, suffix: s.suffix, userRating: s.userRating,
    }));
    enqueue(tracks);
  };

  const handlePlaySong = (song: SubsonicSong) => {
    const track = {
      id: song.id, title: song.title, artist: song.artist, album: song.album,
      albumId: song.albumId, artistId: song.artistId, duration: song.duration, coverArt: song.coverArt,
      track: song.track, year: song.year, bitRate: song.bitRate, suffix: song.suffix, userRating: song.userRating,
    };
    playTrack(track, [track]);
  };

  const handleRate = async (songId: string, rating: number) => {
    setRatings(r => ({ ...r, [songId]: rating }));
    await setRating(songId, rating);
  };

  const handleBio = async () => {
    if (!album) return;
    if (bio) { setBioOpen(true); return; }
    const info = await getArtistInfo(album.album.artistId);
    setBio(info.biography ?? t('albumDetail.noBio'));
    setBioOpen(true);
  };

  const handleDownload = async () => {
    if (!album) return;
    const { name, id: albumId } = album.album;
    setDownloadProgress(0);
    try {
      const url = buildDownloadUrl(albumId);
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const contentLength = response.headers.get('Content-Length');
      const total = contentLength ? parseInt(contentLength, 10) : 0;
      const chunks: Uint8Array<ArrayBuffer>[] = [];

      if (total && response.body) {
        const reader = response.body.getReader();
        let received = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          received += value.length;
          setDownloadProgress(Math.round((received / total) * 100));
        }
      } else {
        const buffer = await response.arrayBuffer() as ArrayBuffer;
        chunks.push(new Uint8Array(buffer));
        setDownloadProgress(100);
      }

      const blob = new Blob(chunks);
      if (auth.downloadFolder) {
        const buffer = await blob.arrayBuffer();
        const path = await join(auth.downloadFolder, `${sanitizeFilename(name)}.zip`);
        await writeFile(path, new Uint8Array(buffer));
      } else {
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = `${sanitizeFilename(name)}.zip`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(blobUrl), 2000);
      }
    } catch (e) {
      console.error('Download failed:', e);
      setDownloadProgress(null);
    } finally {
      setTimeout(() => setDownloadProgress(null), 60000);
    }
  };

  const toggleStar = async () => {
    if (!album) return;
    const wasStarred = isStarred;
    setIsStarred(!wasStarred);
    try {
      if (wasStarred) await unstar(album.album.id);
      else await star(album.album.id);
    } catch (e) {
      console.error('Failed to toggle star', e);
      setIsStarred(wasStarred);
    }
  };

  const toggleSongStar = async (song: SubsonicSong, e: React.MouseEvent) => {
    e.stopPropagation();
    const wasStarred = starredSongs.has(song.id);
    const next = new Set(starredSongs);
    if (wasStarred) next.delete(song.id); else next.add(song.id);
    setStarredSongs(next);
    try {
      if (wasStarred) await unstar(song.id, 'song');
      else await star(song.id, 'song');
    } catch (err) {
      console.error('Failed to toggle song star', err);
      setStarredSongs(new Set(starredSongs));
    }
  };

  // Hooks must be called unconditionally — derive from nullable album state
  const coverUrl = album?.album.coverArt ? buildCoverArtUrl(album.album.coverArt, 400) : '';
  const coverKey = album?.album.coverArt ? coverArtCacheKey(album.album.coverArt, 400) : '';
  const resolvedCoverUrl = useCachedUrl(coverUrl, coverKey);

  if (loading) return <div className="loading-center"><div className="spinner" /></div>;
  if (!album) return <div className="empty-state">{t('albumDetail.notFound')}</div>;

  const { album: info, songs } = album;
  const hasVariousArtists = songs.some(s => s.artist !== info.artist);

  return (
    <div className="album-detail animate-fade-in">
      <AlbumHeader
        info={info}
        songs={songs}
        coverUrl={coverUrl}
        coverKey={coverKey}
        resolvedCoverUrl={resolvedCoverUrl}
        isStarred={isStarred}
        downloadProgress={downloadProgress}
        bio={bio}
        bioOpen={bioOpen}
        onToggleStar={toggleStar}
        onDownload={handleDownload}
        onPlayAll={handlePlayAll}
        onEnqueueAll={handleEnqueueAll}
        onBio={handleBio}
        onCloseBio={() => setBioOpen(false)}
      />

      <AlbumTrackList
        songs={songs}
        hasVariousArtists={hasVariousArtists}
        currentTrack={currentTrack}
        isPlaying={isPlaying}
        hoveredSongId={hoveredSongId}
        setHoveredSongId={setHoveredSongId}
        ratings={ratings}
        starredSongs={starredSongs}
        onPlaySong={handlePlaySong}
        onRate={handleRate}
        onToggleSongStar={toggleSongStar}
        onContextMenu={openContextMenu}
      />

      {relatedAlbums.length > 0 && (
        <div className="album-related">
          <div className="album-related-divider" />
          <h2 className="section-title album-related-title">{t('albumDetail.moreByArtist', { artist: info.artist })}</h2>
          <div className="album-grid-wrap">
            {relatedAlbums.map(a => <AlbumCard key={a.id} album={a} />)}
          </div>
        </div>
      )}
    </div>
  );
}
