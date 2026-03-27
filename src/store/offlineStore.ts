import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { invoke } from '@tauri-apps/api/core';
import { buildStreamUrl } from '../api/subsonic';
import type { SubsonicSong } from '../api/subsonic';

export interface OfflineTrackMeta {
  id: string;
  serverId: string;
  localPath: string;
  title: string;
  artist: string;
  album: string;
  albumId: string;
  artistId?: string;
  suffix: string;
  duration: number;
  bitRate?: number;
  coverArt?: string;
  year?: number;
  genre?: string;
  replayGainTrackDb?: number;
  replayGainAlbumDb?: number;
  replayGainPeak?: number;
  cachedAt: string;
}

export interface OfflineAlbumMeta {
  id: string;
  serverId: string;
  name: string;
  artist: string;
  coverArt?: string;
  year?: number;
  trackIds: string[];
}

export interface DownloadJob {
  trackId: string;
  albumId: string;
  albumName: string;
  trackTitle: string;
  trackIndex: number;
  totalTracks: number;
  status: 'queued' | 'downloading' | 'done' | 'error';
}

interface OfflineState {
  tracks: Record<string, OfflineTrackMeta>;   // key: `${serverId}:${trackId}`
  albums: Record<string, OfflineAlbumMeta>;   // key: `${serverId}:${albumId}`
  jobs: DownloadJob[];

  isDownloaded: (trackId: string, serverId: string) => boolean;
  isAlbumDownloaded: (albumId: string, serverId: string) => boolean;
  isAlbumDownloading: (albumId: string) => boolean;
  getLocalUrl: (trackId: string, serverId: string) => string | null;
  downloadAlbum: (
    albumId: string,
    albumName: string,
    albumArtist: string,
    coverArt: string | undefined,
    year: number | undefined,
    songs: SubsonicSong[],
    serverId: string,
  ) => Promise<void>;
  deleteAlbum: (albumId: string, serverId: string) => Promise<void>;
  clearAll: (serverId: string) => Promise<void>;
  getAlbumProgress: (albumId: string) => { done: number; total: number } | null;
}

export const useOfflineStore = create<OfflineState>()(
  persist(
    (set, get) => ({
      tracks: {},
      albums: {},
      jobs: [],

      isDownloaded: (trackId, serverId) =>
        !!get().tracks[`${serverId}:${trackId}`],

      isAlbumDownloaded: (albumId, serverId) => {
        const album = get().albums[`${serverId}:${albumId}`];
        if (!album || album.trackIds.length === 0) return false;
        return album.trackIds.every(tid => !!get().tracks[`${serverId}:${tid}`]);
      },

      isAlbumDownloading: (albumId) =>
        get().jobs.some(
          j => j.albumId === albumId && (j.status === 'queued' || j.status === 'downloading')
        ),

      getLocalUrl: (trackId, serverId) => {
        const meta = get().tracks[`${serverId}:${trackId}`];
        if (!meta) return null;
        return `psysonic-local://${meta.localPath}`;
      },

      clearAll: async (serverId) => {
        const albumKeys = Object.keys(get().albums).filter(k => k.startsWith(`${serverId}:`));
        for (const key of albumKeys) {
          const albumId = key.slice(`${serverId}:`.length);
          await get().deleteAlbum(albumId, serverId);
        }
      },

      getAlbumProgress: (albumId) => {
        const albumJobs = get().jobs.filter(j => j.albumId === albumId);
        if (albumJobs.length === 0) return null;
        const done = albumJobs.filter(j => j.status === 'done' || j.status === 'error').length;
        return { done, total: albumJobs.length };
      },

      downloadAlbum: async (albumId, albumName, albumArtist, coverArt, year, songs, serverId) => {
        const CONCURRENCY = 2;
        const trackIds = songs.map(s => s.id);

        // Register album shell + queue jobs
        set(state => ({
          albums: {
            ...state.albums,
            [`${serverId}:${albumId}`]: { id: albumId, serverId, name: albumName, artist: albumArtist, coverArt, year, trackIds },
          },
          jobs: [
            ...state.jobs.filter(j => j.albumId !== albumId),
            ...songs.map((s, i) => ({
              trackId: s.id,
              albumId,
              albumName,
              trackTitle: s.title,
              trackIndex: i,
              totalTracks: songs.length,
              status: 'queued' as const,
            })),
          ],
        }));

        // Download in batches of CONCURRENCY
        for (let i = 0; i < songs.length; i += CONCURRENCY) {
          const batch = songs.slice(i, i + CONCURRENCY);
          await Promise.all(
            batch.map(async song => {
              set(state => ({
                jobs: state.jobs.map(j =>
                  j.trackId === song.id && j.albumId === albumId
                    ? { ...j, status: 'downloading' }
                    : j,
                ),
              }));

              const suffix = song.suffix || 'mp3';
              const url = buildStreamUrl(song.id);

              try {
                const localPath = await invoke<string>('download_track_offline', {
                  trackId: song.id,
                  serverId,
                  url,
                  suffix,
                });

                set(state => ({
                  tracks: {
                    ...state.tracks,
                    [`${serverId}:${song.id}`]: {
                      id: song.id,
                      serverId,
                      localPath,
                      title: song.title,
                      artist: song.artist,
                      album: song.album,
                      albumId: song.albumId,
                      artistId: song.artistId,
                      suffix,
                      duration: song.duration,
                      bitRate: song.bitRate,
                      coverArt: song.coverArt,
                      year: song.year,
                      genre: song.genre,
                      replayGainTrackDb: song.replayGain?.trackGain,
                      replayGainAlbumDb: song.replayGain?.albumGain,
                      replayGainPeak: song.replayGain?.trackPeak,
                      cachedAt: new Date().toISOString(),
                    },
                  },
                  jobs: state.jobs.map(j =>
                    j.trackId === song.id && j.albumId === albumId
                      ? { ...j, status: 'done' }
                      : j,
                  ),
                }));
              } catch {
                set(state => ({
                  jobs: state.jobs.map(j =>
                    j.trackId === song.id && j.albumId === albumId
                      ? { ...j, status: 'error' }
                      : j,
                  ),
                }));
              }
            }),
          );
        }

        // Clear completed jobs after a short delay
        setTimeout(() => {
          set(state => ({
            jobs: state.jobs.filter(
              j => j.albumId !== albumId || (j.status !== 'done' && j.status !== 'error'),
            ),
          }));
        }, 2500);
      },

      deleteAlbum: async (albumId, serverId) => {
        const album = get().albums[`${serverId}:${albumId}`];
        if (!album) return;

        await Promise.all(
          album.trackIds.map(async trackId => {
            const meta = get().tracks[`${serverId}:${trackId}`];
            if (!meta) return;
            await invoke('delete_offline_track', {
              trackId,
              serverId,
              suffix: meta.suffix,
            }).catch(() => {});
          }),
        );

        set(state => {
          const tracks = { ...state.tracks };
          album.trackIds.forEach(tid => delete tracks[`${serverId}:${tid}`]);
          const albums = { ...state.albums };
          delete albums[`${serverId}:${albumId}`];
          return { tracks, albums };
        });
      },
    }),
    {
      name: 'psysonic-offline',
      storage: createJSONStorage(() => localStorage),
      partialize: state => ({ tracks: state.tracks, albums: state.albums }),
    },
  ),
);
