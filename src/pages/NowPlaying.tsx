import React, { useState, useRef, useEffect, useCallback, memo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Music, Star, ExternalLink, MicVocal, Heart, Cast, Users, Radio, Clock, SkipForward } from 'lucide-react';
import { usePlayerStore } from '../store/playerStore';
import { useAuthStore } from '../store/authStore';
import { useLyricsStore } from '../store/lyricsStore';
import {
  buildCoverArtUrl, coverArtCacheKey, getSong, star, unstar,
  getAlbum, getArtistInfo,
  SubsonicSong, SubsonicArtistInfo,
} from '../api/subsonic';
import { useCachedUrl } from '../components/CachedImage';
import { useRadioMetadata } from '../hooks/useRadioMetadata';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTime(s: number): string {
  if (!s || isNaN(s)) return '0:00';
  const m = Math.floor(s / 60);
  return `${m}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
}

function sanitizeHtml(html: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  doc.querySelectorAll('script, style, iframe, object, embed, form, input, button, select, base, meta, link').forEach(el => el.remove());
  doc.querySelectorAll('*').forEach(el => {
    Array.from(el.attributes).forEach(attr => {
      const name = attr.name.toLowerCase();
      const val = attr.value.toLowerCase().trim();
      if (name.startsWith('on') || (name === 'href' && (val.startsWith('javascript:') || val.startsWith('data:'))) || (name === 'src' && (val.startsWith('javascript:') || val.startsWith('data:')))) {
        el.removeAttribute(attr.name);
      }
    });
  });
  return doc.body.innerHTML;
}

function renderStars(rating?: number) {
  if (!rating) return null;
  return (
    <div style={{ display: 'flex', gap: '3px', alignItems: 'center' }}>
      {[1, 2, 3, 4, 5].map(i => (
        <Star key={i} size={13}
          fill={i <= rating ? 'var(--ctp-yellow)' : 'none'}
          color={i <= rating ? 'var(--ctp-yellow)' : 'var(--ctp-overlay1)'}
        />
      ))}
    </div>
  );
}

// ─── Animated EQ Bars ─────────────────────────────────────────────────────────

const BAR_COUNT = 24;

const EQBars = memo(function EQBars({ isPlaying }: { isPlaying: boolean }) {
  const barsRef    = useRef<(HTMLDivElement | null)[]>([]);
  const heights    = useRef<number[]>(Array.from({ length: BAR_COUNT }, () => 0.08));
  const targets    = useRef<number[]>(Array.from({ length: BAR_COUNT }, () => Math.random() * 0.5 + 0.1));
  const speeds     = useRef<number[]>(Array.from({ length: BAR_COUNT }, () => 0.06 + Math.random() * 0.08));
  const rafRef     = useRef<number>();

  const animate = useCallback(() => {
    heights.current = heights.current.map((h, i) => {
      const t = targets.current[i];
      const newH = h + (t - h) * speeds.current[i];
      if (Math.abs(newH - t) < 0.015) {
        targets.current[i] = Math.random() * 0.88 + 0.06;
        speeds.current[i] = 0.05 + Math.random() * 0.10;
      }
      return newH;
    });
    barsRef.current.forEach((bar, i) => {
      if (bar) bar.style.height = `${Math.round(heights.current[i] * 100)}%`;
    });
    rafRef.current = requestAnimationFrame(animate);
  }, []);

  useEffect(() => {
    if (isPlaying) {
      rafRef.current = requestAnimationFrame(animate);
    } else {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      // Settle bars to a low resting height
      heights.current = heights.current.map(() => 0.08);
      barsRef.current.forEach(bar => {
        if (bar) bar.style.height = '8%';
      });
    }
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [isPlaying, animate]);

  return (
    <div className="np-eq-wrap">
      <div className="np-eq-bars">
        {Array.from({ length: BAR_COUNT }).map((_, i) => (
          <div
            key={i}
            className="np-eq-bar"
            ref={el => { barsRef.current[i] = el; }}
          />
        ))}
      </div>
    </div>
  );
});

// ─── Tag Cloud ────────────────────────────────────────────────────────────────

interface TagCloudProps {
  similarArtists: Array<{ id: string; name: string }>;
  onArtistClick: (id: string) => void;
}

function strHash(s: string): number {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) & 0xffff;
  return h;
}

function TagCloud({ similarArtists, onArtistClick }: TagCloudProps) {
  const { t } = useTranslation();
  if (similarArtists.length === 0) return null;

  const getTagStyle = (name: string, idx: number): React.CSSProperties => {
    const h = strHash(name);
    const sizePool = [10, 11, 12, 13, 14, 15, 16];
    const size = sizePool[(h + idx * 7) % sizePool.length];
    const weight = size >= 15 ? 600 : size >= 13 ? 500 : 400;
    const pad = size >= 15 ? '5px 10px' : '4px 8px';
    const opacity = 0.6 + ((h % 5) * 0.08);
    const verticals = [-5, -3, -1, 0, 2, 4, 5, -4, 2, -2, 4, 0, 3, -3, 1];
    const ty = verticals[(h + idx * 4) % verticals.length];
    return { fontSize: `${size}px`, fontWeight: weight, padding: pad, opacity, transform: `translateY(${ty}px)` };
  };

  return (
    <div className="np-tag-cloud">
      <div className="np-tag-cloud-header">{t('artistDetail.similarArtists')}</div>
      {([similarArtists.slice(0, 3), similarArtists.slice(3, 6)] as const).map((row, rowIdx) => (
        <div key={rowIdx} className="np-tag-cloud-tags" style={rowIdx === 0 ? { marginBottom: '14px' } : undefined}>
          {row.map((a, i) => (
            <span
              key={a.id}
              className="np-tag np-tag-clickable"
              style={getTagStyle(a.name, rowIdx * 3 + i)}
              onClick={() => onArtistClick(a.id)}
              data-tooltip={t('nowPlaying.goToArtist')}
            >
              {a.name}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}


// ─── Album Tracklist ──────────────────────────────────────────────────────────

interface NpTrackListProps {
  albumTracks: SubsonicSong[];
  currentTrackId: string;
  album: string;
  albumId?: string;
  onNavigate: (path: string) => void;
}

const NpTrackList = memo(function NpTrackList({ albumTracks, currentTrackId, album, albumId, onNavigate }: NpTrackListProps) {
  const { t } = useTranslation();
  if (albumTracks.length === 0) return null;
  return (
    <div className="np-info-card">
      <div className="np-card-header">
        <h3 className="np-card-title">{t('nowPlaying.fromAlbum')}: <em style={{ fontStyle: 'normal', color: 'var(--text-muted)' }}>{album}</em></h3>
        {albumId && (
          <button className="np-card-link" onClick={() => onNavigate(`/album/${albumId}`)}>
            {t('nowPlaying.viewAlbum')} <ExternalLink size={12} />
          </button>
        )}
      </div>
      <div className="np-album-tracklist">
        {albumTracks.map(track => {
          const isActive = track.id === currentTrackId;
          return (
            <div key={track.id}
              className={`np-album-track${isActive ? ' active' : ''}`}
              onClick={() => albumId && onNavigate(`/album/${albumId}`)}
            >
              <span className="np-album-track-num">
                {isActive
                  ? <Star size={10} fill="var(--accent)" color="var(--accent)" />
                  : track.track ?? '—'
                }
              </span>
              <span className="np-album-track-title truncate">{track.title}</span>
              <span className="np-album-track-dur">{formatTime(track.duration)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
});

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function NowPlaying() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const currentTrack    = usePlayerStore(s => s.currentTrack);
  const currentRadio    = usePlayerStore(s => s.currentRadio);
  const userRatingOverrides = usePlayerStore(s => s.userRatingOverrides);
  const isPlaying       = usePlayerStore(s => s.isPlaying);
  const showLyrics      = useLyricsStore(s => s.showLyrics);
  const activeTab       = useLyricsStore(s => s.activeTab);
  const isQueueVisible  = usePlayerStore(s => s.isQueueVisible);
  const toggleQueue     = usePlayerStore(s => s.toggleQueue);
  const audiomuseNavidromeEnabled = useAuthStore(
    s => !!(s.activeServerId && s.audiomuseNavidromeByServer[s.activeServerId]),
  );

  const stableNavigate = useCallback((path: string) => navigate(path), [navigate]);

  // Radio metadata (ICY or AzuraCast)
  const radioMeta = useRadioMetadata(currentRadio ?? null);

  // Extra song metadata
  const [songMeta, setSongMeta] = useState<SubsonicSong | null>(null);
  useEffect(() => {
    if (!currentTrack) { setSongMeta(null); return; }
    getSong(currentTrack.id).then(setSongMeta);
  }, [currentTrack?.id]);

  // Artist info (bio + similar artists)
  const [artistInfo, setArtistInfo] = useState<SubsonicArtistInfo | null>(null);
  useEffect(() => {
    if (!currentTrack?.artistId) { setArtistInfo(null); return; }
    getArtistInfo(currentTrack.artistId, { similarArtistCount: audiomuseNavidromeEnabled ? 24 : undefined })
      .then(setArtistInfo)
      .catch(() => setArtistInfo(null));
  }, [currentTrack?.artistId, audiomuseNavidromeEnabled]);

  // Album tracks
  const [albumTracks, setAlbumTracks] = useState<SubsonicSong[]>([]);
  useEffect(() => {
    if (!currentTrack?.albumId) { setAlbumTracks([]); return; }
    getAlbum(currentTrack.albumId).then(d => setAlbumTracks(d.songs)).catch(() => setAlbumTracks([]));
  }, [currentTrack?.albumId]);

  // Bio expand toggle
  const [bioExpanded, setBioExpanded] = useState(false);
  useEffect(() => { setBioExpanded(false); }, [currentTrack?.artistId]);

  // Favorite
  const [starred, setStarred] = useState(false);
  useEffect(() => { setStarred(!!songMeta?.starred); }, [songMeta]);
  const toggleStar = async () => {
    if (!currentTrack) return;
    if (starred) { await unstar(currentTrack.id, 'song'); setStarred(false); }
    else          { await star(currentTrack.id, 'song');   setStarred(true);  }
  };

  // Cover
  const coverFetchUrl = currentTrack?.coverArt ? buildCoverArtUrl(currentTrack.coverArt, 800) : '';
  const coverKey      = currentTrack?.coverArt ? coverArtCacheKey(currentTrack.coverArt, 800) : '';
  const resolvedCover = useCachedUrl(coverFetchUrl, coverKey);

  // Radio cover
  const radioCoverFetchUrl = currentRadio?.coverArt ? buildCoverArtUrl(`ra-${currentRadio.id}`, 800) : '';
  const radioCoverKey      = currentRadio?.coverArt ? coverArtCacheKey(`ra-${currentRadio.id}`, 800) : '';
  const resolvedRadioCover = useCachedUrl(radioCoverFetchUrl, radioCoverKey);

  const similarArtists = artistInfo?.similarArtist ?? [];

  // ── Radio now-playing section ────────────────────────────────────────────────
  const radioNowPlaying = currentRadio && !currentTrack && (
    <div className="np-radio-section">

      {/* Station hero */}
      <div className="np-hero-card">
        <div className="np-hero-left">
          <div className="np-hero-info">
            <div className="np-title" style={{ color: 'var(--accent)' }}>
              {currentRadio.name}
            </div>
            {radioMeta.currentTitle && (
              <div className="np-artist-album">
                {radioMeta.currentArtist && (
                  <><span className="np-link">{radioMeta.currentArtist}</span><span className="np-sep">·</span></>
                )}
                <span>{radioMeta.currentTitle}</span>
                {radioMeta.currentAlbum && (
                  <><span className="np-sep">·</span><span style={{ opacity: 0.6 }}>{radioMeta.currentAlbum}</span></>
                )}
              </div>
            )}
            <div className="np-tech-row">
              <span className="np-badge np-badge-live">
                <Radio size={10} style={{ marginRight: 3 }} />{t('radio.live')}
              </span>
              {radioMeta.source === 'azuracast' && (
                <span className="np-badge np-badge-azuracast">AzuraCast</span>
              )}
              {radioMeta.listeners != null && (
                <span className="np-badge">
                  <Users size={10} style={{ marginRight: 3 }} />
                  {t('radio.listenerCount', { count: radioMeta.listeners })}
                </span>
              )}
            </div>

            {/* AzuraCast progress bar */}
            {radioMeta.source === 'azuracast' && radioMeta.elapsed != null && radioMeta.duration != null && radioMeta.duration > 0 && (
              <div className="np-radio-progress-wrap">
                <span className="np-radio-time">{formatTime(radioMeta.elapsed)}</span>
                <div className="np-radio-progress-bar">
                  <div
                    className="np-radio-progress-fill"
                    style={{ width: `${Math.min(100, (radioMeta.elapsed / radioMeta.duration) * 100)}%` }}
                  />
                </div>
                <span className="np-radio-time">{formatTime(radioMeta.duration)}</span>
              </div>
            )}
          </div>
        </div>

        {/* Cover */}
        <div className="np-hero-cover-wrap">
          {resolvedRadioCover
            ? <img src={resolvedRadioCover} alt={currentRadio.name} className="np-cover" />
            : radioMeta.currentArt
              ? <img src={radioMeta.currentArt} alt="" className="np-cover" onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
              : <div className="np-cover np-cover-fallback"><Cast size={52} /></div>
          }
        </div>

        {/* Placeholder to keep 3-column layout */}
        <div style={{ flex: 1 }} />
      </div>

      {/* Upcoming track */}
      {radioMeta.nextSong && (
        <div className="np-info-card">
          <div className="np-card-header">
            <h3 className="np-card-title">
              <SkipForward size={13} style={{ marginRight: 5 }} />{t('radio.upNext')}
            </h3>
          </div>
          <div className="np-radio-next-track">
            {radioMeta.nextSong.art && (
              <img src={radioMeta.nextSong.art} alt="" className="np-radio-track-art"
                onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
            )}
            <div className="np-radio-track-info">
              <span className="np-radio-track-title">{radioMeta.nextSong.title}</span>
              {radioMeta.nextSong.artist && (
                <span className="np-radio-track-artist">{radioMeta.nextSong.artist}</span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Song history */}
      {radioMeta.history.length > 0 && (
        <div className="np-info-card">
          <div className="np-card-header">
            <h3 className="np-card-title">
              <Clock size={13} style={{ marginRight: 5 }} />{t('radio.recentlyPlayed')}
            </h3>
          </div>
          <div className="np-album-tracklist">
            {radioMeta.history.map((item, idx) => (
              <div key={idx} className="np-album-track">
                {item.song.art && (
                  <img src={item.song.art} alt="" className="np-radio-track-art np-radio-track-art--sm"
                    onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                )}
                <span className="np-album-track-title truncate">
                  {item.song.artist ? `${item.song.artist} — ${item.song.title}` : item.song.title}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="np-page">

      <div className="np-main">
        {radioNowPlaying ? (
          radioNowPlaying
        ) : currentTrack ? (
          <>
            {/* ── Hero Card ── */}
            <div className="np-hero-card">

              {/* Left: meta info */}
              <div className="np-hero-left">
                <div className="np-hero-info">
                  <div className="np-title" style={{ color: 'var(--accent)' }}>{currentTrack.title}</div>
                  <div className="np-artist-album">
                    <span className="np-link"
                      onClick={() => currentTrack.artistId && navigate(`/artist/${currentTrack.artistId}`)}
                      style={{ cursor: currentTrack.artistId ? 'pointer' : 'default' }}
                    >{currentTrack.artist}</span>
                    <span className="np-sep">·</span>
                    <span className="np-link"
                      onClick={() => currentTrack.albumId && navigate(`/album/${currentTrack.albumId}`)}
                      style={{ cursor: currentTrack.albumId ? 'pointer' : 'default' }}
                    >{currentTrack.album}</span>
                    {currentTrack.year && <><span className="np-sep">·</span><span>{currentTrack.year}</span></>}
                  </div>
                  <div className="np-tech-row">
                    {songMeta?.genre && <span className="np-badge">{songMeta.genre}</span>}
                    {currentTrack.suffix && <span className="np-badge">{currentTrack.suffix.toUpperCase()}</span>}
                    {currentTrack.bitRate && <span className="np-badge">{currentTrack.bitRate} kbps</span>}
                    {currentTrack.duration && <span className="np-badge">{formatTime(currentTrack.duration)}</span>}
                    {renderStars(userRatingOverrides[currentTrack.id] ?? currentTrack.userRating)}
                    <button onClick={toggleStar} className="np-star-btn"
                      data-tooltip={starred ? t('contextMenu.unfavorite') : t('contextMenu.favorite')}
                    >
                      <Heart size={17} fill={starred ? 'var(--ctp-yellow)' : 'none'} color={starred ? 'var(--ctp-yellow)' : 'currentColor'} />
                    </button>
                    <button
                      className="np-star-btn"
                      onClick={() => { if (!isQueueVisible) toggleQueue(); showLyrics(); }}
                      data-tooltip={t('player.lyrics')}
                      style={{ color: activeTab === 'lyrics' && isQueueVisible ? 'var(--accent)' : undefined }}
                    >
                      <MicVocal size={17} />
                    </button>
                  </div>
                </div>
              </div>

              {/* Center: cover */}
              <div className="np-hero-cover-wrap">
                {resolvedCover
                  ? <img src={resolvedCover} alt="" className="np-cover" />
                  : <div className="np-cover np-cover-fallback"><Music size={52} /></div>
                }
              </div>

              {/* Right: tag cloud */}
              <TagCloud
                similarArtists={similarArtists}
                onArtistClick={id => navigate(`/artist/${id}`)}
              />

            </div>

            {/* ── About the Artist ── */}
            {artistInfo?.biography && (
              <div className="np-info-card">
                <div className="np-card-header">
                  <h3 className="np-card-title">{t('nowPlaying.aboutArtist')}</h3>
                  {currentTrack.artistId && (
                    <button className="np-card-link" onClick={() => navigate(`/artist/${currentTrack.artistId}`)}>
                      {t('nowPlaying.goToArtist')} <ExternalLink size={12} />
                    </button>
                  )}
                </div>
                <div className="np-artist-bio-row">
                  {artistInfo.largeImageUrl && (
                    <img
                      src={artistInfo.largeImageUrl}
                      alt={currentTrack.artist}
                      className="np-artist-thumb"
                      onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                    />
                  )}
                  <div className="np-bio-wrap">
                    <div
                      className={`np-bio-text${bioExpanded ? ' expanded' : ''}`}
                      dangerouslySetInnerHTML={{ __html: sanitizeHtml(artistInfo.biography) }}
                    />
                    <button className="np-bio-toggle" onClick={() => setBioExpanded(v => !v)}>
                      {bioExpanded ? t('nowPlaying.showLess') : t('nowPlaying.readMore')}
                    </button>
                  </div>
                </div>
              </div>
            )}

            <NpTrackList
              albumTracks={albumTracks}
              currentTrackId={currentTrack.id}
              album={currentTrack.album}
              albumId={currentTrack.albumId}
              onNavigate={stableNavigate}
            />
          </>
        ) : (
          <div className="np-empty-state">
            <Music size={48} style={{ opacity: 0.3 }} />
            <p>{t('nowPlaying.nothingPlaying')}</p>
          </div>
        )}
      </div>
    </div>
  );
}
