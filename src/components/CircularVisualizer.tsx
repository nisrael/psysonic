import React, { useEffect, useRef, memo } from 'react';
import { invoke } from '@tauri-apps/api/core';

const BAR_COUNT = 48;          // 2 × 24 bands — mirrored top/bottom
const INNER_R_RATIO = 0.34;    // inner ring as fraction of half-canvas
const OUTER_R_RATIO = 0.50;    // outer ring as fraction of half-canvas
const BASE_LINE_W   = 2.0;     // minimum bar line-width in CSS pixels

// ─── Read accent colour from the live CSS variables ──────────────────────────

function getAccent(el: HTMLElement | null): string {
  const s = getComputedStyle(el ?? document.documentElement);
  const dyn = s.getPropertyValue('--dynamic-fs-accent').trim();
  if (dyn) return dyn;
  return s.getPropertyValue('--accent').trim() || '#cba6f7';
}

// ─── Canvas DPR setup ─────────────────────────────────────────────────────────

function setupCanvas(
  canvas: HTMLCanvasElement,
): { ctx: CanvasRenderingContext2D; size: number } | null {
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const rect = canvas.getBoundingClientRect();
  const size = Math.min(rect.width, rect.height) || canvas.clientWidth || 200;
  const dpr  = window.devicePixelRatio || 1;
  const px   = Math.round(size * dpr);
  if (canvas.width !== px || canvas.height !== px) {
    canvas.width  = px;
    canvas.height = px;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, size };
}

// ─── Draw one frame ───────────────────────────────────────────────────────────

function drawFrame(
  ctx: CanvasRenderingContext2D,
  size: number,
  bands: number[],
  accent: string,
): void {
  ctx.clearRect(0, 0, size, size);

  const cx     = size / 2;
  const cy     = size / 2;
  const half   = size / 2;
  const innerR = half * INNER_R_RATIO;
  const outerR = half * OUTER_R_RATIO;

  // Base ring
  ctx.beginPath();
  ctx.arc(cx, cy, innerR, 0, Math.PI * 2);
  ctx.strokeStyle = `color-mix(in srgb, ${accent} 25%, transparent)`;
  ctx.lineWidth   = 1;
  ctx.shadowBlur  = 0;
  ctx.stroke();

  // Bars — 48 positions: top half uses bands[0..23], bottom mirrors same
  ctx.lineWidth   = Math.max(BASE_LINE_W, (2 * Math.PI * innerR) / (BAR_COUNT * 1.6));
  ctx.lineCap     = 'round';

  for (let i = 0; i < BAR_COUNT; i++) {
    const angle = (i / BAR_COUNT) * Math.PI * 2 - Math.PI / 2;

    // Mirror: top half → bands[0..23], bottom half mirrors same 24 bands reversed
    const bandIdx = i < BAR_COUNT / 2 ? i : BAR_COUNT - 1 - i;
    const mag     = (bands[bandIdx] ?? 0);

    if (mag < 0.004) continue;

    const barLen = mag * (outerR - innerR);
    const cos_a  = Math.cos(angle);
    const sin_a  = Math.sin(angle);
    const x1     = cx + cos_a * innerR;
    const y1     = cy + sin_a * innerR;
    const x2     = cx + cos_a * (innerR + barLen);
    const y2     = cy + sin_a * (innerR + barLen);

    // Glow proportional to magnitude
    ctx.shadowColor = accent;
    ctx.shadowBlur  = 6 + mag * 14;
    ctx.strokeStyle = `color-mix(in srgb, ${accent} ${Math.round(55 + mag * 45)}%, white)`;

    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  ctx.shadowBlur = 0;
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  /** Whether to run the animation loop and poll band data. */
  enabled: boolean;
}

const CircularVisualizer = memo(function CircularVisualizer({ enabled }: Props) {
  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const bandsRef   = useRef<number[]>(new Array(24).fill(0));
  const pendingRef = useRef(false);
  const rafRef     = useRef<number>(0);

  useEffect(() => {
    if (!enabled) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    // Resolve accent once per loop; re-read every ~60 frames to catch theme changes
    let accentCache  = getAccent(canvas);
    let accentFrames = 0;

    const loop = () => {
      // Throttle: only invoke if previous call has resolved
      if (!pendingRef.current) {
        pendingRef.current = true;
        invoke<number[]>('audio_get_viz_bands')
          .then(b => { bandsRef.current = b; })
          .catch(() => {})
          .finally(() => { pendingRef.current = false; });
      }

      // Refresh accent colour periodically
      accentFrames++;
      if (accentFrames >= 60) {
        accentCache  = getAccent(canvas);
        accentFrames = 0;
      }

      const setup = setupCanvas(canvas);
      if (setup) {
        drawFrame(setup.ctx, setup.size, bandsRef.current, accentCache);
      }

      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(rafRef.current);
      // Clear on unmount
      const c = canvasRef.current;
      if (c) {
        const ctx = c.getContext('2d');
        ctx?.clearRect(0, 0, c.width, c.height);
      }
    };
  }, [enabled]);

  return (
    <canvas
      ref={canvasRef}
      className="fs-viz-canvas"
      aria-hidden="true"
    />
  );
});

export default CircularVisualizer;
