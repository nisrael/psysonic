/**
 * Orbit — shared-session state types.
 *
 * The canonical state blob lives in the comment field of a dedicated
 * server-side playlist (`__psyorbit_[sid]__`). Host writes, guests read.
 * Per-user "outbox" playlists (`__psyorbit_[sid]_from_[username]__`)
 * carry suggestions + heartbeats the other way.
 *
 * This file is types + a few pure helpers only — no network, no store.
 */

/** Bump whenever the on-wire schema changes incompatibly. */
export const ORBIT_STATE_VERSION = 3 as const;

/** Prefix for the canonical session playlist name. Append an 8-hex session id. */
export const ORBIT_PLAYLIST_PREFIX = '__psyorbit_';

/** Full canonical session playlist name for a given session id. */
export function orbitSessionPlaylistName(sessionId: string): string {
  return `${ORBIT_PLAYLIST_PREFIX}${sessionId}__`;
}

/** Full per-user outbox playlist name. Host reads these, guests own one. */
export function orbitOutboxPlaylistName(sessionId: string, username: string): string {
  return `${ORBIT_PLAYLIST_PREFIX}${sessionId}_from_${username}__`;
}

/** One queued/current track + who added it, for attribution. */
export interface OrbitQueueItem {
  trackId: string;
  /** Navidrome username of the participant who suggested this track. */
  addedBy: string;
  /** Wall-clock ms when the host consumed this track from its originator's outbox. */
  addedAt: number;
}

/** One participant's presence record. */
export interface OrbitParticipant {
  user: string;
  /** Wall-clock ms when the host first registered this participant. */
  joinedAt: number;
  /** Wall-clock ms of the participant's most recent outbox heartbeat. */
  lastHeartbeat: number;
}

/**
 * The canonical session state — exactly what's serialised into the
 * session playlist's comment field. Keep lean; the comment has a ~4 KB
 * self-imposed budget.
 */
export interface OrbitState {
  v: typeof ORBIT_STATE_VERSION;
  /** Session id (8 hex chars). */
  sid: string;
  /** Navidrome username of the host. */
  host: string;
  /** Human-readable session name set by the host at start. */
  name: string;
  /** Epoch ms when the session was created. */
  started: number;
  /** Host-configurable cap on concurrent participants. */
  maxUsers: number;
  /** Currently-playing track (host's playback), or null when stopped. */
  currentTrack: OrbitQueueItem | null;
  /** Host's live play/pause state. */
  isPlaying: boolean;
  /** Host's last reported playback position in ms. */
  positionMs: number;
  /** Wall-clock ms of the `positionMs` snapshot, for drift calculation. */
  positionAt: number;
  /** Upcoming queue (not including `currentTrack`). */
  queue: OrbitQueueItem[];
  /** Epoch ms of the last queue shuffle. */
  lastShuffle: number;
  /** Currently-present participants (excluding the host). */
  participants: OrbitParticipant[];
  /** Usernames blocked from re-joining this session. */
  kicked: string[];
  /** Set when the host has ended the session; guests should exit on next poll. */
  ended?: boolean;
}

/** What the guest's outbox-playlist comment holds (heartbeat only, for now). */
export interface OrbitOutboxMeta {
  /** Wall-clock ms of this heartbeat. */
  ts: number;
}

/** Our self-imposed limit on serialised `OrbitState`. Drop oldest non-essential fields if exceeded. */
export const ORBIT_STATE_MAX_BYTES = 4096;

/** Default value of `OrbitState.maxUsers` when the host hasn't picked one. */
export const ORBIT_DEFAULT_MAX_USERS = 10;

/**
 * Build a fresh state blob for a brand-new session. Used by the host on start.
 */
export function makeInitialOrbitState(args: {
  sid: string;
  host: string;
  name: string;
  maxUsers?: number;
}): OrbitState {
  const now = Date.now();
  return {
    v: ORBIT_STATE_VERSION,
    sid: args.sid,
    host: args.host,
    name: args.name,
    started: now,
    maxUsers: args.maxUsers ?? ORBIT_DEFAULT_MAX_USERS,
    currentTrack: null,
    isPlaying: false,
    positionMs: 0,
    positionAt: now,
    queue: [],
    lastShuffle: now,
    participants: [],
    kicked: [],
  };
}

/**
 * Validate + parse an incoming state blob (untrusted JSON from the playlist
 * comment). Returns null on structural mismatch or schema-version drift.
 */
export function parseOrbitState(raw: unknown): OrbitState | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Partial<OrbitState>;
  if (s.v !== ORBIT_STATE_VERSION) return null;
  if (typeof s.sid !== 'string' || typeof s.host !== 'string') return null;
  if (typeof s.name !== 'string' || typeof s.started !== 'number') return null;
  if (typeof s.maxUsers !== 'number' || typeof s.isPlaying !== 'boolean') return null;
  if (typeof s.positionMs !== 'number' || typeof s.positionAt !== 'number') return null;
  if (!Array.isArray(s.queue) || !Array.isArray(s.participants) || !Array.isArray(s.kicked)) return null;
  if (typeof s.lastShuffle !== 'number') return null;
  // currentTrack can be null or an object — no deeper validation here; the
  // producer is our own code and an item with missing fields would only hurt
  // the attribution UI, not correctness.
  return s as OrbitState;
}

/** Quickly derive the host's estimated live playback position on a guest. */
export function estimateLivePosition(state: OrbitState, nowMs: number): number {
  if (!state.isPlaying) return state.positionMs;
  return state.positionMs + (nowMs - state.positionAt);
}
