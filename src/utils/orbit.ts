import {
  createPlaylist,
  updatePlaylistMeta,
  deletePlaylist,
  getPlaylist,
} from '../api/subsonic';
import { useAuthStore } from '../store/authStore';
import { useOrbitStore } from '../store/orbitStore';
import {
  makeInitialOrbitState,
  orbitOutboxPlaylistName,
  orbitSessionPlaylistName,
  parseOrbitState,
  ORBIT_DEFAULT_MAX_USERS,
  ORBIT_STATE_MAX_BYTES,
  type OrbitOutboxMeta,
  type OrbitState,
} from '../api/orbit';

/**
 * Orbit — host-side lifecycle primitives.
 *
 * Phase 2 scope: creating / ending a session, serialising state into the
 * canonical playlist comment, writing a heartbeat into the host's own
 * outbox. No guest-side logic here.
 *
 * All functions talk to Navidrome through the existing Subsonic wrappers;
 * no new transport work.
 */

// ── ID generation ───────────────────────────────────────────────────────

/** 8 lowercase hex chars — unique enough for concurrent-session collision-free naming. */
function generateSessionId(): string {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

// ── Serialisation ───────────────────────────────────────────────────────

/**
 * Serialise the state blob for writing into a playlist comment. Emits a
 * plain JSON string. Throws when the output exceeds `ORBIT_STATE_MAX_BYTES`
 * — callers should trim optional fields (oldest queue entries / kicked
 * usernames) and retry, rather than write something truncated.
 */
export function serialiseOrbitState(state: OrbitState): string {
  const json = JSON.stringify(state);
  // Encode-length check — emoji-heavy session names could inflate UTF-8 bytes
  // beyond the string's .length count.
  const byteLen = new TextEncoder().encode(json).length;
  if (byteLen > ORBIT_STATE_MAX_BYTES) {
    throw new OrbitStateTooLarge(byteLen);
  }
  return json;
}

export class OrbitStateTooLarge extends Error {
  constructor(public readonly bytes: number) {
    super(`Orbit state blob (${bytes} bytes) exceeds ${ORBIT_STATE_MAX_BYTES} byte budget`);
    this.name = 'OrbitStateTooLarge';
  }
}

function serialiseOutboxMeta(meta: OrbitOutboxMeta): string {
  return JSON.stringify(meta);
}

// ── Remote reads ────────────────────────────────────────────────────────

/** Pull + parse the canonical state from the session playlist. Null on miss or parse error. */
export async function readOrbitState(sessionPlaylistId: string): Promise<OrbitState | null> {
  try {
    const { playlist } = await getPlaylist(sessionPlaylistId);
    if (!playlist.comment) return null;
    let raw: unknown;
    try { raw = JSON.parse(playlist.comment); } catch { return null; }
    return parseOrbitState(raw);
  } catch { return null; }
}

// ── Remote writes ───────────────────────────────────────────────────────

/**
 * Write the state blob into the session playlist's comment.
 *
 * NOTE (design doc "known rough edges"): `updatePlaylist.view` with name +
 * comment MUST preserve the track list. Confirmed to work on Navidrome via
 * observation in PR #256 (playlist-editor); if a future Navidrome release
 * ever changes that, we need to switch to `updatePlaylist` with the full
 * track list echoed back.
 */
export async function writeOrbitState(
  sessionPlaylistId: string,
  state: OrbitState,
): Promise<void> {
  const comment = serialiseOrbitState(state);
  const name = orbitSessionPlaylistName(state.sid);
  await updatePlaylistMeta(sessionPlaylistId, name, comment, /* public */ true);
}

/**
 * Write a heartbeat into the given outbox playlist's comment. Host keeps one
 * for symmetry + to feed its own presence into the participants pipeline
 * (used from Phase 4 onwards when guests look for host liveness).
 */
export async function writeOrbitHeartbeat(
  outboxPlaylistId: string,
  outboxName: string,
): Promise<void> {
  const meta: OrbitOutboxMeta = { ts: Date.now() };
  await updatePlaylistMeta(outboxPlaylistId, outboxName, serialiseOutboxMeta(meta), /* public */ true);
}

// ── Host lifecycle ──────────────────────────────────────────────────────

export interface StartOrbitArgs {
  /** Human-readable name the host chose. */
  name: string;
  /** Max participants (defaults to `ORBIT_DEFAULT_MAX_USERS`). */
  maxUsers?: number;
}

/**
 * Host: create a new session.
 *
 * Creates both the canonical session playlist and the host's own outbox,
 * seeds the state blob + heartbeat, binds the store, sets phase to `active`.
 *
 * Throws if the Navidrome server isn't available or lacks a logged-in user.
 * On throw the store is left in the pre-call state — nothing partially bound.
 */
export async function startOrbitSession(args: StartOrbitArgs): Promise<OrbitState> {
  const server = useAuthStore.getState().getActiveServer();
  const username = server?.username;
  if (!username) throw new Error('No active Navidrome server / user');

  const store = useOrbitStore.getState();
  if (store.phase !== 'idle') {
    throw new Error(`Cannot start while phase is ${store.phase}`);
  }

  store.setPhase('starting');

  let sessionPlaylistId: string | null = null;
  let outboxPlaylistId:  string | null = null;
  try {
    const sid = generateSessionId();
    const sessionName = orbitSessionPlaylistName(sid);
    const outboxName  = orbitOutboxPlaylistName(sid, username);

    // Create both playlists. Navidrome's createPlaylist returns the created
    // object with its new id.
    const sessionPlaylist = await createPlaylist(sessionName);
    sessionPlaylistId = sessionPlaylist.id;

    const outboxPlaylist = await createPlaylist(outboxName);
    outboxPlaylistId = outboxPlaylist.id;

    // Seed state blob + heartbeat. We use updatePlaylistMeta instead of
    // separate create-with-comment because Subsonic's createPlaylist doesn't
    // take a comment argument.
    const state = makeInitialOrbitState({
      sid,
      host: username,
      name: args.name,
      maxUsers: args.maxUsers ?? ORBIT_DEFAULT_MAX_USERS,
    });
    await writeOrbitState(sessionPlaylistId, state);
    await writeOrbitHeartbeat(outboxPlaylistId, outboxName);

    // Bind local store — session is now live.
    useOrbitStore.setState({
      role: 'host',
      sessionId: sid,
      sessionPlaylistId,
      outboxPlaylistId,
      phase: 'active',
      state,
      errorMessage: null,
    });

    return state;
  } catch (err) {
    // Best-effort cleanup of anything we managed to create before the failure.
    if (outboxPlaylistId)  { try { await deletePlaylist(outboxPlaylistId); }  catch { /* ignore */ } }
    if (sessionPlaylistId) { try { await deletePlaylist(sessionPlaylistId); } catch { /* ignore */ } }
    useOrbitStore.getState().setPhase('idle');
    throw err;
  }
}

/**
 * Host: end the session cleanly.
 *
 * Writes `ended: true` first so any poll-in-progress from a guest sees the
 * signal, then deletes both playlists and resets the local store. Each step
 * is best-effort; if something's already gone server-side we still zero out
 * local state so the UI returns to idle.
 */
export async function endOrbitSession(): Promise<void> {
  const { role, state, sessionPlaylistId, outboxPlaylistId } = useOrbitStore.getState();
  if (role !== 'host') return;

  // 1) Flip `ended` so guests notice on their next poll even if deletion fails.
  if (sessionPlaylistId && state) {
    try {
      await writeOrbitState(sessionPlaylistId, { ...state, ended: true });
    } catch { /* best-effort */ }
  }

  // 2) Delete both playlists. Order: outbox first — if session delete fails,
  // a stale session playlist with ended=true is fine; a stale outbox without
  // a session is noise.
  if (outboxPlaylistId)  { try { await deletePlaylist(outboxPlaylistId); }  catch { /* best-effort */ } }
  if (sessionPlaylistId) { try { await deletePlaylist(sessionPlaylistId); } catch { /* best-effort */ } }

  // 3) Local teardown.
  useOrbitStore.getState().reset();
}

// ── Store helpers used by the tick hook ────────────────────────────────

/** Merge a patch into the store's state blob, keeping nullability. */
export function patchOrbitState(patch: Partial<OrbitState>): OrbitState | null {
  const current = useOrbitStore.getState().state;
  if (!current) return null;
  const next: OrbitState = { ...current, ...patch };
  useOrbitStore.getState().setState(next);
  return next;
}
