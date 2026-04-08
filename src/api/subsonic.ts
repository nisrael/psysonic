import axios from 'axios';
import md5 from 'md5';
import { invoke } from '@tauri-apps/api/core';
import { useAuthStore } from '../store/authStore';
import { version } from '../../package.json';

// ─── Secure random salt ────────────────────────────────────────
function secureRandomSalt(): string {
  const buf = new Uint8Array(8);
  crypto.getRandomValues(buf);
  return Array.from(buf, b => b.toString(16).padStart(2, '0')).join('');
}

// ─── Token Auth ───────────────────────────────────────────────
function getAuthParams(username: string, password: string) {
  const salt = secureRandomSalt();
  const token = md5(password + salt);
  return { u: username, t: token, s: salt, v: '1.16.1', c: `psysonic/${version}`, f: 'json' };
}

function getClient() {
  const { getBaseUrl, getActiveServer } = useAuthStore.getState();
  const server = getActiveServer();
  const baseUrl = getBaseUrl();
  if (!baseUrl) throw new Error('No server configured');
  const params = getAuthParams(server?.username ?? '', server?.password ?? '');
  return { baseUrl: `${baseUrl}/rest`, params };
}

async function api<T>(endpoint: string, extra: Record<string, unknown> = {}, timeout = 15000): Promise<T> {
  const { baseUrl, params } = getClient();
  const resp = await axios.get(`${baseUrl}/${endpoint}`, {
    params: { ...params, ...extra },
    paramsSerializer: { indexes: null },
    timeout,
  });
  const data = resp.data?.['subsonic-response'];
  if (!data) throw new Error('Invalid response from server (possibly not a Subsonic server)');
  if (data.status !== 'ok') throw new Error(data.error?.message ?? 'Subsonic API error');
  return data as T;
}

/** Optional `musicFolderId` when the user narrowed browsing to one Subsonic library (see `getMusicFolders`). */
export function libraryFilterParams(): Record<string, string | number> {
  const { activeServerId, musicLibraryFilterByServer } = useAuthStore.getState();
  if (!activeServerId) return {};
  const f = musicLibraryFilterByServer[activeServerId];
  if (f === undefined || f === 'all') return {};
  return { musicFolderId: f };
}

// ─── Types ────────────────────────────────────────────────────
export interface SubsonicAlbum {
  id: string;
  name: string;
  artist: string;
  artistId: string;
  coverArt?: string;
  songCount: number;
  duration: number;
  playCount?: number;
  year?: number;
  genre?: string;
  starred?: string;
  recordLabel?: string;
  created?: string;
  /** Present on some servers (e.g. OpenSubsonic) for album-level rating. */
  userRating?: number;
}

/** OpenSubsonic `artists` / `albumArtists` entries on a child song (may include `userRating`). */
export interface SubsonicOpenArtistRef {
  id?: string;
  name?: string;
  userRating?: number;
}

export interface SubsonicSong {
  id: string;
  title: string;
  artist: string;
  album: string;
  albumId: string;
  artistId?: string;
  duration: number;
  track?: number;
  discNumber?: number;
  coverArt?: string;
  year?: number;
  userRating?: number;
  /** Some OpenSubsonic responses attach parent ratings on child songs. */
  albumUserRating?: number;
  artistUserRating?: number;
  artists?: SubsonicOpenArtistRef[];
  albumArtists?: SubsonicOpenArtistRef[];
  // Audio technical info
  bitRate?: number;
  suffix?: string;
  contentType?: string;
  size?: number;
  samplingRate?: number;
  bitDepth?: number;
  channelCount?: number;
  starred?: string;
  genre?: string;
  path?: string;
  albumArtist?: string;
  replayGain?: {
    trackGain?: number;
    albumGain?: number;
    trackPeak?: number;
    albumPeak?: number;
  };
}

export interface InternetRadioStation {
  id: string;
  name: string;
  streamUrl: string;
  homepageUrl?: string;
  coverArt?: string; // Navidrome v0.61.0+
}

export interface RadioBrowserStation {
  stationuuid: string;
  name: string;
  url: string;
  favicon: string;
  tags: string;
}

export interface SubsonicPlaylist {
  id: string;
  name: string;
  songCount: number;
  duration: number;
  created: string;
  changed: string;
  owner?: string;
  public?: boolean;
  comment?: string;
  coverArt?: string;
}

export interface SubsonicNowPlaying extends SubsonicSong {
  username: string;
  minutesAgo: number;
  playerId: number;
  playerName: string;
}

export interface SubsonicArtist {
  id: string;
  name: string;
  albumCount?: number;
  coverArt?: string;
  starred?: string;
  /** Present on some servers (e.g. OpenSubsonic) for artist-level rating. */
  userRating?: number;
}

export interface SubsonicGenre {
  value: string;
  songCount: number;
  albumCount: number;
}

export interface SubsonicMusicFolder {
  id: string;
  name: string;
}

export interface SubsonicArtistInfo {
  biography?: string;
  musicBrainzId?: string;
  lastFmUrl?: string;
  smallImageUrl?: string;
  mediumImageUrl?: string;
  largeImageUrl?: string;
  similarArtist?: Array<{ id: string; name: string; albumCount?: number }>;
}

// ─── API Methods ──────────────────────────────────────────────
export async function getMusicFolders(): Promise<SubsonicMusicFolder[]> {
  const data = await api<{ musicFolders: { musicFolder: SubsonicMusicFolder | SubsonicMusicFolder[] } }>(
    'getMusicFolders.view',
  );
  const raw = data.musicFolders?.musicFolder;
  if (!raw) return [];
  const arr = Array.isArray(raw) ? raw : [raw];
  return arr.map(f => ({
    id: String((f as { id: string | number }).id),
    name: (f as { name?: string }).name ?? 'Library',
  }));
}

export async function ping(): Promise<boolean> {
  try {
    await api('ping.view');
    return true;
  } catch {
    return false;
  }
}

/** Test a connection with explicit credentials — does NOT depend on store state. */
export async function pingWithCredentials(serverUrl: string, username: string, password: string): Promise<boolean> {
  try {
    const base = serverUrl.startsWith('http') ? serverUrl.replace(/\/$/, '') : `http://${serverUrl.replace(/\/$/, '')}`;
    const salt = secureRandomSalt();
    const token = md5(password + salt);
    const resp = await axios.get(`${base}/rest/ping.view`, {
      params: { u: username, t: token, s: salt, v: '1.16.1', c: 'psysonic', f: 'json' },
      paramsSerializer: { indexes: null },
      timeout: 15000,
    });
    const data = resp.data?.['subsonic-response'];
    return data?.status === 'ok';
  } catch {
    return false;
  }
}

export async function getRandomAlbums(size = 6): Promise<SubsonicAlbum[]> {
  const data = await api<{ albumList2: { album: SubsonicAlbum[] } }>('getAlbumList2.view', {
    type: 'random',
    size,
    ...libraryFilterParams(),
  });
  return data.albumList2?.album ?? [];
}

export async function getAlbumList(
  type: 'random' | 'newest' | 'alphabeticalByName' | 'alphabeticalByArtist' | 'byYear' | 'recent' | 'starred' | 'frequent' | 'highest',
  size = 30,
  offset = 0,
  extra: Record<string, unknown> = {}
): Promise<SubsonicAlbum[]> {
  const data = await api<{ albumList2: { album: SubsonicAlbum[] } }>('getAlbumList2.view', {
    type,
    size,
    offset,
    _t: Date.now(),
    ...libraryFilterParams(),
    ...extra,
  });
  return data.albumList2?.album ?? [];
}

export async function getRandomSongs(size = 50, genre?: string, timeout = 15000): Promise<SubsonicSong[]> {
  const params: Record<string, string | number> = { size, _t: Date.now(), ...libraryFilterParams() };
  if (genre) params.genre = genre;
  const data = await api<{ randomSongs: { song: SubsonicSong[] } }>('getRandomSongs.view', params, timeout);
  return data.randomSongs?.song ?? [];
}

export async function getSong(id: string): Promise<SubsonicSong | null> {
  try {
    const data = await api<{ song: SubsonicSong }>('getSong.view', { id });
    return data.song ?? null;
  } catch {
    return null;
  }
}

export async function getAlbum(id: string): Promise<{ album: SubsonicAlbum; songs: SubsonicSong[] }> {
  const data = await api<{ album: SubsonicAlbum & { song: SubsonicSong[] } }>('getAlbum.view', { id });
  const { song, ...album } = data.album;
  return { album, songs: song ?? [] };
}

const MIX_RATING_PREFETCH_CONCURRENCY = 8;

function parseEntityUserRating(v: unknown): number | undefined {
  if (v === null || v === undefined) return undefined;
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return undefined;
  return n;
}

/** Parallel `getArtist` calls to fill mix/album filters when list endpoints omit ratings. */
export async function prefetchArtistUserRatings(
  ids: string[],
  concurrency = MIX_RATING_PREFETCH_CONCURRENCY,
): Promise<Map<string, number>> {
  const unique = [...new Set(ids.filter(Boolean))];
  const out = new Map<string, number>();
  if (!unique.length) return out;
  let next = 0;
  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= unique.length) return;
      const id = unique[i];
      try {
        const { artist } = await getArtist(id);
        const r = parseEntityUserRating(artist.userRating);
        if (r !== undefined) out.set(id, r);
      } catch {
        /* ignore */
      }
    }
  }
  const nWorkers = Math.min(concurrency, unique.length);
  await Promise.all(Array.from({ length: nWorkers }, () => worker()));
  return out;
}

/** Parallel `getAlbum` calls when `albumList2` entries lack `userRating`. */
export async function prefetchAlbumUserRatings(
  ids: string[],
  concurrency = MIX_RATING_PREFETCH_CONCURRENCY,
): Promise<Map<string, number>> {
  const unique = [...new Set(ids.filter(Boolean))];
  const out = new Map<string, number>();
  if (!unique.length) return out;
  let next = 0;
  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= unique.length) return;
      const id = unique[i];
      try {
        const { album } = await getAlbum(id);
        const r = parseEntityUserRating(album.userRating);
        if (r !== undefined) out.set(id, r);
      } catch {
        /* ignore */
      }
    }
  }
  const nWorkers = Math.min(concurrency, unique.length);
  await Promise.all(Array.from({ length: nWorkers }, () => worker()));
  return out;
}

export async function getArtists(): Promise<SubsonicArtist[]> {
  const data = await api<{ artists: { index: Array<{ artist: SubsonicArtist[] }> } }>('getArtists.view', {
    ...libraryFilterParams(),
  });
  const indices = data.artists?.index ?? [];
  return indices.flatMap(i => i.artist ?? []);
}

export async function getArtist(id: string): Promise<{ artist: SubsonicArtist; albums: SubsonicAlbum[] }> {
  const data = await api<{ artist: SubsonicArtist & { album: SubsonicAlbum[] } }>('getArtist.view', { id });
  const { album, ...artist } = data.artist;
  return { artist, albums: album ?? [] };
}

export async function getArtistInfo(id: string): Promise<SubsonicArtistInfo> {
  const data = await api<{ artistInfo2: SubsonicArtistInfo }>('getArtistInfo2.view', { id, count: 5 });
  return data.artistInfo2 ?? {};
}

export async function getTopSongs(artist: string): Promise<SubsonicSong[]> {
  try {
    const data = await api<{ topSongs: { song: SubsonicSong[] } }>('getTopSongs.view', { artist, count: 5 });
    return data.topSongs?.song ?? [];
  } catch {
    return [];
  }
}

export async function getSimilarSongs2(id: string, count = 50): Promise<SubsonicSong[]> {
  try {
    const data = await api<{ similarSongs2: { song: SubsonicSong[] } }>('getSimilarSongs2.view', { id, count });
    return data.similarSongs2?.song ?? [];
  } catch {
    return [];
  }
}

export async function getGenres(): Promise<SubsonicGenre[]> {
  const data = await api<{ genres: { genre: SubsonicGenre | SubsonicGenre[] } }>('getGenres.view');
  const raw = data.genres?.genre;
  if (!raw) return [];
  return Array.isArray(raw) ? raw : [raw];
}

export async function getAlbumsByGenre(genre: string, size = 50, offset = 0): Promise<SubsonicAlbum[]> {
  const data = await api<{ albumList2: { album: SubsonicAlbum | SubsonicAlbum[] } }>('getAlbumList2.view', {
    type: 'byGenre',
    genre,
    size,
    offset,
    _t: Date.now(),
    ...libraryFilterParams(),
  });
  const raw = data.albumList2?.album;
  if (!raw) return [];
  return Array.isArray(raw) ? raw : [raw];
}

export interface SearchResults {
  artists: SubsonicArtist[];
  albums: SubsonicAlbum[];
  songs: SubsonicSong[];
}

export interface StarredResults {
  artists: SubsonicArtist[];
  albums: SubsonicAlbum[];
  songs: SubsonicSong[];
}

export async function getStarred(): Promise<StarredResults> {
  const data = await api<{
    starred2: {
      artist?: SubsonicArtist[];
      album?: SubsonicAlbum[];
      song?: SubsonicSong[];
    }
  }>('getStarred2.view', { ...libraryFilterParams() });
  const r = data.starred2 ?? {};
  return { artists: r.artist ?? [], albums: r.album ?? [], songs: r.song ?? [] };
}

export async function star(id: string, type: 'song' | 'album' | 'artist' = 'album'): Promise<void> {
  const params: Record<string, string> = {};
  if (type === 'song') params.id = id;
  if (type === 'album') params.albumId = id;
  if (type === 'artist') params.artistId = id;
  await api('star.view', params);
}

export async function unstar(id: string, type: 'song' | 'album' | 'artist' = 'album'): Promise<void> {
  const params: Record<string, string> = {};
  if (type === 'song') params.id = id;
  if (type === 'album') params.albumId = id;
  if (type === 'artist') params.artistId = id;
  await api('unstar.view', params);
}

export async function search(query: string, options?: { albumCount?: number; artistCount?: number; songCount?: number }): Promise<SearchResults> {
  if (!query.trim()) return { artists: [], albums: [], songs: [] };
  const data = await api<{
    searchResult3: {
      artist?: SubsonicArtist[];
      album?: SubsonicAlbum[];
      song?: SubsonicSong[];
    };
  }>('search3.view', {
    query,
    artistCount: options?.artistCount ?? 5,
    albumCount: options?.albumCount ?? 5,
    songCount: options?.songCount ?? 10,
    ...libraryFilterParams(),
  });
  const r = data.searchResult3 ?? {};
  return { artists: r.artist ?? [], albums: r.album ?? [], songs: r.song ?? [] };
}

export async function setRating(id: string, rating: number): Promise<void> {
  await api('setRating.view', { id, rating });
}

/** How aggressively we assume `setRating` accepts album/artist ids (OpenSubsonic-style). */
export type EntityRatingSupportLevel = 'track_only' | 'full';

/**
 * Probe server for OpenSubsonic extensions. When `openSubsonic: true`, we treat album/artist
 * rating as supported (same `setRating.view` + entity id); otherwise track-only.
 */
export async function probeEntityRatingSupport(): Promise<EntityRatingSupportLevel> {
  try {
    const data = await api<{ openSubsonic?: boolean; openSubsonicExtensions?: unknown[] }>(
      'getOpenSubsonicExtensions.view',
      {},
      8000,
    );
    if (data.openSubsonic === true) return 'full';
    if (Array.isArray(data.openSubsonicExtensions)) return 'full';
    return 'track_only';
  } catch {
    return 'track_only';
  }
}

export async function scrobbleSong(id: string, time: number): Promise<void> {
  try {
    await api('scrobble.view', { id, time, submission: true });
  } catch {
    // best effort
  }
}

export async function reportNowPlaying(id: string): Promise<void> {
  try {
    await api('scrobble.view', { id, submission: false });
  } catch {
    // best effort
  }
}

// ─── Stream URL ───────────────────────────────────────────────
export function buildStreamUrl(id: string): string {
  const { getBaseUrl, getActiveServer } = useAuthStore.getState();
  const server = getActiveServer();
  const baseUrl = getBaseUrl();
  const salt = secureRandomSalt();
  const token = md5((server?.password ?? '') + salt);
  const p = new URLSearchParams({
    id,
    u: server?.username ?? '',
    t: token, s: salt, v: '1.16.1', c: 'psysonic', f: 'json',
  });
  return `${baseUrl}/rest/stream.view?${p.toString()}`;
}

/** Stable cache key for cover art — does not include ephemeral auth params. */
export function coverArtCacheKey(id: string, size = 256): string {
  const server = useAuthStore.getState().getActiveServer();
  return `${server?.id ?? '_'}:cover:${id}:${size}`;
}

export function buildCoverArtUrl(id: string, size = 256): string {
  const { getBaseUrl, getActiveServer } = useAuthStore.getState();
  const server = getActiveServer();
  const baseUrl = getBaseUrl();
  const salt = secureRandomSalt();
  const token = md5((server?.password ?? '') + salt);
  const p = new URLSearchParams({
    id, size: String(size),
    u: server?.username ?? '',
    t: token, s: salt, v: '1.16.1', c: 'psysonic', f: 'json',
  });
  return `${baseUrl}/rest/getCoverArt.view?${p.toString()}`;
}

export function buildDownloadUrl(id: string): string {
  const { getBaseUrl, getActiveServer } = useAuthStore.getState();
  const server = getActiveServer();
  const baseUrl = getBaseUrl();
  const salt = secureRandomSalt();
  const token = md5((server?.password ?? '') + salt);
  const p = new URLSearchParams({
    id,
    u: server?.username ?? '',
    t: token, s: salt, v: '1.16.1', c: 'psysonic', f: 'json',
  });
  return `${baseUrl}/rest/download.view?${p.toString()}`;
}

// ─── Playlists ────────────────────────────────────────────────
export async function getPlaylists(): Promise<SubsonicPlaylist[]> {
  const data = await api<{ playlists: { playlist: SubsonicPlaylist[] } }>('getPlaylists.view');
  return data.playlists?.playlist ?? [];
}

export async function getPlaylist(id: string): Promise<{ playlist: SubsonicPlaylist; songs: SubsonicSong[] }> {
  const data = await api<{ playlist: SubsonicPlaylist & { entry: SubsonicSong[] } }>('getPlaylist.view', { id });
  const { entry, ...playlist } = data.playlist;
  return { playlist, songs: entry ?? [] };
}

export async function createPlaylist(name: string, songIds?: string[]): Promise<SubsonicPlaylist> {
  const params: Record<string, unknown> = { name };
  if (songIds && songIds.length > 0) {
    params.songId = songIds;
  }
  const data = await api<{ playlist: SubsonicPlaylist }>('createPlaylist.view', params);
  return data.playlist;
}

export async function updatePlaylist(id: string, songIds: string[], prevCount = 0): Promise<void> {
  if (songIds.length > 0) {
    // createPlaylist with playlistId replaces the existing playlist's songs (Subsonic API 1.14+)
    await api('createPlaylist.view', { playlistId: id, songId: songIds });
  } else if (prevCount > 0) {
    // Axios serialises empty arrays as no params — createPlaylist.view would leave songs unchanged.
    // Use updatePlaylist.view with explicit index removal to clear the list instead.
    await api('updatePlaylist.view', {
      playlistId: id,
      songIndexToRemove: Array.from({ length: prevCount }, (_, i) => i),
    });
  }
}

export async function updatePlaylistMeta(
  id: string,
  name: string,
  comment: string,
  isPublic: boolean,
): Promise<void> {
  await api('updatePlaylist.view', { playlistId: id, name, comment, public: isPublic });
}

export async function uploadPlaylistCoverArt(id: string, file: File): Promise<void> {
  // Navidrome-specific endpoint — handled in Rust to bypass browser CORS restrictions.
  const { getBaseUrl, getActiveServer } = useAuthStore.getState();
  const server = getActiveServer();
  const baseUrl = getBaseUrl();
  const buffer = await file.arrayBuffer();
  const fileBytes = Array.from(new Uint8Array(buffer));
  await invoke('upload_playlist_cover', {
    serverUrl: baseUrl,
    playlistId: id,
    username: server?.username ?? '',
    password: server?.password ?? '',
    fileBytes,
    mimeType: file.type || 'image/jpeg',
  });
}

export async function uploadArtistImage(id: string, file: File): Promise<void> {
  // Navidrome-specific endpoint — handled in Rust to bypass browser CORS restrictions.
  const { getBaseUrl, getActiveServer } = useAuthStore.getState();
  const server = getActiveServer();
  const baseUrl = getBaseUrl();
  const buffer = await file.arrayBuffer();
  const fileBytes = Array.from(new Uint8Array(buffer));
  await invoke('upload_artist_image', {
    serverUrl: baseUrl,
    artistId: id,
    username: server?.username ?? '',
    password: server?.password ?? '',
    fileBytes,
    mimeType: file.type || 'image/jpeg',
  });
}

export async function deletePlaylist(id: string): Promise<void> {
  await api('deletePlaylist.view', { id });
}

// ─── Play Queue Sync ──────────────────────────────────────────
export async function getPlayQueue(): Promise<{ current?: string; position?: number; songs: SubsonicSong[] }> {
  try {
    const data = await api<{ playQueue: { current?: string; position?: number; entry?: SubsonicSong[] } }>('getPlayQueue.view');
    const pq = data.playQueue;
    return { current: pq?.current, position: pq?.position, songs: pq?.entry ?? [] };
  } catch {
    return { songs: [] };
  }
}

export async function savePlayQueue(songIds: string[], current?: string, position?: number): Promise<void> {
  const params: Record<string, unknown> = {};
  if (songIds.length > 0) params.id = songIds;
  if (current !== undefined) params.current = current;
  if (position !== undefined) params.position = position;
  await api('savePlayQueue.view', params);
}

// ─── Now Playing ──────────────────────────────────────────────
export async function getNowPlaying(): Promise<SubsonicNowPlaying[]> {
  try {
    const data = await api<{ nowPlaying: { entry?: SubsonicNowPlaying[] } | '' }>('getNowPlaying.view');
    if (!data.nowPlaying || typeof data.nowPlaying === 'string') return [];
    return data.nowPlaying.entry ?? [];
  } catch {
    return [];
  }
}


// ─── Internet Radio ───────────────────────────────────────────
export async function getInternetRadioStations(): Promise<InternetRadioStation[]> {
  try {
    const data = await api<{ internetRadioStations?: { internetRadioStation?: InternetRadioStation[] } }>(
      'getInternetRadioStations.view'
    );
    return data.internetRadioStations?.internetRadioStation ?? [];
  } catch {
    return [];
  }
}

export async function createInternetRadioStation(
  name: string, streamUrl: string, homepageUrl?: string
): Promise<void> {
  const params: Record<string, unknown> = { name, streamUrl };
  if (homepageUrl) params.homepageUrl = homepageUrl;
  await api('createInternetRadioStation.view', params);
}

export async function updateInternetRadioStation(
  id: string, name: string, streamUrl: string, homepageUrl?: string
): Promise<void> {
  const params: Record<string, unknown> = { id, name, streamUrl };
  if (homepageUrl) params.homepageUrl = homepageUrl;
  await api('updateInternetRadioStation.view', params);
}

export async function deleteInternetRadioStation(id: string): Promise<void> {
  await api('deleteInternetRadioStation.view', { id });
}

export async function uploadRadioCoverArt(id: string, file: File): Promise<void> {
  // Navidrome-specific endpoint — handled in Rust to bypass browser CORS restrictions.
  const { getBaseUrl, getActiveServer } = useAuthStore.getState();
  const server = getActiveServer();
  const baseUrl = getBaseUrl();
  const buffer = await file.arrayBuffer();
  const fileBytes = Array.from(new Uint8Array(buffer));
  await invoke('upload_radio_cover', {
    serverUrl: baseUrl,
    radioId: id,
    username: server?.username ?? '',
    password: server?.password ?? '',
    fileBytes,
    mimeType: file.type || 'image/jpeg',
  });
}

export async function deleteRadioCoverArt(id: string): Promise<void> {
  // Navidrome-specific endpoint — handled in Rust to bypass browser CORS restrictions.
  const { getBaseUrl, getActiveServer } = useAuthStore.getState();
  const server = getActiveServer();
  const baseUrl = getBaseUrl();
  await invoke('delete_radio_cover', {
    serverUrl: baseUrl,
    radioId: id,
    username: server?.username ?? '',
    password: server?.password ?? '',
  });
}

export async function uploadRadioCoverArtBytes(id: string, fileBytes: number[], mimeType: string): Promise<void> {
  const { getBaseUrl, getActiveServer } = useAuthStore.getState();
  const server = getActiveServer();
  const baseUrl = getBaseUrl();
  await invoke('upload_radio_cover', {
    serverUrl: baseUrl,
    radioId: id,
    username: server?.username ?? '',
    password: server?.password ?? '',
    fileBytes,
    mimeType,
  });
}

function parseRadioBrowserStations(raw: Array<Record<string, string>>): RadioBrowserStation[] {
  return raw.map(s => ({
    stationuuid: s.stationuuid ?? '',
    name: s.name ?? '',
    url: s.url ?? '',
    favicon: s.favicon ?? '',
    tags: s.tags ?? '',
  }));
}

export const RADIO_PAGE_SIZE = 25;

export async function searchRadioBrowser(query: string, offset = 0): Promise<RadioBrowserStation[]> {
  const raw = await invoke<Array<Record<string, string>>>('search_radio_browser', { query, offset });
  return parseRadioBrowserStations(raw);
}

export async function getTopRadioStations(offset = 0): Promise<RadioBrowserStation[]> {
  const raw = await invoke<Array<Record<string, string>>>('get_top_radio_stations', { offset });
  return parseRadioBrowserStations(raw);
}

export async function fetchUrlBytes(url: string): Promise<[number[], string]> {
  return invoke<[number[], string]>('fetch_url_bytes', { url });
}

// ─── Structured Lyrics (OpenSubsonic / getLyricsBySongId) ────────────────────

export interface SubsonicLyricLine {
  start?: number; // milliseconds — absent when unsynced
  value: string;
}

export interface SubsonicStructuredLyrics {
  issynced: boolean;
  lang?: string;
  offset?: number;
  displayArtist?: string;
  displayTitle?: string;
  line: SubsonicLyricLine[];
}

/**
 * Fetches structured lyrics from the server's embedded tags via the
 * OpenSubsonic `getLyricsBySongId` endpoint. Returns null when the
 * server doesn't support the endpoint or the track has no embedded lyrics.
 * Prefers synced lyrics over plain when both are present.
 */
export async function getLyricsBySongId(id: string): Promise<SubsonicStructuredLyrics | null> {
  try {
    const data = await api<{ lyricsList: { structuredLyrics?: SubsonicStructuredLyrics[] } }>(
      'getLyricsBySongId.view',
      { id },
    );
    const list = data.lyricsList?.structuredLyrics;
    if (!list || list.length === 0) return null;
    return list.find(l => l.issynced) ?? list[0];
  } catch {
    // Server doesn't support the endpoint or track has no embedded lyrics
    return null;
  }
}
