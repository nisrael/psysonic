import React, { memo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Play, HardDriveDownload } from 'lucide-react';
import { SubsonicAlbum, buildCoverArtUrl, coverArtCacheKey } from '../api/subsonic';
import { usePlayerStore } from '../store/playerStore';
import { useOfflineStore } from '../store/offlineStore';
import { useAuthStore } from '../store/authStore';
import CachedImage from './CachedImage';
import { playAlbum } from '../utils/playAlbum';

interface AlbumCardProps {
  album: SubsonicAlbum;
}

function AlbumCard({ album }: AlbumCardProps) {
  const navigate = useNavigate();
  const openContextMenu = usePlayerStore(s => s.openContextMenu);
  const serverId = useAuthStore(s => s.activeServerId ?? '');
  const isOffline = useOfflineStore(s => {
    const meta = s.albums[`${serverId}:${album.id}`];
    if (!meta || meta.trackIds.length === 0) return false;
    return meta.trackIds.every(tid => !!s.tracks[`${serverId}:${tid}`]);
  });
  const coverUrl = album.coverArt ? buildCoverArtUrl(album.coverArt, 300) : '';

  return (
    <div
      className="album-card card"
      onClick={() => navigate(`/album/${album.id}`)}
      role="button"
      tabIndex={0}
      aria-label={`${album.name} von ${album.artist}`}
      onKeyDown={e => e.key === 'Enter' && navigate(`/album/${album.id}`)}
      onContextMenu={(e) => {
        e.preventDefault();
        openContextMenu(e.clientX, e.clientY, album, 'album');
      }}
      draggable
      onDragStart={e => {
        e.dataTransfer.effectAllowed = 'copy';
        e.dataTransfer.setData('text/plain', JSON.stringify({
          type: 'album',
          id: album.id,
          name: album.name,
        }));
      }}
    >
      <div className="album-card-cover">
        {coverUrl ? (
          <CachedImage src={coverUrl} cacheKey={coverArtCacheKey(album.coverArt!, 300)} alt={`${album.name} Cover`} loading="lazy" />
        ) : (
          <div className="album-card-cover-placeholder">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="12" cy="12" r="10"/>
              <circle cx="12" cy="12" r="3"/>
            </svg>
          </div>
        )}
        {isOffline && (
          <div className="album-card-offline-badge" aria-label="Offline available">
            <HardDriveDownload size={12} />
          </div>
        )}
        <div className="album-card-play-overlay">
          <button
            className="album-card-details-btn"
            onClick={e => { e.stopPropagation(); playAlbum(album.id); }}
            aria-label={`${album.name} abspielen`}
          >
            <Play size={15} fill="currentColor" />
          </button>
        </div>
      </div>
      <div className="album-card-info">
        <p className="album-card-title truncate">{album.name}</p>
        <p className="album-card-artist truncate">{album.artist}</p>
        {album.year && <p className="album-card-year">{album.year}</p>}
      </div>
    </div>
  );
}

export default memo(AlbumCard);
