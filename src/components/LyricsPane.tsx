import { useEffect, useRef, useState } from 'react';
import { usePlayerStore } from '../store/playerStore';
import { fetchLyrics, parseLrc, LrcLine } from '../api/lrclib';
import { useTranslation } from 'react-i18next';
import type { Track } from '../store/playerStore';

interface Props {
  currentTrack: Track | null;
}

interface CachedLyrics {
  syncedLines: LrcLine[] | null;
  plainLyrics: string | null;
  notFound: boolean;
}

// Session-level cache — survives tab switches (component unmount/remount).
// Cleared implicitly when the app restarts.
const lyricsCache = new Map<string, CachedLyrics>();

export default function LyricsPane({ currentTrack }: Props) {
  const { t } = useTranslation();

  const cached = currentTrack ? lyricsCache.get(currentTrack.id) : undefined;

  const [loading, setLoading]       = useState(!cached && !!currentTrack);
  const [syncedLines, setSyncedLines] = useState<LrcLine[] | null>(cached?.syncedLines ?? null);
  const [plainLyrics, setPlainLyrics] = useState<string | null>(cached?.plainLyrics ?? null);
  const [notFound, setNotFound]       = useState(cached?.notFound ?? false);

  const hasSynced  = syncedLines !== null && syncedLines.length > 0;
  const currentTime = usePlayerStore(s => hasSynced ? s.currentTime : 0);

  const lineRefs   = useRef<(HTMLDivElement | null)[]>([]);
  const prevActive = useRef(-1);

  useEffect(() => {
    if (!currentTrack) return;

    // Serve from cache if available
    const hit = lyricsCache.get(currentTrack.id);
    if (hit) {
      setSyncedLines(hit.syncedLines);
      setPlainLyrics(hit.plainLyrics);
      setNotFound(hit.notFound);
      setLoading(false);
      lineRefs.current = [];
      prevActive.current = -1;
      return;
    }

    let cancelled = false;
    setSyncedLines(null);
    setPlainLyrics(null);
    setNotFound(false);
    setLoading(true);
    lineRefs.current = [];
    prevActive.current = -1;

    fetchLyrics(
      currentTrack.artist ?? '',
      currentTrack.title,
      currentTrack.album ?? '',
      currentTrack.duration ?? 0,
    ).then(result => {
      if (cancelled) return;
      setLoading(false);
      if (!result || (!result.syncedLyrics && !result.plainLyrics)) {
        lyricsCache.set(currentTrack.id, { syncedLines: null, plainLyrics: null, notFound: true });
        setNotFound(true);
        return;
      }
      const lines = result.syncedLyrics ? parseLrc(result.syncedLyrics) : null;
      const synced = lines && lines.length > 0 ? lines : null;
      lyricsCache.set(currentTrack.id, { syncedLines: synced, plainLyrics: result.plainLyrics, notFound: false });
      setSyncedLines(synced);
      setPlainLyrics(result.plainLyrics);
    }).catch(() => {
      if (!cancelled) {
        lyricsCache.set(currentTrack.id, { syncedLines: null, plainLyrics: null, notFound: true });
        setLoading(false);
        setNotFound(true);
      }
    });
    return () => { cancelled = true; };
  }, [currentTrack?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const activeIdx = hasSynced
    ? syncedLines!.reduce((acc, line, i) => (currentTime >= line.time ? i : acc), -1)
    : -1;

  useEffect(() => {
    if (activeIdx < 0 || activeIdx === prevActive.current) return;
    prevActive.current = activeIdx;
    lineRefs.current[activeIdx]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [activeIdx]);

  if (!currentTrack) {
    return (
      <div className="lyrics-pane-empty">
        <p className="lyrics-status">{t('player.lyricsNotFound')}</p>
      </div>
    );
  }

  return (
    <div className="lyrics-pane">
      {loading && <p className="lyrics-status">{t('player.lyricsLoading')}</p>}
      {notFound && !loading && <p className="lyrics-status">{t('player.lyricsNotFound')}</p>}
      {hasSynced && (
        <div className="lyrics-synced">
          {syncedLines!.map((line, i) => (
            <div
              key={i}
              ref={el => { lineRefs.current[i] = el; }}
              className={`lyrics-line${i === activeIdx ? ' active' : ''}`}
            >
              {line.text || '\u00A0'}
            </div>
          ))}
        </div>
      )}
      {!hasSynced && plainLyrics && (
        <div className="lyrics-plain">
          {plainLyrics.split('\n').map((line, i) => (
            <p key={i} className="lyrics-plain-line">{line || '\u00A0'}</p>
          ))}
        </div>
      )}
    </div>
  );
}
