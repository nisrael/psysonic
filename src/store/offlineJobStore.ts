import { create } from 'zustand';

export interface DownloadJob {
  trackId: string;
  albumId: string;
  albumName: string;
  trackTitle: string;
  trackIndex: number;
  totalTracks: number;
  status: 'queued' | 'downloading' | 'done' | 'error';
}

interface OfflineJobState {
  jobs: DownloadJob[];
  bulkProgress: Record<string, { done: number; total: number }>;
  cancelDownload: (albumId: string) => void;
  cancelAllDownloads: () => void;
}

// Module-level cancellation set — checked by downloadAlbum before each batch.
export const cancelledDownloads = new Set<string>();

export const useOfflineJobStore = create<OfflineJobState>()((set, get) => ({
  jobs: [],
  bulkProgress: {},

  cancelDownload: (albumId) => {
    cancelledDownloads.add(albumId);
    // Remove queued (not yet started) jobs immediately so the counter drops.
    set(state => ({
      jobs: state.jobs.filter(j => !(j.albumId === albumId && j.status === 'queued')),
    }));
  },

  cancelAllDownloads: () => {
    const unique = [...new Set(
      get().jobs
        .filter(j => j.status === 'queued' || j.status === 'downloading')
        .map(j => j.albumId),
    )];
    unique.forEach(id => cancelledDownloads.add(id));
    set(state => ({
      jobs: state.jobs.filter(j => j.status !== 'queued'),
    }));
  },
}));
