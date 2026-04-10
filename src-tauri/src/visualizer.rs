// ─── Audio Visualizer Module ─────────────────────────────────────────────────
//
// Architecture:
//
//   Audio thread (rodio sample loop)
//     └─ CountingSource::next() → VisualizerTap::push_mono(sample)
//          → atomic circular buffer  (lock-free, 4096 mono samples)
//          ↓ (read every ~16 ms)
//   Worker thread ("viz-fft-worker")
//     └─ snapshot 2048 samples → Hann window → FFT
//          → 24 log-spaced band magnitudes → dB normalization
//          → fast-attack / slow-release smoothing → bands Arc<Mutex<Box<[f32]>>>
//
// Why rustfft instead of spectrum-analyzer:
//   rustfft is the standard Rust FFT crate with direct access to Complex output,
//   zero global state, plans cached per-size, and compiles on all three
//   Psysonic target platforms without additional system libs.  spectrum-analyzer
//   builds on top of rustfft anyway but adds a heavier allocation model that
//   does not fit well inside a tight 16 ms polling loop.
//
// Why atomic circular buffer instead of ringbuf HeapRb (already in project):
//   HeapRb is SPSC and the producer can't be shared across track changes.
//   An atomic buffer is lock-free on both sides, zero-copy for the snapshot,
//   never blocks the audio thread on full, and gives the worker a view of the
//   LATEST N samples rather than consuming them — exactly what a visualizer needs.

use std::sync::{Arc, Mutex};
use std::sync::atomic::{AtomicU32, AtomicUsize, Ordering};

use rustfft::{FftPlanner, num_complex::Complex};

/// Number of complex samples in each FFT window (power of two).
pub const VIZ_FFT_SIZE: usize = 2048;

/// Capacity of the atomic circular buffer (must be >= VIZ_FFT_SIZE).
const VIZ_BUF_SIZE: usize = 4096;

/// Number of logarithmic frequency bands exposed to the frontend.
pub const VIZ_BANDS: usize = 24;

/// Lowest / highest band centre frequencies for the log scale (Hz).
const FREQ_LO: f32 = 40.0;
const FREQ_HI: f32 = 18_000.0;

/// Reference peak-bin magnitude for 0 dBFS normalisation.
/// At VIZ_FFT_SIZE = 2048 with a Hann window, a full-scale sine wave produces a
/// peak-bin magnitude of roughly VIZ_FFT_SIZE / 4 (coherent gain ≈ 0.5).
const REF_MAG: f32 = (VIZ_FFT_SIZE / 4) as f32;

// ─── VisualizerTap ────────────────────────────────────────────────────────────

pub struct VisualizerTap {
    /// Circular buffer of mono PCM samples (stored as f32 bits).
    /// Written by the audio thread with Relaxed ordering — no synchronisation
    /// required; occasional torn reads in the FFT worker are visually harmless.
    samples: Arc<Box<[AtomicU32]>>,
    /// Monotonically incrementing write cursor (never wraps in practice — u64).
    head: Arc<AtomicUsize>,
    /// Output sample rate of the currently active source.
    /// Updated by the audio path before each new play; read by the worker.
    pub sample_rate: Arc<AtomicU32>,
    /// Latest smoothed band magnitudes in [0, 1], published by the FFT worker.
    pub bands: Arc<Mutex<Box<[f32]>>>,
}

impl VisualizerTap {
    pub fn new() -> Self {
        let samples: Box<[AtomicU32]> = (0..VIZ_BUF_SIZE)
            .map(|_| AtomicU32::new(0))
            .collect::<Vec<_>>()
            .into_boxed_slice();
        let bands: Box<[f32]> = vec![0.0f32; VIZ_BANDS].into_boxed_slice();
        Self {
            samples: Arc::new(samples),
            head: Arc::new(AtomicUsize::new(0)),
            sample_rate: Arc::new(AtomicU32::new(44100)),
            bands: Arc::new(Mutex::new(bands)),
        }
    }

    /// Push one pre-mixed mono sample into the circular buffer.
    /// Called on every stereo frame by CountingSource — must be lock-free.
    #[inline(always)]
    pub fn push_mono(&self, sample: f32) {
        let h = self.head.fetch_add(1, Ordering::Relaxed);
        let idx = h % VIZ_BUF_SIZE;
        self.samples[idx].store(sample.to_bits(), Ordering::Relaxed);
    }

    /// Copy the last `VIZ_FFT_SIZE` mono samples into a contiguous Vec,
    /// ordered chronologically (oldest first).  Entirely lock-free.
    fn snapshot(&self) -> Vec<f32> {
        let head = self.head.load(Ordering::Relaxed);
        let start = head.wrapping_sub(VIZ_FFT_SIZE);
        let mut out = Vec::with_capacity(VIZ_FFT_SIZE);
        for i in 0..VIZ_FFT_SIZE {
            let idx = start.wrapping_add(i) % VIZ_BUF_SIZE;
            out.push(f32::from_bits(self.samples[idx].load(Ordering::Relaxed)));
        }
        out
    }

    /// Spawn the background FFT worker.  Call exactly once during engine init.
    pub fn spawn_worker(tap: Arc<VisualizerTap>) {
        // Precompute the Hann window coefficients once — they never change.
        let hann: Vec<f32> = (0..VIZ_FFT_SIZE)
            .map(|i| {
                let t = i as f32 / (VIZ_FFT_SIZE - 1) as f32;
                0.5 * (1.0 - (2.0 * std::f32::consts::PI * t).cos())
            })
            .collect();

        std::thread::Builder::new()
            .name("viz-fft-worker".into())
            .spawn(move || {
                let mut planner  = FftPlanner::<f32>::new();
                let fft          = planner.plan_fft_forward(VIZ_FFT_SIZE);
                let mut smoothed = vec![0.0f32; VIZ_BANDS];

                loop {
                    std::thread::sleep(std::time::Duration::from_millis(16));

                    let sample_rate = tap.sample_rate.load(Ordering::Relaxed) as f32;
                    if sample_rate < 8000.0 { continue; }

                    // ── 1. Snapshot + Hann window ──────────────────────────
                    let samples = tap.snapshot();
                    let mut buf: Vec<Complex<f32>> = samples
                        .iter()
                        .enumerate()
                        .map(|(i, &s)| Complex { re: s * hann[i], im: 0.0 })
                        .collect();

                    // ── 2. Forward FFT ──────────────────────────────────────
                    fft.process(&mut buf);

                    // One-sided magnitudes (positive frequencies only).
                    let half = VIZ_FFT_SIZE / 2;
                    let mags: Vec<f32> = buf[..half]
                        .iter()
                        .map(|c| (c.re * c.re + c.im * c.im).sqrt())
                        .collect();

                    // ── 3. Log-spaced bands (1/3-octave, 24 bands) ─────────
                    let log_lo  = FREQ_LO.ln();
                    let log_hi  = FREQ_HI.ln();
                    let bin_hz  = sample_rate / VIZ_FFT_SIZE as f32;
                    let mut raw = [0.0f32; VIZ_BANDS];

                    for b in 0..VIZ_BANDS {
                        let t_lo   = b as f32 / VIZ_BANDS as f32;
                        let t_hi   = (b + 1) as f32 / VIZ_BANDS as f32;
                        let f_lo   = (log_lo + t_lo * (log_hi - log_lo)).exp();
                        let f_hi   = (log_lo + t_hi * (log_hi - log_lo)).exp();
                        let bin_lo = ((f_lo / bin_hz) as usize).clamp(1, half - 1);
                        let bin_hi = ((f_hi / bin_hz) as usize).clamp(bin_lo + 1, half);
                        let count  = (bin_hi - bin_lo) as f32;
                        let sum: f32 = mags[bin_lo..bin_hi].iter().sum();
                        raw[b] = sum / count;
                    }

                    // ── 4. dB normalization (0 dBFS → 1.0, –60 dB → 0.0) ──
                    for v in raw.iter_mut() {
                        let db = 20.0 * (*v / REF_MAG).max(1e-6_f32).log10();
                        *v = ((db + 60.0) / 60.0).clamp(0.0, 1.0);
                    }

                    // ── 5. Fast-attack / slow-release smoothing ─────────────
                    //   ATTACK  ≈ 0.80 — snappy rise so transients pop
                    //   RELEASE ≈ 0.12 — gradual fall like a real VU meter
                    const ATTACK:  f32 = 0.80;
                    const RELEASE: f32 = 0.12;
                    for b in 0..VIZ_BANDS {
                        let m = raw[b];
                        smoothed[b] = if m > smoothed[b] {
                            ATTACK  * m + (1.0 - ATTACK)  * smoothed[b]
                        } else {
                            RELEASE * m + (1.0 - RELEASE) * smoothed[b]
                        };
                    }

                    // ── 6. Publish result (non-blocking: skip if lock busy) ─
                    if let Ok(mut guard) = tap.bands.try_lock() {
                        guard.copy_from_slice(&smoothed);
                    }
                }
            })
            .ok();
    }
}
