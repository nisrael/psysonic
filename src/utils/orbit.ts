import {
  createPlaylist,
  updatePlaylistMeta,
  deletePlaylist,
  getPlaylist,
  getPlaylists,
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

// ── Share link ──────────────────────────────────────────────────────────

export const ORBIT_SHARE_SCHEME = 'psysonic2://orbit/';

export interface OrbitShareLink {
  /** Base URL of the Navidrome server (decoded). */
  serverBase: string;
  /** Session id (8 hex chars). */
  sid: string;
}

/**
 * Parse a `psysonic2://orbit/<server-b64>/<sid>` link. Returns null on any
 * shape mismatch — the caller decides what to do (show error toast etc.).
 * Accepts both the `psysonic2://` prefix and a bare string if the OS-level
 * handler has already stripped the scheme.
 */
export function parseOrbitShareLink(url: string): OrbitShareLink | null {
  if (!url) return null;
  const stripped = url.startsWith(ORBIT_SHARE_SCHEME)
    ? url.slice(ORBIT_SHARE_SCHEME.length)
    : url.startsWith('orbit/') ? url.slice('orbit/'.length) : null;
  if (stripped == null) return null;
  const slash = stripped.indexOf('/');
  if (slash <= 0) return null;
  const serverB64 = stripped.slice(0, slash);
  const sid       = stripped.slice(slash + 1).replace(/\/+$/, '');
  if (!/^[0-9a-f]{8}$/i.test(sid)) return null;
  let serverBase: string;
  try {
    serverBase = atob(serverB64);
  } catch { return null; }
  try { new URL(serverBase); } catch { return null; }
  return { serverBase, sid };
}

/** Build a share link for a live session. */
export function buildOrbitShareLink(serverBase: string, sid: string): string {
  return `${ORBIT_SHARE_SCHEME}${btoa(serverBase)}/${sid}`;
}

// ── Playlist lookup ─────────────────────────────────────────────────────

/**
 * Find the Navidrome playlist id of a session given its session id.
 * Scans the user's visible playlist list — Navidrome exposes public
 * playlists from other users, so a guest can find the host's session.
 */
export async function findSessionPlaylistId(sid: string): Promise<string | null> {
  const target = orbitSessionPlaylistName(sid);
  try {
    const all = await getPlaylists();
    const hit = all.find(p => p.name === target);
    return hit?.id ?? null;
  } catch { return null; }
}

// ── Guest lifecycle ─────────────────────────────────────────────────────

export class OrbitJoinError extends Error {
  constructor(
    public readonly reason: 'not-found' | 'ended' | 'full' | 'kicked' | 'no-user' | 'server-error',
    message: string,
  ) {
    super(message);
    this.name = 'OrbitJoinError';
  }
}

/**
 * Guest: join an existing session by id.
 *
 * Assumes the user is already authenticated against the correct Navidrome
 * server — the caller's UI layer handles the magic-sharing flow when the
 * encoded server in the share link doesn't match the active one.
 *
 * Side effects on success:
 *   - creates this user's outbox playlist and writes a first heartbeat
 *   - binds `useOrbitStore` to the session (role = guest, phase = active)
 *   - populates the store's `state` mirror with the last-known blob
 *
 * Throws `OrbitJoinError` on any gate failure; caller shows an error
 * modal and does nothing else.
 */
export async function joinOrbitSession(sid: string): Promise<OrbitState> {
  const server = useAuthStore.getState().getActiveServer();
  const username = server?.username;
  if (!username) throw new OrbitJoinError('no-user', 'No active Navidrome server / user');

  const store = useOrbitStore.getState();
  if (store.phase !== 'idle') {
    throw new OrbitJoinError('server-error', `Cannot join while phase is ${store.phase}`);
  }

  store.setPhase('joining');

  let outboxPlaylistId: string | null = null;
  try {
    // 1) Locate the session playlist and read its state blob.
    const sessionPlaylistId = await findSessionPlaylistId(sid);
    if (!sessionPlaylistId) throw new OrbitJoinError('not-found', `Session ${sid} not found on server`);

    const state = await readOrbitState(sessionPlaylistId);
    if (!state)         throw new OrbitJoinError('not-found', `Session ${sid} has no valid state`);
    if (state.ended)    throw new OrbitJoinError('ended',     `Session ${sid} has ended`);

    // 2) Gate: not kicked, not full. Note: host isn't in `participants` itself,
    //    so `maxUsers` counts guests only.
    if (state.kicked.includes(username)) {
      throw new OrbitJoinError('kicked', `You were removed from session ${sid}`);
    }
    const alreadyInside = state.participants.some(p => p.user === username);
    if (!alreadyInside && state.participants.length >= state.maxUsers) {
      throw new OrbitJoinError('full', `Session ${sid} is full (${state.maxUsers}/${state.maxUsers})`);
    }

    // 3) Create our outbox + first heartbeat.
    const outboxName = orbitOutboxPlaylistName(sid, username);
    // Guard against a stale outbox from a previous abandoned join attempt —
    // if one exists under the same name, reuse its id instead of creating
    // a duplicate (Navidrome allows duplicate names but it'd leak).
    const existing = (await getPlaylists().catch(() => [])).find(p => p.name === outboxName);
    if (existing) {
      outboxPlaylistId = existing.id;
    } else {
      const outbox = await createPlaylist(outboxName);
      outboxPlaylistId = outbox.id;
    }
    await writeOrbitHeartbeat(outboxPlaylistId, outboxName);

    // 4) Bind the local store. The host's next poll will register us in
    //    `participants` — we don't self-mutate the canonical state.
    useOrbitStore.setState({
      role: 'guest',
      sessionId: sid,
      sessionPlaylistId,
      outboxPlaylistId,
      phase: 'active',
      state,
      errorMessage: null,
    });

    return state;
  } catch (err) {
    // Best-effort cleanup.
    if (outboxPlaylistId) { try { await deletePlaylist(outboxPlaylistId); } catch { /* ignore */ } }
    useOrbitStore.getState().setPhase('idle');
    throw err;
  }
}

/**
 * Guest: leave a session voluntarily.
 *
 * Deletes our outbox (so the host stops counting us after its next sweep)
 * and resets the local store. Best-effort on each step. Does NOT touch the
 * canonical session playlist — that's the host's property.
 */
export async function leaveOrbitSession(): Promise<void> {
  const { role, outboxPlaylistId } = useOrbitStore.getState();
  if (role !== 'guest') return;

  if (outboxPlaylistId) {
    try { await deletePlaylist(outboxPlaylistId); } catch { /* best-effort */ }
  }

  useOrbitStore.getState().reset();
}
