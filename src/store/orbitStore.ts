import { create } from 'zustand';
import type { OrbitState } from '../api/orbit';

/**
 * Orbit — local session store.
 *
 * Mirrors the remote canonical state for the UI, plus a handful of
 * client-only fields (our role in the session, the playlist ids we're
 * bound to, lifecycle phase). Not persisted — a session is transient by
 * design; if the app restarts mid-session, we re-join on next open
 * rather than resurrect stale local state.
 *
 * Phase 1 is intentionally thin: only `set`/`reset` plumbing so later
 * phases (host/guest lifecycle, track pipeline) can drop into place
 * without touching the store shape.
 */

export type OrbitRole = 'host' | 'guest';

/** Fine-grained lifecycle phase. Drives which modal/indicator UI is visible. */
export type OrbitPhase =
  /** No session bound. */
  | 'idle'
  /** Host: creating the session playlist and seeding state. */
  | 'starting'
  /** Guest: auth + lookup before commit. */
  | 'joining'
  /** Session established; polling cycle active. */
  | 'active'
  /** Host ended the session; showing exit modal. */
  | 'ended'
  /** Unrecoverable error (server unreachable, playlist vanished, etc.). */
  | 'error';

interface OrbitStore {
  /** Current role in the session, or null when idle. */
  role: OrbitRole | null;
  /** Active session id, or null. */
  sessionId: string | null;
  /** Navidrome playlist id of the canonical session playlist. */
  sessionPlaylistId: string | null;
  /** Navidrome playlist id of our own outbox (exists for both host and guest). */
  outboxPlaylistId: string | null;
  /** Lifecycle phase. */
  phase: OrbitPhase;
  /** Latest-known canonical state (last poll). Null while starting/joining. */
  state: OrbitState | null;
  /** Human-readable error when `phase === 'error'`. */
  errorMessage: string | null;

  // ── Setters (Phase 1 scaffolding; later phases add real actions) ────────
  setPhase: (phase: OrbitPhase) => void;
  setRole: (role: OrbitRole | null) => void;
  setSessionBinding: (args: {
    sessionId: string | null;
    sessionPlaylistId: string | null;
    outboxPlaylistId: string | null;
  }) => void;
  setState: (state: OrbitState | null) => void;
  setError: (message: string | null) => void;
  /** Tear down the session locally. Does NOT clean up remote playlists. */
  reset: () => void;
}

const initialState = {
  role: null,
  sessionId: null,
  sessionPlaylistId: null,
  outboxPlaylistId: null,
  phase: 'idle' as OrbitPhase,
  state: null,
  errorMessage: null,
} satisfies Omit<OrbitStore, 'setPhase' | 'setRole' | 'setSessionBinding' | 'setState' | 'setError' | 'reset'>;

export const useOrbitStore = create<OrbitStore>()((set) => ({
  ...initialState,

  setPhase: (phase) => set({ phase }),
  setRole: (role) => set({ role }),
  setSessionBinding: ({ sessionId, sessionPlaylistId, outboxPlaylistId }) =>
    set({ sessionId, sessionPlaylistId, outboxPlaylistId }),
  setState: (state) => set({ state }),
  setError: (message) => set({ phase: message ? 'error' : 'idle', errorMessage: message }),
  reset: () => set({ ...initialState }),
}));
