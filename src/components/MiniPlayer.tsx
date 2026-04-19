import React, { useCallback, useEffect, useRef, useState } from 'react';
import { emit, listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import { Play, Pause, SkipBack, SkipForward, Pin, PinOff, Maximize2, X, ListMusic } from 'lucide-react';
import CachedImage from './CachedImage';
import { buildCoverArtUrl, coverArtCacheKey } from '../api/subsonic';
import { usePlayerStore } from '../store/playerStore';
import { useKeybindingsStore, matchInAppBinding } from '../store/keybindingsStore';
import { useDragDrop } from '../contexts/DragDropContext';
import { IS_MACOS } from '../utils/platform';
import MiniContextMenu from './MiniContextMenu';
import type { MiniSyncPayload, MiniControlAction, MiniTrackInfo } from '../utils/miniPlayerBridge';

const COLLAPSED_SIZE = { w: 340, h: 180 };
const EXPANDED_SIZE  = { w: 340, h: 440 };
// Minimum window dimensions per state. When the queue is open the floor must
// keep at least two queue rows visible; a stricter min would let the user
// collapse the queue area to nothing while it's still toggled on.
const COLLAPSED_MIN  = { w: 320, h: 180 };
const EXPANDED_MIN   = { w: 320, h: 260 };

// Persist the expanded-window height so reopening the queue restores the
// user's preferred size instead of snapping back to EXPANDED_SIZE.h.
const EXPANDED_H_KEY = 'psysonic_mini_expanded_h';
function readStoredExpandedHeight(): number {
  try {
    const raw = localStorage.getItem(EXPANDED_H_KEY);
    if (raw) {
      const n = parseInt(raw, 10);
      if (Number.isFinite(n) && n >= EXPANDED_MIN.h) return n;
    }
  } catch {}
  return EXPANDED_SIZE.h;
}

// Persist whether the queue panel was open so the next launch restores
// the same state. Same scope as the height: localStorage of the mini
// webview (shared across mini sessions, separate from the main store).
const QUEUE_OPEN_KEY = 'psysonic_mini_queue_open';
function readQueueOpen(): boolean {
  try { return localStorage.getItem(QUEUE_OPEN_KEY) === '1'; } catch { return false; }
}

function toMini(t: any): MiniTrackInfo {
  return {
    id: t.id,
    title: t.title,
    artist: t.artist,
    album: t.album,
    albumId: t.albumId,
    artistId: t.artistId,
    coverArt: t.coverArt,
    duration: t.duration,
    starred: !!t.starred,
  };
}

/**
 * Hydrate from the persisted playerStore so initial paint shows real content
 * instead of "—" while we wait for the mini:sync event from the main window.
 * The persisted state covers the cold-start window (webview boot + bundle).
 */
function initialSnapshot(): MiniSyncPayload {
  try {
    const s = usePlayerStore.getState();
    return {
      track: s.currentTrack ? toMini(s.currentTrack) : null,
      queue: (s.queue ?? []).map(toMini),
      queueIndex: s.queueIndex ?? 0,
      isPlaying: s.isPlaying,
      isMobile: false,
    };
  } catch {
    return { track: null, queue: [], queueIndex: 0, isPlaying: false, isMobile: false };
  }
}

interface ProgressPayload {
  current_time: number;
  duration: number;
}

function fmt(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) seconds = 0;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function MiniPlayer() {
  const { t } = useTranslation();
  const [state, setState] = useState<MiniSyncPayload>(() => initialSnapshot());
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(() => {
    const initial = initialSnapshot();
    return initial.track?.duration ?? 0;
  });
  const [alwaysOnTop, setAlwaysOnTop] = useState(true);
  const [queueOpen, setQueueOpen] = useState(readQueueOpen);
  const [scrollMeta, setScrollMeta] = useState({ thumbH: 0, thumbT: 0, visible: false });
  const ticker = useRef<number | null>(null);
  const queueScrollRef = useRef<HTMLDivElement>(null);

  // ── PsyDnD reorder ──
  // Mirrors QueuePanel's pattern: mousedown threshold → startDrag, mousemove
  // on the queue computes a drop indicator, psy-drop emits mini:reorder back
  // to main where the source-of-truth store lives.
  const { isDragging: isPsyDragging, startDrag, payload: psyPayload } = useDragDrop();
  const psyDragFromIdxRef = useRef<number | null>(null);
  const [dropTarget, setDropTarget] = useState<{ idx: number; before: boolean } | null>(null);
  const dropTargetRef = useRef<{ idx: number; before: boolean } | null>(null);

  const isReorderDrag = isPsyDragging && !!psyPayload && (() => {
    try { return JSON.parse(psyPayload.data).type === 'queue_reorder'; } catch { return false; }
  })();

  useEffect(() => {
    if (!isPsyDragging) {
      dropTargetRef.current = null;
      setDropTarget(null);
    }
  }, [isPsyDragging]);

  // ── Context menu state ──
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; track: MiniTrackInfo; index: number } | null>(null);

  // Compute overlay-scrollbar thumb height + offset from the queue's scroll
  // metrics. Native scrollbar is hidden via CSS; this thumb floats over the
  // items so the queue keeps its full width.
  const recomputeScroll = useCallback(() => {
    const el = queueScrollRef.current;
    if (!el) return;
    const { scrollTop, scrollHeight, clientHeight } = el;
    if (scrollHeight <= clientHeight + 1) {
      setScrollMeta(prev => (prev.visible ? { thumbH: 0, thumbT: 0, visible: false } : prev));
      return;
    }
    const ratio = clientHeight / scrollHeight;
    const thumbH = Math.max(24, Math.round(ratio * clientHeight));
    const range = clientHeight - thumbH;
    const scrollRange = scrollHeight - clientHeight;
    const thumbT = scrollRange > 0 ? Math.round((scrollTop / scrollRange) * range) : 0;
    setScrollMeta({ thumbH, thumbT, visible: true });
  }, []);

  // Announce to main window that we're mounted; it replies with a snapshot.
  useEffect(() => {
    emit('mini:ready', {}).catch(() => {});
  }, []);

  // Restore the expanded window size on initial mount when the queue was
  // open at the previous app close. Rust always builds the window at the
  // collapsed size; without this we'd render queueOpen=true into a 180 px
  // window. Brief jump from collapsed to expanded is unavoidable since
  // localStorage only lives in JS.
  useEffect(() => {
    if (!queueOpen) return;
    invoke('resize_mini_player', {
      width: EXPANDED_SIZE.w,
      height: readStoredExpandedHeight(),
      minWidth: EXPANDED_MIN.w,
      minHeight: EXPANDED_MIN.h,
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-apply pin state on mount and whenever the window regains focus.
  // After a Hide → Show cycle (which is what `open_mini_player` does on
  // re-toggle) the WM often drops the always-on-top constraint silently;
  // re-asserting it here means the user no longer has to click the pin
  // button twice to make it stick.
  useEffect(() => {
    invoke('set_mini_player_always_on_top', { onTop: alwaysOnTop }).catch(() => {});
    const reapply = () => {
      if (alwaysOnTop) {
        invoke('set_mini_player_always_on_top', { onTop: true }).catch(() => {});
      }
    };
    window.addEventListener('focus', reapply);
    return () => window.removeEventListener('focus', reapply);
  }, [alwaysOnTop]);

  // Keyboard: Space → toggle, ← / → → prev / next. Ignore when typing.
  // Also honour the user-configured 'open-mini-player' shortcut so the
  // same chord that opens the mini from main also closes it from here.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tgt = e.target as HTMLElement | null;
      const tag = tgt?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tgt?.isContentEditable) return;

      const openMiniBinding = useKeybindingsStore.getState().bindings['open-mini-player'];
      if (matchInAppBinding(e, openMiniBinding)) {
        e.preventDefault();
        invoke('open_mini_player').catch(() => {});
        return;
      }

      if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        emit('mini:control', 'toggle').catch(() => {});
      } else if (e.key === 'ArrowRight') {
        emit('mini:control', 'next').catch(() => {});
      } else if (e.key === 'ArrowLeft') {
        emit('mini:control', 'prev').catch(() => {});
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Subscribe to state + progress from the main window / Rust.
  useEffect(() => {
    const unSync = listen<MiniSyncPayload>('mini:sync', (e) => {
      setState(e.payload);
      if (e.payload.track?.duration) setDuration(e.payload.track.duration);
    });
    const unProgress = listen<ProgressPayload>('audio:progress', (e) => {
      setCurrentTime(e.payload.current_time);
      if (e.payload.duration > 0) setDuration(e.payload.duration);
    });
    const unEnded = listen('audio:ended', () => setCurrentTime(0));
    return () => {
      unSync.then(fn => fn()).catch(() => {});
      unProgress.then(fn => fn()).catch(() => {});
      unEnded.then(fn => fn()).catch(() => {});
      if (ticker.current) window.clearInterval(ticker.current);
    };
  }, []);

  const control = (action: MiniControlAction) => emit('mini:control', action).catch(() => {});

  const toggleOnTop = async () => {
    const next = !alwaysOnTop;
    setAlwaysOnTop(next);
    try { await invoke('set_mini_player_always_on_top', { onTop: next }); } catch {}
  };

  const closeMini = async () => {
    try { await invoke('close_mini_player'); } catch {}
  };

  const showMain = () => invoke('show_main_window').catch(() => {});

  const toggleQueue = async () => {
    const next = !queueOpen;
    // Capture the current expanded height before collapsing so the next
    // open restores it. Read window.innerHeight directly — it matches the
    // logical inner size that resize_mini_player set previously.
    if (!next) {
      const h = Math.round(window.innerHeight);
      if (h >= EXPANDED_MIN.h) {
        try { localStorage.setItem(EXPANDED_H_KEY, String(h)); } catch {}
      }
    }
    setQueueOpen(next);
    try { localStorage.setItem(QUEUE_OPEN_KEY, next ? '1' : '0'); } catch {}
    const targetH = next ? readStoredExpandedHeight() : COLLAPSED_SIZE.h;
    const targetW = next ? EXPANDED_SIZE.w : COLLAPSED_SIZE.w;
    const min = next ? EXPANDED_MIN : COLLAPSED_MIN;
    try {
      await invoke('resize_mini_player', {
        width: targetW,
        height: targetH,
        minWidth: min.w,
        minHeight: min.h,
      });
    } catch {}
  };

  const jumpTo = (index: number) => emit('mini:jump', { index }).catch(() => {});

  // Listen for psy-drop on the queue. Only handles `queue_reorder` payloads
  // since the mini player has no external drag sources. `queueOpen` must be
  // in deps because the wrap (and thus queueScrollRef.current) only mounts
  // when the queue is expanded — without it the ref is null on first run
  // and the listener never attaches.
  useEffect(() => {
    if (!queueOpen) return;
    const el = queueScrollRef.current;
    if (!el) return;
    const onPsyDrop = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail?.data) return;
      let parsed: any = null;
      try { parsed = JSON.parse(detail.data); } catch { return; }
      const tgt = dropTargetRef.current;
      dropTargetRef.current = null;
      setDropTarget(null);
      if (parsed.type !== 'queue_reorder') return;
      const fromIdx = parsed.index as number;
      psyDragFromIdxRef.current = null;
      const queueLen = usePlayerStore.getState().queue.length || state.queue.length;
      const insertIdx = tgt
        ? (tgt.before ? tgt.idx : tgt.idx + 1)
        : queueLen;
      if (fromIdx === insertIdx || fromIdx === insertIdx - 1) return;
      // Adjust target index if removing the source first shifts later items.
      const adjusted = fromIdx < insertIdx ? insertIdx - 1 : insertIdx;
      if (fromIdx === adjusted) return;
      emit('mini:reorder', { from: fromIdx, to: adjusted }).catch(() => {});
    };
    el.addEventListener('psy-drop', onPsyDrop);
    return () => el.removeEventListener('psy-drop', onPsyDrop);
  }, [queueOpen, state.queue.length]);

  // Auto-scroll the current track into view when the queue expands.
  useEffect(() => {
    if (!queueOpen) return;
    const el = queueScrollRef.current?.querySelector<HTMLElement>('.mini-queue__item--current');
    el?.scrollIntoView({ block: 'nearest' });
  }, [queueOpen, state.queueIndex]);

  // Recompute overlay-thumb on open, queue mutations, and window resize.
  useEffect(() => {
    if (!queueOpen) return;
    recomputeScroll();
    const onResize = () => recomputeScroll();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [queueOpen, state.queue.length, recomputeScroll]);

  const { track, isPlaying } = state;
  const progress = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;

  return (
    <div className="mini-player-shell">
      <div
        className={`mini-player__titlebar${IS_MACOS ? ' mini-player__titlebar--mac' : ''}`}
        {...(IS_MACOS ? {} : { 'data-tauri-drag-region': true })}
      >
        {!IS_MACOS ? (
          <span className="mini-player__titlebar-title" data-tauri-drag-region>
            {track?.title ?? 'Psysonic Mini'}
          </span>
        ) : (
          // macOS already shows the track title in the native titlebar; we
          // just need a flexible spacer so the action buttons sit right.
          <span className="mini-player__titlebar-spacer" />
        )}
        <button
          type="button"
          className={`mini-player__titlebar-btn${queueOpen ? ' mini-player__titlebar-btn--active' : ''}`}
          onClick={toggleQueue}
          data-tauri-drag-region="false"
          data-tooltip={queueOpen ? t('miniPlayer.hideQueue') : t('miniPlayer.showQueue')}
          aria-label={queueOpen ? t('miniPlayer.hideQueue') : t('miniPlayer.showQueue')}
        >
          <ListMusic size={13} />
        </button>
        <button
          type="button"
          className={`mini-player__titlebar-btn${alwaysOnTop ? ' mini-player__titlebar-btn--active' : ''}`}
          onClick={toggleOnTop}
          data-tauri-drag-region="false"
          data-tooltip={alwaysOnTop ? t('miniPlayer.pinOff') : t('miniPlayer.pinOnTop')}
          aria-label={alwaysOnTop ? t('miniPlayer.pinOff') : t('miniPlayer.pinOnTop')}
        >
          {alwaysOnTop ? <Pin size={13} /> : <PinOff size={13} />}
        </button>
        <button
          type="button"
          className="mini-player__titlebar-btn"
          onClick={showMain}
          data-tauri-drag-region="false"
          data-tooltip={t('miniPlayer.openMainWindow')}
          aria-label={t('miniPlayer.openMainWindow')}
        >
          <Maximize2 size={13} />
        </button>
        {/* macOS already provides Close via the red traffic light — skip
            the duplicate so the in-app titlebar stays minimal. */}
        {!IS_MACOS && (
          <button
            type="button"
            className="mini-player__titlebar-btn mini-player__titlebar-btn--close"
            onClick={closeMini}
            data-tauri-drag-region="false"
            data-tooltip={t('miniPlayer.close')}
            aria-label={t('miniPlayer.close')}
          >
            <X size={13} />
          </button>
        )}
      </div>

      <div className={`mini-player${queueOpen ? ' mini-player--queue-open' : ''}`}>
        <div className="mini-player__art">
          {track?.coverArt ? (
            <CachedImage
              src={buildCoverArtUrl(track.coverArt, 300)}
              cacheKey={coverArtCacheKey(track.coverArt, 300)}
              alt={track.album}
            />
          ) : (
            <div className="mini-player__art-fallback" />
          )}
        </div>

        <div className="mini-player__body" data-tauri-drag-region="false">
          <div className="mini-player__titles">
            <div className="mini-player__title" title={track?.title}>
              {track?.title ?? '—'}
            </div>
            <div className="mini-player__artist" title={track?.artist}>
              {track?.artist ?? ''}
            </div>
          </div>

          <div className="mini-player__controls">
            <button className="mini-player__btn" onClick={() => control('prev')} data-tauri-drag-region="false">
              <SkipBack size={16} />
            </button>
            <button className="mini-player__btn mini-player__btn--primary" onClick={() => control('toggle')} data-tauri-drag-region="false">
              {isPlaying ? <Pause size={18} /> : <Play size={18} />}
            </button>
            <button className="mini-player__btn" onClick={() => control('next')} data-tauri-drag-region="false">
              <SkipForward size={16} />
            </button>
          </div>
        </div>

        <div className="mini-player__progress" data-tauri-drag-region="false">
          <div className="mini-player__progress-time">{fmt(currentTime)}</div>
          <div className="mini-player__progress-track">
            <div className="mini-player__progress-fill" style={{ width: `${progress}%` }} />
          </div>
          <div className="mini-player__progress-time">{fmt(duration)}</div>
        </div>

        {queueOpen && (
        <div
          className={`mini-queue-wrap${isReorderDrag ? ' mini-queue-wrap--drop-active' : ''}`}
          onMouseMove={(e) => {
            if (!isReorderDrag || !queueScrollRef.current) return;
            const items = queueScrollRef.current.querySelectorAll<HTMLElement>('[data-mq-idx]');
            for (let i = 0; i < items.length; i++) {
              const r = items[i].getBoundingClientRect();
              if (e.clientY >= r.top && e.clientY <= r.bottom) {
                const before = e.clientY < r.top + r.height / 2;
                const idx = parseInt(items[i].dataset.mqIdx!, 10);
                const t = { idx, before };
                dropTargetRef.current = t;
                setDropTarget(t);
                return;
              }
            }
            dropTargetRef.current = null;
            setDropTarget(null);
          }}
        >
          <div className="mini-queue" ref={queueScrollRef} onScroll={recomputeScroll}>
            {state.queue.length === 0 ? (
              <div className="mini-queue__empty">{t('miniPlayer.emptyQueue')}</div>
            ) : (
              state.queue.map((t, i) => {
                let dragStyle: React.CSSProperties = {};
                if (isReorderDrag && psyDragFromIdxRef.current === i) {
                  dragStyle = { opacity: 0.4 };
                } else if (isReorderDrag && dropTarget?.idx === i) {
                  dragStyle = dropTarget.before
                    ? { boxShadow: 'inset 0 2px 0 var(--accent)' }
                    : { boxShadow: 'inset 0 -2px 0 var(--accent)' };
                }
                return (
                  <button
                    key={`${t.id}-${i}`}
                    data-mq-idx={i}
                    className={`mini-queue__item${i === state.queueIndex ? ' mini-queue__item--current' : ''}${ctxMenu?.index === i ? ' mini-queue__item--ctx' : ''}`}
                    onClick={() => jumpTo(i)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setCtxMenu({ x: e.clientX, y: e.clientY, track: t, index: i });
                    }}
                    onMouseDown={(e) => {
                      if (e.button !== 0) return;
                      // Don't start drag while a click would also be valid —
                      // the threshold check below upgrades to a drag once
                      // the pointer leaves the deadband.
                      const startX = e.clientX;
                      const startY = e.clientY;
                      const onMove = (me: MouseEvent) => {
                        if (Math.abs(me.clientX - startX) > 5 || Math.abs(me.clientY - startY) > 5) {
                          document.removeEventListener('mousemove', onMove);
                          document.removeEventListener('mouseup', onUp);
                          psyDragFromIdxRef.current = i;
                          startDrag(
                            { data: JSON.stringify({ type: 'queue_reorder', index: i }), label: t.title },
                            me.clientX,
                            me.clientY,
                          );
                        }
                      };
                      const onUp = () => {
                        document.removeEventListener('mousemove', onMove);
                        document.removeEventListener('mouseup', onUp);
                      };
                      document.addEventListener('mousemove', onMove);
                      document.addEventListener('mouseup', onUp);
                    }}
                    style={dragStyle}
                  >
                    <span className="mini-queue__num">{i + 1}</span>
                    <div className="mini-queue__meta">
                      <div className="mini-queue__title">{t.title}</div>
                      <div className="mini-queue__artist">{t.artist}</div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
          {scrollMeta.visible && (
            <div
              className="mini-queue__thumb"
              style={{
                height: `${scrollMeta.thumbH}px`,
                transform: `translateY(${scrollMeta.thumbT}px)`,
              }}
            />
          )}
        </div>
      )}

        {ctxMenu && (
          <MiniContextMenu
            x={ctxMenu.x}
            y={ctxMenu.y}
            track={ctxMenu.track}
            index={ctxMenu.index}
            onClose={() => setCtxMenu(null)}
          />
        )}
      </div>
    </div>
  );
}
