import React, { useEffect, useRef, useState } from 'react';
import { usePlayerStore } from '../store/playerStore';
import { useAuthStore, type SeekbarStyle } from '../store/authStore';

function fmt(s: number): string {
  if (!s || isNaN(s)) return '0:00';
  return `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
}

const BAR_COUNT = 500;
const SEG_COUNT = 60;

// ── color helper ──────────────────────────────────────────────────────────────

function getColors() {
  const s = getComputedStyle(document.documentElement);
  return {
    played:   s.getPropertyValue('--waveform-played').trim()   || s.getPropertyValue('--accent').trim()       || '#cba6f7',
    buffered: s.getPropertyValue('--waveform-buffered').trim() || s.getPropertyValue('--ctp-overlay0').trim() || '#6c7086',
    unplayed: s.getPropertyValue('--waveform-unplayed').trim() || s.getPropertyValue('--ctp-surface1').trim() || '#313244',
  };
}

// ── canvas setup ──────────────────────────────────────────────────────────────

function setupCanvas(
  canvas: HTMLCanvasElement,
): { ctx: CanvasRenderingContext2D; w: number; h: number } | null {
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const rect = canvas.getBoundingClientRect();
  const w = rect.width || canvas.clientWidth;
  const h = rect.height || canvas.clientHeight;
  if (w === 0 || h === 0) return null;
  const dpr = window.devicePixelRatio || 1;
  const pw = Math.round(w * dpr);
  const ph = Math.round(h * dpr);
  if (canvas.width !== pw || canvas.height !== ph) {
    canvas.width = pw;
    canvas.height = ph;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return { ctx, w, h };
}

// ── waveform heights ──────────────────────────────────────────────────────────

function hashStr(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h = (h ^ str.charCodeAt(i)) >>> 0;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

export function makeHeights(trackId: string): Float32Array {
  let s = hashStr(trackId);
  const h = new Float32Array(BAR_COUNT);
  for (let i = 0; i < BAR_COUNT; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    h[i] = s / 0xffffffff;
  }
  for (let pass = 0; pass < 5; pass++) {
    for (let i = 1; i < BAR_COUNT - 1; i++) {
      h[i] = h[i - 1] * 0.25 + h[i] * 0.5 + h[i + 1] * 0.25;
    }
  }
  let max = 0;
  for (let i = 0; i < BAR_COUNT; i++) if (h[i] > max) max = h[i];
  if (max > 0) for (let i = 0; i < BAR_COUNT; i++) h[i] = 0.12 + (h[i] / max) * 0.88;
  return h;
}

// ── draw functions ────────────────────────────────────────────────────────────

function drawWaveform(
  canvas: HTMLCanvasElement,
  heights: Float32Array | null,
  progress: number,
  buffered: number,
) {
  const r = setupCanvas(canvas);
  if (!r) return;
  const { ctx, w, h } = r;
  const { played, buffered: buffCol, unplayed } = getColors();

  if (!heights) {
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = unplayed;
    ctx.fillRect(0, (h - 2) / 2, w, 2);
    ctx.globalAlpha = 1;
    return;
  }

  const x1Of = (i: number) => (i / BAR_COUNT) * w;
  const x2Of = (i: number) => ((i + 1) / BAR_COUNT) * w;

  ctx.globalAlpha = 0.28;
  ctx.fillStyle = unplayed;
  for (let i = 0; i < BAR_COUNT; i++) {
    if (i / BAR_COUNT < buffered) continue;
    const bh = Math.max(1, heights[i] * h);
    const x = x1Of(i);
    ctx.fillRect(x, (h - bh) / 2, x2Of(i) - x, bh);
  }

  ctx.globalAlpha = 0.45;
  ctx.fillStyle = buffCol;
  for (let i = 0; i < BAR_COUNT; i++) {
    const frac = i / BAR_COUNT;
    if (frac < progress || frac >= buffered) continue;
    const bh = Math.max(1, heights[i] * h);
    const x = x1Of(i);
    ctx.fillRect(x, (h - bh) / 2, x2Of(i) - x, bh);
  }

  if (progress > 0) {
    ctx.globalAlpha = 1;
    ctx.fillStyle = played;
    ctx.shadowColor = played;
    ctx.shadowBlur = 5;
    for (let i = 0; i < BAR_COUNT; i++) {
      if (i / BAR_COUNT >= progress) break;
      const bh = Math.max(1, heights[i] * h);
      const x = x1Of(i);
      ctx.fillRect(x, (h - bh) / 2, x2Of(i) - x, bh);
    }
    ctx.shadowBlur = 0;
  }
  ctx.globalAlpha = 1;
}

function drawLineDot(canvas: HTMLCanvasElement, progress: number, buffered: number) {
  const r = setupCanvas(canvas);
  if (!r) return;
  const { ctx, w, h } = r;
  const { played, buffered: buffCol, unplayed } = getColors();
  const cy = h / 2;
  const lh = 2;
  const dotR = 5;

  ctx.globalAlpha = 0.35;
  ctx.fillStyle = unplayed;
  ctx.fillRect(0, cy - lh / 2, w, lh);

  if (buffered > 0) {
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = buffCol;
    ctx.fillRect(0, cy - lh / 2, buffered * w, lh);
  }

  ctx.globalAlpha = 1;
  ctx.fillStyle = played;
  ctx.fillRect(0, cy - lh / 2, progress * w, lh);

  const dx = Math.max(dotR, Math.min(w - dotR, progress * w));
  ctx.shadowColor = played;
  ctx.shadowBlur = 7;
  ctx.beginPath();
  ctx.arc(dx, cy, dotR, 0, Math.PI * 2);
  ctx.fillStyle = played;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 1;
}

function drawBar(canvas: HTMLCanvasElement, progress: number, buffered: number) {
  const r = setupCanvas(canvas);
  if (!r) return;
  const { ctx, w, h } = r;
  const { played, buffered: buffCol, unplayed } = getColors();
  const bh = 4;
  const rad = bh / 2;
  const y = (h - bh) / 2;

  ctx.globalAlpha = 0.3;
  ctx.fillStyle = unplayed;
  ctx.beginPath();
  ctx.roundRect(0, y, w, bh, rad);
  ctx.fill();

  if (buffered > 0) {
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = buffCol;
    ctx.beginPath();
    ctx.roundRect(0, y, buffered * w, bh, rad);
    ctx.fill();
  }

  if (progress > 0) {
    ctx.globalAlpha = 1;
    ctx.fillStyle = played;
    ctx.shadowColor = played;
    ctx.shadowBlur = 5;
    ctx.beginPath();
    ctx.roundRect(0, y, progress * w, bh, rad);
    ctx.fill();
    ctx.shadowBlur = 0;
  }
  ctx.globalAlpha = 1;
}

function drawThick(canvas: HTMLCanvasElement, progress: number, buffered: number) {
  const r = setupCanvas(canvas);
  if (!r) return;
  const { ctx, w, h } = r;
  const { played, buffered: buffCol, unplayed } = getColors();
  const bh = Math.min(14, h);
  const rad = bh / 2;
  const y = (h - bh) / 2;

  ctx.globalAlpha = 0.25;
  ctx.fillStyle = unplayed;
  ctx.beginPath();
  ctx.roundRect(0, y, w, bh, rad);
  ctx.fill();

  if (buffered > 0) {
    ctx.globalAlpha = 0.45;
    ctx.fillStyle = buffCol;
    ctx.beginPath();
    ctx.roundRect(0, y, buffered * w, bh, rad);
    ctx.fill();
  }

  if (progress > 0) {
    ctx.globalAlpha = 1;
    ctx.fillStyle = played;
    ctx.shadowColor = played;
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.roundRect(0, y, progress * w, bh, rad);
    ctx.fill();
    ctx.shadowBlur = 0;
  }
  ctx.globalAlpha = 1;
}

function drawSegmented(canvas: HTMLCanvasElement, progress: number, buffered: number) {
  const r = setupCanvas(canvas);
  if (!r) return;
  const { ctx, w, h } = r;
  const { played, buffered: buffCol, unplayed } = getColors();
  const gap = 2;
  const segW = (w - gap * (SEG_COUNT - 1)) / SEG_COUNT;
  const segH = h * 0.65;
  const y = (h - segH) / 2;
  const playedIdx = Math.floor(progress * SEG_COUNT);

  for (let i = 0; i < SEG_COUNT; i++) {
    const frac = i / SEG_COUNT;
    const x = i * (segW + gap);
    ctx.shadowBlur = 0;
    if (frac < progress) {
      ctx.globalAlpha = 1;
      ctx.fillStyle = played;
      if (i === playedIdx - 1) {
        ctx.shadowColor = played;
        ctx.shadowBlur = 5;
      }
    } else if (frac < buffered) {
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = buffCol;
    } else {
      ctx.globalAlpha = 0.28;
      ctx.fillStyle = unplayed;
    }
    ctx.beginPath();
    ctx.roundRect(x, y, Math.max(1, segW), segH, 1);
    ctx.fill();
  }
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 1;
}

// ── dispatcher ────────────────────────────────────────────────────────────────

export function drawSeekbar(
  canvas: HTMLCanvasElement,
  style: SeekbarStyle,
  heights: Float32Array | null,
  progress: number,
  buffered: number,
) {
  switch (style) {
    case 'waveform':  drawWaveform(canvas, heights, progress, buffered); break;
    case 'linedot':   drawLineDot(canvas, progress, buffered); break;
    case 'bar':       drawBar(canvas, progress, buffered); break;
    case 'thick':     drawThick(canvas, progress, buffered); break;
    case 'segmented': drawSegmented(canvas, progress, buffered); break;
  }
}

// ── SeekbarPreview (animated, for Settings) ───────────────────────────────────

export function SeekbarPreview({
  style,
  label,
  selected,
  onClick,
}: {
  style: SeekbarStyle;
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef    = useRef<number | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const heights = style === 'waveform' ? makeHeights('seekbar-preview-demo') : null;
    let t = 0;
    const tick = () => {
      t += 0.012;
      const progress = 0.15 + 0.65 * (0.5 + 0.5 * Math.sin(t));
      const buffered  = Math.min(1, progress + 0.18);
      drawSeekbar(canvas, style, heights, progress, buffered);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current !== null) cancelAnimationFrame(rafRef.current); };
  }, [style]);

  return (
    <button
      onClick={onClick}
      style={{
        border: `2px solid ${selected ? 'var(--accent)' : 'var(--ctp-surface1)'}`,
        borderRadius: 8,
        background: selected
          ? 'color-mix(in srgb, var(--accent) 12%, transparent)'
          : 'var(--bg-card, var(--ctp-base))',
        padding: '10px 12px 8px',
        cursor: 'pointer',
        width: 130,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        alignItems: 'stretch',
        transition: 'border-color 0.15s, background 0.15s',
      }}
    >
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: 24, display: 'block' }}
      />
      <span style={{
        fontSize: 11,
        color: selected ? 'var(--accent)' : 'var(--text-secondary)',
        textAlign: 'center',
        fontWeight: selected ? 600 : 400,
      }}>
        {label}
      </span>
    </button>
  );
}

// ── main component ────────────────────────────────────────────────────────────

interface Props {
  trackId: string | undefined;
}

export default function WaveformSeek({ trackId }: Props) {
  const canvasRef   = useRef<HTMLCanvasElement>(null);
  const heightsRef  = useRef<Float32Array | null>(null);
  const progressRef = useRef(0);
  const bufferedRef = useRef(0);
  const isDragging  = useRef(false);

  const [hoverPct, setHoverPct] = useState<number | null>(null);

  const progress     = usePlayerStore(s => s.progress);
  const buffered     = usePlayerStore(s => s.buffered);
  const seek         = usePlayerStore(s => s.seek);
  const duration     = usePlayerStore(s => s.currentTrack?.duration ?? 0);
  const seekbarStyle = useAuthStore(s => s.seekbarStyle);

  progressRef.current = progress;
  bufferedRef.current = buffered;

  useEffect(() => {
    heightsRef.current = trackId ? makeHeights(trackId) : null;
  }, [trackId]);

  useEffect(() => {
    if (canvasRef.current) {
      drawSeekbar(canvasRef.current, seekbarStyle, heightsRef.current, progress, buffered);
    }
  }, [progress, buffered, trackId, seekbarStyle]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver(() => {
      drawSeekbar(canvas, seekbarStyle, heightsRef.current, progressRef.current, bufferedRef.current);
    });
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [seekbarStyle]);

  const trackIdRef = useRef(trackId);
  trackIdRef.current = trackId;
  const seekRef = useRef(seek);
  seekRef.current = seek;

  useEffect(() => {
    const seekFromX = (clientX: number) => {
      const canvas = canvasRef.current;
      if (!canvas || !trackIdRef.current) return;
      const rect = canvas.getBoundingClientRect();
      seekRef.current(Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)));
    };
    const onMove = (e: MouseEvent) => { if (isDragging.current) seekFromX(e.clientX); };
    const onUp   = () => { isDragging.current = false; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup',   onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup',   onUp);
    };
  }, []);

  return (
    <div style={{ position: 'relative', width: '100%' }}>
      {hoverPct !== null && duration > 0 && (
        <span
          className="player-volume-pct"
          style={{ left: `${hoverPct * 100}%` }}
        >
          {fmt(hoverPct * duration)}
        </span>
      )}
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: '24px', cursor: trackId ? 'pointer' : 'default', display: 'block' }}
        onMouseDown={e => {
          isDragging.current = true;
          const rect = e.currentTarget.getBoundingClientRect();
          seekRef.current(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)));
        }}
        onMouseMove={e => {
          if (!trackId) return;
          const rect = e.currentTarget.getBoundingClientRect();
          setHoverPct(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)));
        }}
        onMouseLeave={() => setHoverPct(null)}
      />
    </div>
  );
}
