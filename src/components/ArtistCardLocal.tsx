import React from 'react';
import { SubsonicArtist, buildCoverArtUrl, coverArtCacheKey } from '../api/subsonic';
import { useNavigate } from 'react-router-dom';
import { Users } from 'lucide-react';
import CachedImage from './CachedImage';

interface Props {
  artist: SubsonicArtist;
}

export default function ArtistCardLocal({ artist }: Props) {
  const navigate = useNavigate();
  const coverId = artist.coverArt || artist.id;

  return (
    <div className="artist-card" onClick={() => navigate(`/artist/${artist.id}`)}>
      <div className="artist-card-avatar">
        {coverId ? (
          <CachedImage
            src={buildCoverArtUrl(coverId, 300)}
            cacheKey={coverArtCacheKey(coverId, 300)}
            alt={artist.name}
            loading="lazy"
            onError={(e) => {
              e.currentTarget.style.display = 'none';
              e.currentTarget.parentElement?.classList.add('fallback-visible');
            }}
          />
        ) : (
          <Users size={32} color="var(--text-muted)" />
        )}
      </div>
      <div className="artist-card-info">
        <span className="artist-card-name" data-tooltip={artist.name}>{artist.name}</span>
        {typeof artist.albumCount === 'number' && (
          <span className="artist-card-meta">
            {artist.albumCount} {artist.albumCount === 1 ? 'Album' : 'Alben'}
          </span>
        )}
      </div>
    </div>
  );
}
