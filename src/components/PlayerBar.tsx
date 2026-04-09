import React, { useCallback, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Play, Pause, SkipBack, SkipForward, Volume2, VolumeX, Music,
  Square, Repeat, Repeat1, Maximize2, SlidersVertical, X, Heart, MicVocal, Cast
} from 'lucide-react';
import { usePlayerStore } from '../store/playerStore';
import { useAuthStore } from '../store/authStore';
import { buildCoverArtUrl, coverArtCacheKey, star, unstar, setRating } from '../api/subsonic';
import CachedImage from './CachedImage';
import WaveformSeek from './WaveformSeek';
import Equalizer from './Equalizer';
import StarRating from './StarRating';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useLyricsStore } from '../store/lyricsStore';
import MarqueeText from './MarqueeText';
import LastfmIcon from './LastfmIcon';

function formatTime(seconds: number): string {
  if (!seconds || isNaN(seconds)) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function PlayerBar() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [eqOpen, setEqOpen] = useState(false);
  const [showVolPct, setShowVolPct] = useState(false);
  const showLyrics   = useLyricsStore(s => s.showLyrics);
  const activeTab    = useLyricsStore(s => s.activeTab);
  const {
    currentTrack, currentRadio, isPlaying, currentTime, volume,
    togglePlay, next, previous, setVolume,
    stop, toggleRepeat, repeatMode, toggleFullscreen,
    lastfmLoved, toggleLastfmLove,
    isQueueVisible, toggleQueue,
    starredOverrides, setStarredOverride,
    userRatingOverrides, setUserRatingOverride,
  } = usePlayerStore();
  const { lastfmSessionKey } = useAuthStore();

  const isRadio = !!currentRadio;

  const isStarred = currentTrack
    ? (currentTrack.id in starredOverrides ? starredOverrides[currentTrack.id] : !!currentTrack.starred)
    : false;

  const toggleStar = useCallback(async () => {
    if (!currentTrack) return;
    const next = !isStarred;
    setStarredOverride(currentTrack.id, next);
    try {
      if (next) await star(currentTrack.id, 'song');
      else await unstar(currentTrack.id, 'song');
    } catch {
      setStarredOverride(currentTrack.id, !next);
    }
  }, [currentTrack, isStarred, setStarredOverride]);

  const duration = currentTrack?.duration ?? 0;

  // Cover art: prefer radio station art, fall back to track art.
  // Note: getCoverArt.view needs ra-{id}, not the raw coverArt filename Navidrome returns.
  const radioCoverSrc = useMemo(
    () => currentRadio?.coverArt ? buildCoverArtUrl(`ra-${currentRadio.id}`, 128) : '',
    [currentRadio?.coverArt, currentRadio?.id]
  );
  const radioCoverKey = currentRadio?.coverArt ? coverArtCacheKey(`ra-${currentRadio.id}`, 128) : '';
  const coverSrc = useMemo(() => currentTrack?.coverArt ? buildCoverArtUrl(currentTrack.coverArt, 128) : '', [currentTrack?.coverArt]);
  const coverKey = currentTrack?.coverArt ? coverArtCacheKey(currentTrack.coverArt, 128) : '';

  const handleVolume = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setVolume(parseFloat(e.target.value));
  }, [setVolume]);

  const handleVolumeWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.05 : 0.05;
    setVolume(Math.max(0, Math.min(1, volume + delta)));
  }, [volume, setVolume]);

  const volumeStyle = {
    background: `linear-gradient(to right, var(--volume-accent, var(--accent)) ${volume * 100}%, var(--ctp-surface2) ${volume * 100}%)`,
  };

  return (
    <footer className="player-bar" role="region" aria-label={t('player.regionLabel')}>

      {/* Track Info */}
      <div className="player-track-info">
        <div
          className={`player-album-art-wrap ${currentTrack && !isRadio ? 'clickable' : ''}`}
          onClick={() => !isRadio && currentTrack && toggleFullscreen()}
          data-tooltip={!isRadio && currentTrack ? t('player.openFullscreen') : undefined}
        >
          {isRadio ? (
            currentRadio?.coverArt ? (
              <CachedImage
                className="player-album-art"
                src={radioCoverSrc}
                cacheKey={radioCoverKey}
                alt={currentRadio.name}
              />
            ) : (
              <div className="player-album-art-placeholder">
                <Cast size={20} />
              </div>
            )
          ) : currentTrack?.coverArt ? (
            <CachedImage
              className="player-album-art"
              src={coverSrc}
              cacheKey={coverKey}
              alt={`${currentTrack.album} Cover`}
            />
          ) : (
            <div className="player-album-art-placeholder">
              <Music size={22} />
            </div>
          )}
          {currentTrack && !isRadio && (
            <div className="player-art-expand-hint" aria-hidden="true">
              <Maximize2 size={16} />
            </div>
          )}
        </div>
        <div className="player-track-meta">
          <MarqueeText
            text={isRadio ? (currentRadio?.name ?? '—') : (currentTrack?.title ?? t('player.noTitle'))}
            className="player-track-name"
            style={{ cursor: !isRadio && currentTrack?.albumId ? 'pointer' : 'default' }}
            onClick={() => !isRadio && currentTrack?.albumId && navigate(`/album/${currentTrack.albumId}`)}
          />
          <MarqueeText
            text={isRadio ? t('radio.liveStream') : (currentTrack?.artist ?? '—')}
            className="player-track-artist"
            style={{ cursor: !isRadio && currentTrack?.artistId ? 'pointer' : 'default' }}
            onClick={() => !isRadio && currentTrack?.artistId && navigate(`/artist/${currentTrack.artistId}`)}
          />
          {currentTrack && !isRadio && (
            <StarRating
              value={userRatingOverrides[currentTrack.id] ?? currentTrack.userRating ?? 0}
              onChange={r => { setUserRatingOverride(currentTrack.id, r); setRating(currentTrack.id, r).catch(() => {}); }}
              className="player-track-rating"
              ariaLabel={t('albumDetail.ratingLabel')}
            />
          )}
        </div>
        {currentTrack && !isRadio && (
          <button
            className={`player-btn player-btn-sm player-star-btn${isStarred ? ' is-starred' : ''}`}
            onClick={toggleStar}
            aria-label={isStarred ? t('contextMenu.unfavorite') : t('contextMenu.favorite')}
            data-tooltip={isStarred ? t('contextMenu.unfavorite') : t('contextMenu.favorite')}
            style={{ flexShrink: 0 }}
          >
            <Heart size={15} fill={isStarred ? 'currentColor' : 'none'} />
          </button>
        )}
        {currentTrack && !isRadio && lastfmSessionKey && (
          <button
            className="player-btn player-btn-sm player-love-btn"
            onClick={toggleLastfmLove}
            aria-label={lastfmLoved ? t('contextMenu.lfmUnlove') : t('contextMenu.lfmLove')}
            data-tooltip={lastfmLoved ? t('contextMenu.lfmUnlove') : t('contextMenu.lfmLove')}
            style={{ color: lastfmLoved ? '#e31c23' : 'var(--text-muted)', flexShrink: 0 }}
          >
            <LastfmIcon size={15} />
          </button>
        )}
      </div>

      {/* Transport Controls */}
      <div className="player-buttons">
        <button className="player-btn player-btn-sm" onClick={stop} aria-label={t('player.stop')} data-tooltip={t('player.stop')}>
          <Square size={14} fill="currentColor" />
        </button>
        <button className="player-btn" onClick={() => previous()} aria-label={t('player.prev')} data-tooltip={t('player.prev')} disabled={isRadio} style={isRadio ? { opacity: 0.3, pointerEvents: 'none' } : undefined}>
          <SkipBack size={19} />
        </button>
        <button
          className="player-btn player-btn-primary"
          onClick={togglePlay}
          aria-label={isPlaying ? t('player.pause') : t('player.play')}
          data-tooltip={isPlaying ? t('player.pause') : t('player.play')}
        >
          {isPlaying ? <Pause size={22} fill="currentColor" /> : <Play size={22} fill="currentColor" />}
        </button>
        <button className="player-btn" onClick={() => next()} aria-label={t('player.next')} data-tooltip={t('player.next')} disabled={isRadio} style={isRadio ? { opacity: 0.3, pointerEvents: 'none' } : undefined}>
          <SkipForward size={19} />
        </button>
        <button
          className="player-btn player-btn-sm"
          onClick={toggleRepeat}
          aria-label={t('player.repeat')}
          data-tooltip={`${t('player.repeat')}: ${repeatMode === 'off' ? t('player.repeatOff') : repeatMode === 'all' ? t('player.repeatAll') : t('player.repeatOne')}`}
          style={{ color: repeatMode !== 'off' ? 'var(--accent)' : undefined }}
        >
          {repeatMode === 'one' ? <Repeat1 size={14} /> : <Repeat size={14} />}
        </button>
      </div>

      {/* Waveform Seekbar / Radio live bar */}
      <div className="player-waveform-section">
        {isRadio ? (
          <>
            <span className="player-time">{formatTime(currentTime)}</span>
            <div className="player-waveform-wrap" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span className="radio-live-badge">{t('radio.live')}</span>
            </div>
            <span className="player-time" style={{ opacity: 0 }}>0:00</span>
          </>
        ) : (
          <>
            <span className="player-time">{formatTime(currentTime)}</span>
            <div className="player-waveform-wrap">
              <WaveformSeek trackId={currentTrack?.id} />
            </div>
            <span className="player-time">{formatTime(duration)}</span>
          </>
        )}
      </div>

      {/* Lyrics Button */}
      <button
        className={`player-btn player-btn-sm ${activeTab === 'lyrics' && isQueueVisible ? 'active' : ''}`}
        onClick={() => { if (!isQueueVisible) toggleQueue(); showLyrics(); }}
        aria-label={t('player.lyrics')}
        data-tooltip={t('player.lyrics')}
      >
        <MicVocal size={15} />
      </button>

      {/* EQ Button */}
      <button
        className={`player-btn player-btn-sm player-eq-btn ${eqOpen ? 'active' : ''}`}
        onClick={() => setEqOpen(v => !v)}
        aria-label="Equalizer"
        data-tooltip="Equalizer"
      >
        <SlidersVertical size={15} />
      </button>

      {/* Volume */}
      <div className="player-volume-section">
        <button
          className="player-btn player-btn-sm"
          onClick={() => setVolume(volume === 0 ? 0.7 : 0)}
          aria-label={t('player.volume')}
          style={{ color: 'var(--text-muted)', flexShrink: 0 }}
        >
          {volume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
        </button>
        <div className="player-volume-slider-wrap" onWheel={handleVolumeWheel}>
          {showVolPct && (
            <span className="player-volume-pct" style={{ left: `${volume * 100}%` }}>
              {Math.round(volume * 100)}%
            </span>
          )}
          <input
            type="range"
            id="player-volume"
            min={0}
            max={1}
            step={0.01}
            value={volume}
            onChange={handleVolume}
            style={volumeStyle}
            aria-label={t('player.volume')}
            className="player-volume-slider"
            onMouseEnter={() => setShowVolPct(true)}
            onMouseLeave={() => setShowVolPct(false)}
          />
        </div>
      </div>

      {/* EQ Popup — rendered via portal to avoid backdrop-filter containing-block issue */}
      {eqOpen && createPortal(
        <>
          <div className="eq-popup-backdrop" onClick={() => setEqOpen(false)} />
          <div className="eq-popup">
            <div className="eq-popup-header">
              <span className="eq-popup-title">Equalizer</span>
              <button className="eq-popup-close" onClick={() => setEqOpen(false)} aria-label="Close">
                <X size={16} />
              </button>
            </div>
            <Equalizer />
          </div>
        </>,
        document.body
      )}

    </footer>
  );
}
