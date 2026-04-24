# Psy Orbit

A "listen together" mode built into Psysonic. One participant hosts the music, others tune in and listen in sync. Guests can suggest tracks; the host decides what lands in the queue.

No external servers, no relays, no accounts on yet another platform — Orbit piggybacks entirely on your existing Navidrome instance. Sessions live in regular playlists (with a small JSON blob in the comment field), the clients poll and write to those playlists, and that's it.

---

## Table of contents

- [For users](#for-users)
  - [Starting a session (host)](#starting-a-session-host)
  - [Joining (guest)](#joining-guest)
  - [Suggesting tracks](#suggesting-tracks)
  - [Approvals](#approvals)
  - [Shared queue](#shared-queue)
  - [Session settings](#session-settings)
  - [Participants](#participants)
  - [Ending the session](#ending-the-session)
- [Requirements & limits](#requirements--limits)
- [How it works (technical)](#how-it-works-technical)
  - [Design goals](#design-goals)
  - [Playlists as transport](#playlists-as-transport)
  - [The host tick](#the-host-tick)
  - [The guest tick](#the-guest-tick)
  - [Data flow](#data-flow)
  - [State shape](#state-shape)
  - [Cleanup](#cleanup)
  - [Security & privacy](#security--privacy)
- [Edge cases handled](#edge-cases-handled)
- [Code map](#code-map)

---

## For users

### Starting a session (host)

Click **Psy Orbit** in the top bar → **Create a session**. The start modal opens with:

- **Session name** — a random playful name is generated; edit it or reroll with the dice button.
- **Max guests** — cap on concurrent participants (1–32). You don't count.
- **Invite link** — ready to copy and share the moment the modal opens. Pre-generated from a fresh session id + the slugified name.
- **Clear my queue first** — optional. Start with an empty queue (guest suggestions land fresh) vs. keep your current queue and share it with the guests.

Click **Start Orbit**. The session bar appears at the top of the window (session name, participant count, shuffle countdown, settings / share / help / exit buttons). The link is now live — share it.

### Joining (guest)

Two equivalent paths:

1. **Paste anywhere** — copy the invite link the host sent you. Anywhere in Psysonic (not inside a text field), press `Ctrl+V` (`Cmd+V` on macOS). A confirm dialog shows who invited you; click Join.
2. **Launch popover** — click **Psy Orbit** in the top bar → **Join a session** → paste the link into the field → Join.

Either path performs the same preflight: validates the link, checks the session still exists, handles server switches automatically if the link points at another Navidrome you have an account for. If you have **multiple accounts** on the target server, a small picker asks which one to join as.

### Suggesting tracks

Anywhere a song row appears (album, playlist, favorites, artist top-songs, search results, random mix, advanced search):

- **Double-click** a row → adds just that track.
- **Right-click → "Add to Orbit session"** — same effect, via context menu.
- **Single-click** on a row shows a toast hint: "Double-click to add". This is deliberate — a single click normally drops the whole album into your queue, which would spam the shared queue and annoy everyone.

Explicit bulk buttons (**Play All** / **Play Album** / **Play Playlist** / Hero play / Album-card play) ask for a confirmation first inside an active session. On confirm, the tracks are **appended** to the shared queue, never replacing it.

### Approvals

By default, a new session starts with **auto-approve off**. Guest suggestions land in the session's suggestion history but not the actual playback queue — the host decides.

The host sees a prominent **Pending approvals** strip at the top of the queue panel: each pending track with cover, title, artist, and "Suggested by …" line, plus two buttons:

- ✓ Accept — enqueues the track into the host's player queue. Guests see it appear in the shared queue on the next tick.
- ✕ Decline — drops the suggestion. It stays in the suggestion history for audit but won't show up again in the approval strip.

Auto-approve can be toggled on in the session settings for any session where manual approval isn't needed.

### Shared queue

Both hosts and guests see a strip at the top of the queue panel with the session name and a comma-separated list of all participants (host first). Under that:

- **Host** view: regular queue, with any new guest suggestions injected into random positions inside the upcoming range.
- **Guest** view: read-only display of the host's upcoming queue (up to 30 tracks at a time) with submitter attribution — "by alice" for host-chosen tracks is omitted; "suggested by alice" is shown for guest suggestions.

When the guest has in-flight suggestions that haven't been merged yet, they appear in a separate **Waiting for host** section above Up next, with a clock icon. Once the host (auto-)approves and merges, they move into the normal list.

### Session settings

Open via the gear icon in the session bar (host only):

- **Auto-approve suggestions** — on/off. Default off.
- **Automatic reshuffle** — on/off. Periodically Fisher–Yates-shuffles the upcoming queue.
- **Reshuffle every** — 1 / 5 / 10 / 15 / 30 min preset picker. Disabled when auto-reshuffle is off.
- **Shuffle now** — one-shot manual shuffle + bumps the next-auto-shuffle timer.

### Participants

Click the participant count in the session bar. Opens a popover:

- Host row at the top with a crown icon.
- Each connected guest with a user icon, username, and join timestamp.
- Host-only actions per guest: **Remove** (drops them from the session, can re-join via the invite link) vs. **Ban** (permanently blocked for the lifetime of the session). Both confirm before firing.

Guests see the same list but read-only — no action buttons.

### Ending the session

- **Host clicks X** → confirm dialog → session closes for everyone. Server playlists are deleted automatically.
- **Guest clicks X** → confirm dialog → just the guest leaves. Session continues for everyone else.
- **Host goes silent for 5 minutes** (network drop, app crash, laptop lid) → guests auto-leave with a dedicated "Host went silent" modal.
- **App close / force quit** → next app launch sweeps up any orphaned session playlists you own (`__psyorbit_*` with stale heartbeat).

### The help modal

Every screen with the session bar has a `?` icon between settings and X that opens a 9-section walk-through of everything above, with keyboard navigation (arrow keys between sections, Enter to expand).

---

## Requirements & limits

- **Same Navidrome server.** Everyone — host and all guests — must be logged into the same Navidrome instance. Orbit links encode the server URL, and Psysonic auto-switches on paste if you have an account there.
- **Separate accounts.** Each participant needs their own Navidrome user. If a host and guest log in as the same user, their outbox playlists collide and suggestions get lost. This is a hard limit of the current design — Orbit identifies participants by username.
- **Public server address for remote guests.** Guests outside your home network need your server reachable at a public hostname. The start modal warns you if you're currently connected via a LAN address.
- **Host presence matters.** Guests auto-leave after 5 minutes of no host activity. Shorter reconnects (network blips, phone screen off, whatever) are invisible.
- **Session size.** State is bounded to ~4 KB per playlist comment. In practice that's plenty for a session name, participants list, and a suggestion history; there's no hard cap on tracks through the actual playback queue.

---

## How it works (technical)

### Design goals

1. **No external infrastructure.** Everything runs on your Navidrome. No relay, no auth server, no persistent state anywhere you don't already own.
2. **No protocol changes.** Uses Navidrome's existing Subsonic/OpenSubsonic playlist endpoints. If your server can host a normal playlist, it can host an Orbit session.
3. **Degrade gracefully.** A dropped tick doesn't break a session. Network blips are silent. Missing heartbeats expire cleanly. Crashes clean up on the next launch.
4. **Host-authoritative.** The host's player is the ground truth; guests mirror. No distributed consensus, no leader election.

### Playlists as transport

Every session creates two kinds of playlists on the server (names are stable and start with `__psyorbit_`):

| Playlist | Who owns it | What's in it |
|---|---|---|
| `__psyorbit_<sid>` | host | Canonical session state (4 KB JSON blob) in the playlist **comment**. Track list is always empty. |
| `__psyorbit_<sid>_from_<user>__` | each participant | Outbox. Comment holds a heartbeat timestamp; the track list holds pending guest suggestions. |

All playlists are marked `public: true` so every participant can read them via the normal Subsonic endpoints (`getPlaylist.view`, `getPlaylists.view`). Psysonic filters `__psyorbit_*` out of its own UI (Playlists page, pickers, context menu), but the Navidrome web client will show them while a session is active.

### The host tick

Fired every 2.5 s from `useOrbitHost`:

1. **Sweep all outboxes.** List every `__psyorbit_<sid>_from_<user>__` playlist. For each one, read the current tracklist (= new suggestions from that guest) and the heartbeat timestamp from the comment.
2. **Apply snapshots to state.** Rebuild the `participants` array from heartbeat freshness (anyone with a heartbeat < 30 s old is "alive"). Append new suggestions to `state.queue` as `OrbitQueueItem { trackId, addedBy, addedAt }`.
3. **Clear each swept outbox's tracklist** (heartbeat stays). Single-pass consume — a track the host has seen is the host's problem now, not the outbox's.
4. **Merge into player queue** (when auto-approve is on, and the suggestion isn't host-authored or already merged). Each merged track gets sprinkled at a random position in the upcoming range so host picks and guest suggestions interleave.
5. **Maybe shuffle.** If auto-shuffle is on and the interval elapsed, Fisher–Yates-reorder the upcoming play queue + rewrite `state.lastShuffle`.
6. **Snapshot playback.** Write `isPlaying`, `positionMs`, `positionAt` (wall-clock), `currentTrack`, and a 30-item slice of the upcoming play queue (`playQueue`) into the state blob.
7. **Write.** Serialise and push to the session playlist's comment via `updatePlaylist.view`.

Host also writes a heartbeat to its own outbox every 10 s so the participants pipeline treats the host symmetrically.

### The guest tick

Fired from `useOrbitGuest` — fast polling (500 ms) until the first successful sync lands, then steady 2.5 s:

1. **Read the session playlist comment** via `getPlaylist.view`. Parse the OrbitState.
2. **Check for session death:** comment empty → session-ended; `state.ended === true` → session-ended; `state.positionAt` older than 5 min → host-timeout.
3. **Check kick / remove:** if the local username is in `state.kicked` or has a fresh entry in `state.removed`, transition to the appropriate exit modal.
4. **Reconcile pending suggestions.** For every trackId the local client has submitted, check if it's appeared in `state.playQueue` or `state.currentTrack`. If so, drop it from the local "pending" list (the UI hides it automatically).
5. **Auto-sync to host.** Three cases:
   - Different track at host → load it locally (`playTrack`), seek to `estimateLivePosition(state, now)`, mirror `isPlaying`. Never touches the local player if the guest has locally diverged (paused on their own).
   - Same track, play/pause flipped at host → mirror only if the guest hasn't locally diverged since the last tick.
   - First tick after join → mirror unconditionally (initial sync).
6. **Heartbeat tick** (independent, every 10 s): write `{ ts: Date.now() }` into the guest outbox comment.

### Data flow

```
Host (per tick)                  Navidrome                       Guest (per tick)
──────────────────────────────────────────────────────────────────────────────────
                                                                
player.currentTrack                                              
+ position                                                       
    │                                                            
    ▼                                                            
snapshotPlayerPatch ──► writeOrbitState ─┐                       
                                         │                       
                            ┌─session playlist─┐                 
                            │ comment = JSON   │ ◄─readOrbitState
                            └──────────────────┘                 
                                                    │            
                                                    ▼            
                                              parse OrbitState   
                                                    │            
                                                    ▼            
                                              syncToHost:        
                                              • getSong          
                                              • playTrack        
                                              • seek             
                                              • resume/pause     
                                                                 
                                                                 
Guest suggests track Y                                           
    ┌────────────────────────────────────────────────────────────┤
    │                                                            │
    ▼                                                            │
                                                    suggestOrbitTrack
                            ┌──guest outbox──┐                   
                            │ track list = Y │ ◄─updatePlaylist  
                            └────────────────┘                   
                                    │                            
                                    │                            
Host: sweepGuestOutboxes ◄──────────┘                            
    │                                                            
    ▼                                                            
applyOutboxSnapshotsToState                                      
(queue += Y, participants refreshed)                             
    │                                                            
    ▼ (if auto-approve)                                          
mergeNewSuggestionsIntoQueue                                     
    │                                                            
    ▼                                                            
player.enqueueAt ──► playQueue snapshot ──► session playlist ──► Guest reconciles
                                                                 pending list
```

### State shape

All relevant types in `src/api/orbit.ts`:

```ts
interface OrbitState {
  v: 3;
  sid: string;                 // 8 hex chars
  host: string;                // navidrome username
  name: string;                // human-readable session name
  started: number;             // ms since epoch
  maxUsers: number;
  currentTrack: OrbitQueueItem | null;
  isPlaying: boolean;
  positionMs: number;
  positionAt: number;          // wall-clock ms of the last snapshot
  queue: OrbitQueueItem[];     // suggestion history
  playQueue: OrbitQueueItem[]; // 30-item slice of host's upcoming
  playQueueTotal: number;
  participants: OrbitParticipant[];
  kicked: string[];
  removed: { user: string; at: number }[];
  lastShuffle: number;
  settings: {
    autoApprove: boolean;
    autoShuffle: boolean;
    shuffleIntervalMin: 1 | 5 | 10 | 15 | 30;
  };
  ended: boolean;
}

interface OrbitQueueItem {
  trackId: string;
  addedBy: string;             // navidrome username
  addedAt: number;
}
```

The state blob is size-bounded to 4 KB (serialised JSON). `serialiseOrbitState` throws `OrbitStateTooLarge` above the budget so callers can trim optional fields and retry.

### Cleanup

Three layers of defense against orphaned playlists:

1. **Explicit exit.** `endOrbitSession` (host) or `leaveOrbitSession` (guest) deletes the participant's own playlists synchronously. The happy path.
2. **Server-switch teardown.** Switching Navidrome servers tears the current session down first (up to 1.5 s), then switches. Prevents "in session against wrong server" states.
3. **App-start orphan sweep.** Every app launch runs `cleanupOrphanedOrbitPlaylists`: lists every `__psyorbit_*` playlist the current user owns, parses the heartbeat from the comment, deletes anything with a heartbeat older than 5 minutes (or `ended: true`, or an unparseable comment). The current local session is always protected.

The 5-minute TTL is a conservative compromise: long enough to survive a brief app restart (and a session running on another device of yours), short enough that a dead session doesn't clutter the server indefinitely.

### Security & privacy

- **Authentication.** Uses Navidrome's own user system. Participants are identified by their username; no additional auth layer.
- **Public playlist visibility.** Session and outbox playlists must be `public: true` so guests can read them. Side effect: they're visible to *any* user on the same Navidrome instance while the session is active. Psysonic's own UI filters them; the Navidrome web client does not.
- **No external servers.** Orbit is strictly peer-to-peer via the Navidrome instance you already trust. No data leaves your server.
- **No message signing.** Since everything is owned by authenticated Navidrome users, we rely on the server's own ACLs. A guest can't modify the host's session playlist (different owner), only their own outbox.
- **Track IDs only.** The state blob references tracks by their Navidrome ID. No filenames, no paths, no stream URLs.

---

## Edge cases handled

- **Host offline < 15 s.** Silent. Guests extrapolate via `estimateLivePosition` (positionMs + elapsed wall-clock).
- **Host offline 15 s – 5 min.** Guest UI shows a yellow "Host offline" badge next to the session name. Playback continues locally.
- **Host offline > 5 min.** Guest auto-leaves with a "Host went silent" modal. Cleanup of guest outbox runs on dismissal.
- **Guest pauses locally.** The guest's local pause survives host track changes — the next-track event won't silently un-pause them. "Catch up" brings them back in sync.
- **Guest resume in orbit.** Pressing play (player bar, media keys, MPRIS) in an active session is interpreted as "catch up" — loads the host's current track and seeks to the live position, not "resume the locally frozen track".
- **Bulk "Play All" in-session.** Dialog: "Add 14 tracks to the Orbit queue?" On confirm, appended. On cancel, no-op.
- **Single-click on song row in-session.** Swallowed; shows "Double-click to add" toast.
- **Multiple accounts on target server.** Paste flow opens an account picker modal. Keyboard-navigable.
- **Server switch while in session.** Teardown runs before switch. Any server-resident session playlists get cleaned up by their host's next app-start sweep.
- **Initial sync race.** The guest's first tick retries on 500 ms cadence until the player state actually matches the host's last-known track (up to 2 s per attempt, then falls through with a best-effort mirror).
- **`positionAt` stale on join.** Seek fraction is clamped to [0, 0.99] — prevents `audio:ended` from firing at the very start of a join.
- **Outbox deletion mid-session** (cleanup race): host sees the guest drop out on the next sweep; guest's next heartbeat recreates the outbox if they're still connected.
- **Session playlist deleted** (cleanup race while the guest's local store says it's still active): guest treats as "ended", shows the exit modal.

---

## Code map

### State and types
- `src/api/orbit.ts` — `OrbitState`, `OrbitQueueItem`, `OrbitSettings`, serialise/parse helpers, `estimateLivePosition`.
- `src/store/orbitStore.ts` — local session state: role, phase, session/playlist ids, `pendingSuggestions`, `mergedSuggestionKeys`, `declinedSuggestionKeys`.

### Lifecycle
- `src/utils/orbit.ts` — `startOrbitSession`, `joinOrbitSession`, `endOrbitSession`, `leaveOrbitSession`, `suggestOrbitTrack`, `approveOrbitSuggestion`, `declineOrbitSuggestion`, `hostEnqueueToOrbit`, `cleanupOrphanedOrbitPlaylists`, `effectiveShuffleIntervalMs`.
- `src/utils/orbitBulkGuard.ts` — standalone confirm-dialog helper invoked from `playerStore` when `>1` tracks land in the queue while a session is active.
- `src/utils/switchActiveServer.ts` — wires Orbit teardown into server-switch.

### Hooks
- `src/hooks/useOrbitHost.ts` — host state tick + outbox sweep + merge pipeline + heartbeat.
- `src/hooks/useOrbitGuest.ts` — guest state pull + auto-sync + heartbeat + host-timeout detection.
- `src/hooks/useOrbitSongRowBehavior.ts` — shared double-click-to-add behaviour for song lists.

### UI — session bar and popovers
- `src/components/OrbitSessionBar.tsx` — topbar strip with name, counts, shuffle timer, settings/share/help/catch-up/exit buttons.
- `src/components/OrbitSettingsPopover.tsx` — host settings (auto-approve, auto-shuffle, interval, manual shuffle).
- `src/components/OrbitSharePopover.tsx` — host-only invite-link popover with copy button.
- `src/components/OrbitParticipantsPopover.tsx` — participant list with kick/ban (host-only actions).

### UI — modals
- `src/components/OrbitStartModal.tsx` — session creation wizard.
- `src/components/OrbitJoinModal.tsx` — manual invite-link paste + join.
- `src/components/OrbitAccountPicker.tsx` — multi-account disambiguation when joining.
- `src/components/OrbitExitModal.tsx` — session-ended / kicked / removed / host-timeout exit notice.
- `src/components/OrbitHelpModal.tsx` — 9-section help walk-through (keyboard-navigable).
- `src/components/OrbitStartTrigger.tsx` — "Psy Orbit" button in the header + launch popover (create / join / help).

### UI — queue views
- `src/components/OrbitQueueHead.tsx` — shared header strip (session name, participants, host-presence badge).
- `src/components/OrbitGuestQueue.tsx` — guest-side queue view (current track, pending suggestions, upcoming).
- `src/components/HostApprovalQueue.tsx` — host-side approval strip with accept/decline.

### Supporting
- `src/store/confirmModalStore.ts` + `src/components/GlobalConfirmModal.tsx` — promise-based confirm dialog used by the bulk-gate.
- `src/store/helpModalStore.ts` + `src/components/OrbitHelpModal.tsx` — shared help-modal state.
- `src/store/orbitAccountPickerStore.ts` + `src/components/OrbitAccountPicker.tsx` — account picker for multi-account server switch.
