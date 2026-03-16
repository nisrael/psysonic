import React, { useEffect, useState, useCallback, useRef } from 'react';
import { RefreshCw } from 'lucide-react';
import { getAlbumList, SubsonicAlbum } from '../api/subsonic';
import AlbumCard from '../components/AlbumCard';
import { useTranslation } from 'react-i18next';

const INTERVAL_MS = 30000;
const ALBUM_COUNT = 30;

export default function RandomAlbums() {
  const { t } = useTranslation();
  const [albums, setAlbums] = useState<SubsonicAlbum[]>([]);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const progressRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const loadingRef = useRef(false);

  const clearTimers = () => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (progressRef.current) { clearInterval(progressRef.current); progressRef.current = null; }
  };

  const load = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    try {
      const data = await getAlbumList('random', ALBUM_COUNT);
      setAlbums(data);
    } catch (e) {
      console.error(e);
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, []);

  const startCycle = useCallback(() => {
    clearTimers();
    setProgress(0);
    const startTime = Date.now();
    progressRef.current = setInterval(() => {
      setProgress(Math.min((Date.now() - startTime) / INTERVAL_MS * 100, 100));
    }, 100);
    timerRef.current = setInterval(() => {
      load().then(() => startCycle());
    }, INTERVAL_MS);
  }, [load]);

  useEffect(() => {
    load().then(() => startCycle());
    return clearTimers;
  }, [load, startCycle]);

  const handleManualRefresh = () => {
    clearTimers();
    load().then(() => startCycle());
  };

  return (
    <div className="content-body animate-fade-in">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
        <h1 className="page-title" style={{ marginBottom: 0 }}>{t('randomAlbums.title')}</h1>
        <button
          className="btn btn-ghost"
          onClick={handleManualRefresh}
          disabled={loading}
          data-tooltip={t('randomAlbums.refresh')}
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          {t('randomAlbums.refresh')}
        </button>
      </div>

      {/* Countdown progress bar */}
      <div className="random-albums-progress">
        <div className="random-albums-progress-fill" style={{ width: `${progress}%` }} />
      </div>

      {loading && albums.length === 0 ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '4rem' }}>
          <div className="spinner" />
        </div>
      ) : (
        <div className="album-grid-wrap">
          {albums.map(a => <AlbumCard key={a.id} album={a} />)}
        </div>
      )}
    </div>
  );
}
