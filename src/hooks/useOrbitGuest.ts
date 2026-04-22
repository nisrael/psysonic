import { useEffect } from 'react';
import { useOrbitStore } from '../store/orbitStore';
import { useAuthStore } from '../store/authStore';
import {
  readOrbitState,
  writeOrbitHeartbeat,
  leaveOrbitSession,
} from '../utils/orbit';
import { orbitOutboxPlaylistName } from '../api/orbit';

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

  // ── State read + end/kick detection ──────────────────────────────────
  useEffect(() => {
    if (!active || !sessionPlaylistId) return;

    let cancelled = false;

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

      // Kicked: transition into `ended` phase but with a different
      // errorMessage so the UI can show the right copy.
      const me = useAuthStore.getState().getActiveServer()?.username;
      if (me && state.kicked.includes(me)) {
        useOrbitStore.getState().setError('kicked');
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
