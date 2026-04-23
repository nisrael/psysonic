import { useEffect, useRef } from 'react';
import { useOrbitStore } from '../store/orbitStore';
import { useAuthStore } from '../store/authStore';
import { usePlayerStore, songToTrack } from '../store/playerStore';
import { getSong } from '../api/subsonic';
import {
  readOrbitState,
  writeOrbitHeartbeat,
  leaveOrbitSession,
} from '../utils/orbit';
import { orbitOutboxPlaylistName, estimateLivePosition, type OrbitState } from '../api/orbit';

/**
 * Orbit — guest-side tick hook.
 *
 * Mounted at the app shell; only does work when the local store says we're
 * a guest in an active session. Two independent timers:
 *
 *   - **State read** (2.5 s): pull the canonical state from the session
 *     playlist's comment and mirror it into the store. Detect session end
 *     or own kick and tear down.
 *   - **Heartbeat** (10 s): refresh the guest's own outbox playlist
 *     comment so the host's participant sweep sees the user as alive.
 *
 * Reads are best-effort; a transient Navidrome outage just delays state
 * updates by a tick or two. The session continues locally as long as the
 * playback engine has the current track loaded.
 */

const STATE_READ_TICK_MS = 2_500;
const HEARTBEAT_TICK_MS  = 10_000;

export function useOrbitGuest(): void {
  const role              = useOrbitStore(s => s.role);
  const phase             = useOrbitStore(s => s.phase);
  const sessionPlaylistId = useOrbitStore(s => s.sessionPlaylistId);
  const outboxPlaylistId  = useOrbitStore(s => s.outboxPlaylistId);
  const sessionId         = useOrbitStore(s => s.sessionId);

  const active = role === 'guest' && phase === 'active' && !!sessionPlaylistId;

  /**
   * Last host playback state we *applied* to the local player. Compared
   * against the new tick to detect host-side flips (track change /
   * play-pause toggle) and against the local player's current state to
   * detect guest-side divergence (the guest paused or skipped on their own).
   *
   * Reset to null on (re-)activation so a fresh session re-syncs from scratch.
   */
  const lastAppliedRef = useRef<{ trackId: string | null; isPlaying: boolean } | null>(null);

  // ── State read + end/kick detection + auto-sync to host ──────────────
  useEffect(() => {
    if (!active || !sessionPlaylistId) return;

    let cancelled = false;
    lastAppliedRef.current = null;

    /**
     * Load `trackId` into the local player and seek to the host's live
     * position. Mirrors the host's `isPlaying` (so a guest joining a paused
     * host doesn't auto-start the music). Best-effort; silent on miss.
     */
    const syncToHost = async (trackId: string, hostState: OrbitState) => {
      try {
        const song = await getSong(trackId);
        if (!song || cancelled) return;
        const track = songToTrack(song);
        const targetMs  = estimateLivePosition(hostState, Date.now());
        const targetSec = Math.max(0, targetMs / 1000);
        const player = usePlayerStore.getState();
        const fraction = targetSec / Math.max(1, track.duration);
        if (player.currentTrack?.id === trackId) {
          player.seek(fraction);
          if (hostState.isPlaying && !player.isPlaying) player.resume();
          else if (!hostState.isPlaying && player.isPlaying) player.pause();
        } else {
          player.playTrack(track, [track]);
          // Defer seek + state-match until the engine has actually loaded.
          window.setTimeout(() => {
            if (cancelled) return;
            const p = usePlayerStore.getState();
            if (p.currentTrack?.id !== trackId) return;
            p.seek(fraction);
            if (!hostState.isPlaying && p.isPlaying) p.pause();
          }, 400);
        }
      } catch { /* silent */ }
    };

    const pull = async () => {
      const state = await readOrbitState(sessionPlaylistId);
      if (cancelled) return;

      if (!state) {
        // Session playlist is gone — host must have nuked it. Tear down
        // silently; the exit-modal is the "ended" path below, not this.
        void leaveOrbitSession();
        return;
      }

      useOrbitStore.getState().setState(state);

      // Host signalled session end: surface via `phase`, let the UI handle
      // the modal. Outbox cleanup still happens via leaveOrbitSession().
      if (state.ended) {
        useOrbitStore.getState().setPhase('ended');
        return;
      }

      // Kicked / soft-removed: transition into the error phase with a
      // matching errorMessage so the UI can pick the right copy.
      const me = useAuthStore.getState().getActiveServer()?.username;
      if (me && state.kicked.includes(me)) {
        useOrbitStore.getState().setError('kicked');
        return;
      }
      // Soft-remove: only react to markers strictly newer than our own join
      // time, otherwise a stale marker from a prior session-life would
      // immediately bounce us out on rejoin.
      if (me && state.removed && state.removed.length > 0) {
        const joinedAt = useOrbitStore.getState().joinedAt ?? 0;
        const hit = state.removed.find(r => r.user === me && r.at > joinedAt);
        if (hit) {
          useOrbitStore.getState().setError('removed');
          return;
        }
      }

      // ── Auto-sync host playback into local player ──
      // Rules:
      //   1. First tick after activation → mirror host (initial join sync,
      //      no need for the guest to click catch-up to get started).
      //   2. Track changed at host → guest follows. Track-change is the
      //      "session sync point"; it overrides any local divergence.
      //   3. Same track, host flipped play/pause → mirror only if the local
      //      player still matches our last-applied host state. If the guest
      //      paused/resumed locally, we leave them alone — they have to
      //      click catch-up to opt back in.
      const player = usePlayerStore.getState();
      const hostTrackId  = state.currentTrack?.trackId ?? null;
      const hostPlaying  = state.isPlaying;
      const last = lastAppliedRef.current;

      if (!last) {
        if (hostTrackId) void syncToHost(hostTrackId, state);
        lastAppliedRef.current = { trackId: hostTrackId, isPlaying: hostPlaying };
      } else if (last.trackId !== hostTrackId) {
        if (hostTrackId) void syncToHost(hostTrackId, state);
        else if (player.isPlaying) player.pause();
        lastAppliedRef.current = { trackId: hostTrackId, isPlaying: hostPlaying };
      } else if (last.isPlaying !== hostPlaying) {
        // Only mirror when the guest hasn't diverged. We compare against the
        // *last applied* host state, not the new one — divergence means the
        // local player no longer matches what we last pushed in.
        if (player.isPlaying === last.isPlaying) {
          if (hostPlaying) player.resume();
          else             player.pause();
        }
        // Either way, advance the anchor so we don't keep retrying the same
        // flip every tick.
        lastAppliedRef.current = { trackId: last.trackId, isPlaying: hostPlaying };
      }
    };

    void pull();
    const id = window.setInterval(() => { void pull(); }, STATE_READ_TICK_MS);
    return () => { cancelled = true; window.clearInterval(id); };
  }, [active, sessionPlaylistId]);

  // ── Heartbeat ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!active || !outboxPlaylistId || !sessionId) return;
    const me = useAuthStore.getState().getActiveServer()?.username;
    if (!me) return;
    const outboxName = orbitOutboxPlaylistName(sessionId, me);

    const beat = async () => {
      try { await writeOrbitHeartbeat(outboxPlaylistId, outboxName); }
      catch { /* best-effort */ }
    };
    void beat();

    const id = window.setInterval(() => { void beat(); }, HEARTBEAT_TICK_MS);
    return () => window.clearInterval(id);
  }, [active, outboxPlaylistId, sessionId]);
}
