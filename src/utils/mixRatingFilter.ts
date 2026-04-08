import {
  getRandomSongs,
  prefetchAlbumUserRatings,
  prefetchArtistUserRatings,
  type SubsonicAlbum,
  type SubsonicSong,
} from '../api/subsonic';
import { useAuthStore } from '../store/authStore';

/** Target list size for Random Mix after rating filter. */
export const RANDOM_MIX_TARGET_SIZE = 50;
const RANDOM_MIX_BATCH_SIZE = 50;
/** Upper bound on `getRandomSongs` calls (avoids infinite loop if the library is tiny or the filter is extreme). */
const RANDOM_MIX_MAX_BATCHES = 40;
/** Stop if several batches in a row bring no new track ids (server keeps repeating the same set). */
const RANDOM_MIX_MAX_DUP_STREAK = 6;

export interface MixMinRatingsConfig {
  enabled: boolean;
  minSong: number;
  minAlbum: number;
  minArtist: number;
}

export function getMixMinRatingsConfigFromAuth(): MixMinRatingsConfig {
  const s = useAuthStore.getState();
  return {
    enabled: s.mixMinRatingFilterEnabled,
    minSong: s.mixMinRatingSong,
    minAlbum: s.mixMinRatingAlbum,
    minArtist: s.mixMinRatingArtist,
  };
}

function numRating(v: unknown): number | undefined {
  if (v === null || v === undefined) return undefined;
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return undefined;
  return n;
}

function ratingFromArtistRefs(
  list: Array<{ id?: string; userRating?: unknown }> | undefined,
  preferId?: string,
): number | undefined {
  if (!list?.length) return undefined;
  if (preferId) {
    const m = list.find(a => a.id === preferId);
    const r = numRating(m?.userRating);
    if (r !== undefined) return r;
  }
  for (const a of list) {
    const r = numRating(a.userRating);
    if (r !== undefined) return r;
  }
  return undefined;
}

/** Song-level artist rating: explicit field, then OpenSubsonic `artists` / `albumArtists` on the child. */
function effectiveArtistRatingForFilter(song: SubsonicSong): number | undefined {
  const d = numRating(song.artistUserRating);
  if (d !== undefined) return d;
  const fromArtists = ratingFromArtistRefs(song.artists, song.artistId);
  if (fromArtists !== undefined) return fromArtists;
  return ratingFromArtistRefs(song.albumArtists, song.artistId);
}

/** Song-level album (parent) rating when the server puts it on the child payload. */
function effectiveAlbumRatingOnSong(song: SubsonicSong): number | undefined {
  return numRating(song.albumUserRating);
}

/**
 * Random mixes: when enabled, drop items with a **non-zero** rating that is **at or below** the
 * chosen threshold (inclusive). `0` / missing = unrated, never excluded.
 */
export function passesMixMinRatings(song: SubsonicSong, c: MixMinRatingsConfig): boolean {
  if (!c.enabled) return true;
  if (c.minSong > 0) {
    const r = numRating(song.userRating);
    if (r !== undefined && r > 0 && r <= c.minSong) return false;
  }
  if (c.minAlbum > 0) {
    const r = effectiveAlbumRatingOnSong(song);
    if (r !== undefined && r > 0 && r <= c.minAlbum) return false;
  }
  if (c.minArtist > 0) {
    const r = effectiveArtistRatingForFilter(song);
    if (r !== undefined && r > 0 && r <= c.minArtist) return false;
  }
  return true;
}

export interface MixAlbumFilterExtra {
  /** From `getArtist` when list payloads omit artist rating. */
  artistUserRating?: number;
  /** From `getAlbum` when list payloads omit album `userRating`. */
  albumUserRating?: number;
}

/**
 * Random album lists: album `userRating` when present; optional extra from entity fetches.
 * Song axis is not on this payload. `0` / missing = unrated, keep.
 */
export function passesMixMinRatingsForAlbum(
  album: SubsonicAlbum,
  c: MixMinRatingsConfig,
  extra?: MixAlbumFilterExtra,
): boolean {
  if (!c.enabled) return true;
  if (c.minAlbum > 0) {
    const r = numRating(album.userRating ?? extra?.albumUserRating);
    if (r !== undefined && r > 0 && r <= c.minAlbum) return false;
  }
  if (c.minArtist > 0) {
    const r = numRating(extra?.artistUserRating);
    if (r !== undefined && r > 0 && r <= c.minArtist) return false;
  }
  return true;
}

/**
 * Fetches missing entity ratings (bounded concurrency) then filters. Used for random album grids / hero.
 */
export async function filterAlbumsByMixRatings(
  albums: SubsonicAlbum[],
  c: MixMinRatingsConfig,
): Promise<SubsonicAlbum[]> {
  if (!c.enabled) return albums;
  if (c.minAlbum <= 0 && c.minArtist <= 0) return albums;
  const needArtist = c.minArtist > 0;
  const needAlbum = c.minAlbum > 0;
  let byArtist = new Map<string, number>();
  let byAlbum = new Map<string, number>();
  if (needArtist) {
    const ids = [...new Set(albums.map(a => a.artistId).filter(Boolean))] as string[];
    byArtist = await prefetchArtistUserRatings(ids);
  }
  if (needAlbum) {
    const ids = [...new Set(albums.filter(a => a.userRating === undefined).map(a => a.id))];
    if (ids.length) byAlbum = await prefetchAlbumUserRatings(ids);
  }
  return albums.filter(a =>
    passesMixMinRatingsForAlbum(a, c, {
      artistUserRating: a.artistId ? byArtist.get(a.artistId) : undefined,
      albumUserRating: byAlbum.get(a.id),
    }),
  );
}

/**
 * Merge `getArtist` / `getAlbum` ratings into songs before `passesMixMinRatings` when list payloads omit them.
 */
export async function enrichSongsForMixRatingFilter(
  songs: SubsonicSong[],
  c: MixMinRatingsConfig,
): Promise<SubsonicSong[]> {
  if (!c.enabled || (c.minArtist <= 0 && c.minAlbum <= 0)) return songs;
  const artistIds =
    c.minArtist > 0
      ? [...new Set(songs.filter(s => s.artistUserRating === undefined && effectiveArtistRatingForFilter(s) === undefined && s.artistId).map(s => s.artistId!))]
      : [];
  const albumIds =
    c.minAlbum > 0
      ? [...new Set(songs.filter(s => s.albumUserRating === undefined && s.albumId).map(s => s.albumId!))]
      : [];
  const [byArtist, byAlbum] = await Promise.all([
    artistIds.length ? prefetchArtistUserRatings(artistIds) : Promise.resolve(new Map<string, number>()),
    albumIds.length ? prefetchAlbumUserRatings(albumIds) : Promise.resolve(new Map<string, number>()),
  ]);
  if (!byArtist.size && !byAlbum.size) return songs;
  return songs.map(s => ({
    ...s,
    ...(s.artistUserRating === undefined &&
    s.artistId &&
    byArtist.has(s.artistId) && { artistUserRating: byArtist.get(s.artistId)! }),
    ...(s.albumUserRating === undefined &&
    s.albumId &&
    byAlbum.has(s.albumId) && { albumUserRating: byAlbum.get(s.albumId)! }),
  }));
}

/**
 * Loads random songs in batches until `RANDOM_MIX_TARGET_SIZE` pass `passesMixMinRatings` (after enrich),
 * or limits are hit. When the mix rating filter is off, a single batch is used.
 */
export async function fetchRandomMixSongsUntilFull(
  c: MixMinRatingsConfig,
  opts?: { genre?: string; timeout?: number },
): Promise<SubsonicSong[]> {
  const timeout = opts?.timeout ?? 15000;
  const genre = opts?.genre;

  if (!c.enabled) {
    const raw = await getRandomSongs(RANDOM_MIX_BATCH_SIZE, genre, timeout);
    return raw.slice(0, RANDOM_MIX_TARGET_SIZE);
  }

  const out: SubsonicSong[] = [];
  const outIds = new Set<string>();
  const seenFromApi = new Set<string>();
  let dupStreak = 0;

  for (let b = 0; b < RANDOM_MIX_MAX_BATCHES && out.length < RANDOM_MIX_TARGET_SIZE; b++) {
    const raw = await getRandomSongs(RANDOM_MIX_BATCH_SIZE, genre, timeout);
    if (!raw.length) break;

    const novel = raw.filter(s => !seenFromApi.has(s.id));
    for (const s of raw) seenFromApi.add(s.id);

    if (!novel.length) {
      if (++dupStreak >= RANDOM_MIX_MAX_DUP_STREAK) break;
      continue;
    }
    dupStreak = 0;

    const enriched = await enrichSongsForMixRatingFilter(novel, c);
    for (const s of enriched) {
      if (!passesMixMinRatings(s, c) || outIds.has(s.id)) continue;
      outIds.add(s.id);
      out.push(s);
      if (out.length >= RANDOM_MIX_TARGET_SIZE) break;
    }
  }

  return out;
}
