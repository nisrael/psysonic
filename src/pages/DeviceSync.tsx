import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import {
  HardDriveUpload, FolderOpen, Loader2,
  ListMusic, Disc3, Users, CheckCircle2, AlertCircle, Clock,
  ChevronRight, ChevronDown, Trash2, Undo2, Search, Usb, RefreshCw, Shuffle, Zap, X,
} from 'lucide-react';
import CustomSelect from '../components/CustomSelect';
import { useTranslation } from 'react-i18next';
import { useDeviceSyncStore, DeviceSyncSource } from '../store/deviceSyncStore';
import { useDeviceSyncJobStore } from '../store/deviceSyncJobStore';
import {
  getPlaylists, getAlbumList, getArtists, getAlbum, getPlaylist, getArtist,
  buildDownloadUrl, search as searchSubsonic,
  SubsonicSong, SubsonicAlbum, SubsonicPlaylist, SubsonicArtist,
} from '../api/subsonic';
import { showToast } from '../utils/toast';

type SourceTab = 'playlists' | 'albums' | 'artists';

// ─── helpers ─────────────────────────────────────────────────────────────────

function uuid(): string { return crypto.randomUUID(); }

async function fetchTracksForSource(source: DeviceSyncSource): Promise<SubsonicSong[]> {
  if (source.type === 'playlist') { const { songs } = await getPlaylist(source.id); return songs; }
  if (source.type === 'album')    { const { songs } = await getAlbum(source.id);    return songs; }
  const { albums } = await getArtist(source.id);
  const all: SubsonicSong[] = [];
  for (const album of albums) { const { songs } = await getAlbum(album.id); all.push(...songs); }
  return all;
}

function trackToSyncInfo(track: SubsonicSong, url: string) {
  return {
    id: track.id, url,
    suffix: track.suffix ?? 'mp3',
    artist: track.artist ?? '',
    album: track.album ?? '',
    title: track.title ?? '',
    trackNumber: track.track,
    discNumber: track.discNumber,
    year: track.year,
  };
}

type SyncStatus = 'synced' | 'pending' | 'deletion';

interface RemovableDrive {
  name: string;
  mount_point: string;
  available_space: number;
  total_space: number;
  file_system: string;
  is_removable: boolean;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

// ─── component ───────────────────────────────────────────────────────────────

export default function DeviceSync() {
  const { t } = useTranslation();

  const targetDir        = useDeviceSyncStore(s => s.targetDir);
  const filenameTemplate = useDeviceSyncStore(s => s.filenameTemplate);
  const sources          = useDeviceSyncStore(s => s.sources);
  const checkedIds       = useDeviceSyncStore(s => s.checkedIds);
  const pendingDeletion  = useDeviceSyncStore(s => s.pendingDeletion);
  const deviceFilePaths  = useDeviceSyncStore(s => s.deviceFilePaths);
  const scanning         = useDeviceSyncStore(s => s.scanning);
  const {
    setTargetDir, setFilenameTemplate, addSource, removeSource,
    clearSources, toggleChecked, setCheckedIds, markForDeletion,
    unmarkDeletion, removeSources, setDeviceFilePaths, setScanning,
  } = useDeviceSyncStore.getState();

  const jobStatus = useDeviceSyncJobStore(s => s.status);
  const jobDone   = useDeviceSyncJobStore(s => s.done);
  const jobSkip   = useDeviceSyncJobStore(s => s.skipped);
  const jobFail   = useDeviceSyncJobStore(s => s.failed);
  const jobTotal  = useDeviceSyncJobStore(s => s.total);

  const [activeTab, setActiveTab]           = useState<SourceTab>('albums');
  const [search, setSearch]                 = useState('');
  const [playlists, setPlaylists]           = useState<SubsonicPlaylist[]>([]);
  const [randomAlbums, setRandomAlbums]     = useState<SubsonicAlbum[]>([]);
  const [albumSearchResults, setAlbumSearchResults] = useState<SubsonicAlbum[]>([]);
  const [albumSearchLoading, setAlbumSearchLoading] = useState(false);
  const [artists, setArtists]               = useState<SubsonicArtist[]>([]);
  const [loadingBrowser, setLoadingBrowser] = useState(false);
  const [expandedArtistIds, setExpandedArtistIds] = useState<Set<string>>(new Set());
  const [artistAlbumsMap, setArtistAlbumsMap]     = useState<Map<string, SubsonicAlbum[]>>(new Map());
  const [loadingArtistIds, setLoadingArtistIds]   = useState<Set<string>>(new Set());

  // Map source IDs → computed device paths (for status derivation)
  const [sourcePathsMap, setSourcePathsMap] = useState<Map<string, string[]>>(new Map());
  // Template stored in the manifest — may differ from local filenameTemplate when reading a
  // manifest written on another OS. Used only for status checks, not for new syncs.
  const [deviceManifestTemplate, setDeviceManifestTemplate] = useState<string | null>(null);

  // ─── Removable drive detection ──────────────────────────────────────────
  const [drives, setDrives] = useState<RemovableDrive[]>([]);
  const [drivesLoading, setDrivesLoading] = useState(false);

  const [preSyncOpen, setPreSyncOpen] = useState(false);
  const [preSyncLoading, setPreSyncLoading] = useState(false);
  const [syncDelta, setSyncDelta] = useState({ addBytes: 0, addCount: 0, delBytes: 0, delCount: 0, availableBytes: 0, tracks: [] as SubsonicSong[] });

  const refreshDrives = useCallback(async () => {
    setDrivesLoading(true);
    try {
      const result = await invoke<RemovableDrive[]>('get_removable_drives');
      setDrives(result);
    } catch {
      setDrives([]);
    } finally {
      setDrivesLoading(false);
    }
  }, []);

  // Fetch drives on mount, then poll every 5 seconds
  useEffect(() => {
    refreshDrives();
    const interval = setInterval(refreshDrives, 5000);
    return () => clearInterval(interval);
  }, [refreshDrives]);

  // Detect if the current targetDir is on a detected removable drive
  const activeDrive = useMemo(() => {
    if (!targetDir) return null;
    return drives.find(d => targetDir.startsWith(d.mount_point)) ?? null;
  }, [targetDir, drives]);

  const driveDetected = activeDrive !== null;

  const isRunning = jobStatus === 'running';

  // ─── Device scan on mount ───────────────────────────────────────────────

  const scanDevice = useCallback(async () => {
    if (!targetDir || sources.length === 0) {
      setDeviceFilePaths([]);
      return;
    }
    setScanning(true);
    try {
      const files = await invoke<string[]>('list_device_dir_files', { dir: targetDir });
      setDeviceFilePaths(files);
    } catch {
      setDeviceFilePaths([]);
    } finally {
      setScanning(false);
    }
  }, [targetDir, sources.length]);

  // Scan device on mount and when targetDir changes
  useEffect(() => { scanDevice(); }, [scanDevice]);

  // Auto-import manifest when page loads and drive is already connected
  const manifestImportedRef = useRef(false);
  useEffect(() => {
    if (!targetDir || !driveDetected || manifestImportedRef.current) return;
    manifestImportedRef.current = true;
    invoke<{ version: number; sources: DeviceSyncSource[]; filenameTemplate?: string } | null>(
      'read_device_manifest', { destDir: targetDir }
    ).then(manifest => {
      if (manifest?.sources?.length) {
        useDeviceSyncStore.getState().clearSources();
        manifest.sources.forEach(s => useDeviceSyncStore.getState().addSource(s));
        setDeviceManifestTemplate(manifest.filenameTemplate ?? null);
        showToast(t('deviceSync.manifestImported', { count: manifest.sources.length }), 4000, 'info');
      }
    }).catch(() => {});
  }, [targetDir, driveDetected, t]);

  // Clear device file list and reset import flag when stick is unplugged
  useEffect(() => {
    if (!driveDetected) {
      setDeviceFilePaths([]);
      setDeviceManifestTemplate(null);
      manifestImportedRef.current = false;
    }
  }, [driveDetected]);

  // Compute expected paths for each source (for status comparison)
  useEffect(() => {
    if (!targetDir || sources.length === 0) {
      setSourcePathsMap(new Map());
      return;
    }
    // Use the template from the manifest (written by the original sync machine) so that
    // status checks work correctly even when the local template differs (e.g. Windows→Linux).
    const templateForStatus = deviceManifestTemplate ?? filenameTemplate;
    let cancelled = false;
    (async () => {
      const map = new Map<string, string[]>();
      await Promise.all(sources.map(async source => {
        if (cancelled) return;
        try {
          const tracks = await fetchTracksForSource(source);
          const paths = await invoke<string[]>('compute_sync_paths', {
            tracks: tracks.map(t => trackToSyncInfo(t, '')),
            destDir: targetDir,
            template: templateForStatus,
          });
          map.set(source.id, paths);
        } catch {
          map.set(source.id, []);
        }
      }));
      if (!cancelled) setSourcePathsMap(map);
    })();
    return () => { cancelled = true; };
  }, [targetDir, filenameTemplate, deviceManifestTemplate, sources]);

  // Derive sync status per source
  const sourceStatuses = useMemo(() => {
    const deviceSet = new Set(deviceFilePaths);
    const statuses = new Map<string, SyncStatus>();
    for (const source of sources) {
      if (pendingDeletion.includes(source.id)) {
        statuses.set(source.id, 'deletion');
      } else {
        const paths = sourcePathsMap.get(source.id) ?? [];
        const allSynced = paths.length > 0 && paths.every(p => deviceSet.has(p));
        statuses.set(source.id, allSynced ? 'synced' : 'pending');
      }
    }
    return statuses;
  }, [sources, pendingDeletion, sourcePathsMap, deviceFilePaths]);

  // ─── Desired State / Diff Logic ─────────────────────────────────────────

  const handleToggleSource = useCallback((source: DeviceSyncSource) => {
    const isSelected = sources.some(s => s.id === source.id);
    const isPendingDeletion = pendingDeletion.includes(source.id);
    const isActuallySelected = isSelected && !isPendingDeletion;

    if (isActuallySelected) {
      // User initiated a DE-SELECTION. Diff check against target device
      const isSynced = sourceStatuses.get(source.id) === 'synced';
      const pathsOnDisk = sourcePathsMap.get(source.id)?.filter(p => deviceFilePaths.includes(p)).length || 0;
      
      if (pathsOnDisk > 0 || isSynced) {
        // Source currently has physical footprint. Stage for deletion.
        markForDeletion([source.id]);
      } else {
        // Zero physical footprint. Strip safely.
        removeSource(source.id);
      }
    } else {
      // User initiated a SELECTION.
      if (isPendingDeletion) {
        unmarkDeletion(source.id); // Cancel queued red/strikethrough state
      } else if (!isSelected) {
        addSource(source); // Trigger clean pending install state
      }
    }
  }, [sources, pendingDeletion, sourceStatuses, sourcePathsMap, deviceFilePaths, markForDeletion, removeSource, unmarkDeletion, addSource]);

  // ─── Listen for background sync events ──────────────────────────────────

  useEffect(() => {
    const jobStore = useDeviceSyncJobStore.getState;
    const unlistenProgress = listen<{
      jobId: string; done: number; skipped: number; failed: number; total: number;
    }>('device:sync:progress', ({ payload }) => {
      const current = jobStore();
      if (current.jobId && payload.jobId === current.jobId) {
        useDeviceSyncJobStore.getState().updateProgress(
          payload.done, payload.skipped, payload.failed
        );
      }
    });

    const unlistenComplete = listen<{
      jobId: string; done: number; skipped: number; failed: number; total: number; cancelled?: boolean;
    }>('device:sync:complete', ({ payload }) => {
      const current = jobStore();
      if (current.jobId && payload.jobId === current.jobId) {
        if (payload.cancelled) {
          useDeviceSyncJobStore.getState().complete(payload.done, payload.skipped, payload.failed);
          // status is already 'cancelled' from the button click; complete() would overwrite it — restore it
          useDeviceSyncJobStore.getState().cancel();
        } else {
          useDeviceSyncJobStore.getState().complete(payload.done, payload.skipped, payload.failed);
          showToast(
            t('deviceSync.syncResult', {
              done: payload.done, skipped: payload.skipped, total: payload.total
            }),
            5000, 'info'
          );
          // Write manifest so another machine can read the synced sources from the stick
          const { targetDir: dir, sources: srcs, filenameTemplate: tpl } = useDeviceSyncStore.getState();
          if (dir) invoke('write_device_manifest', { destDir: dir, sources: srcs, filenameTemplate: tpl }).catch(() => {});
        }
        // Re-scan the device after sync completes (cancelled or not)
        scanDevice();
      }
    });

    return () => {
      unlistenProgress.then(f => f());
      unlistenComplete.then(f => f());
    };
  }, [t, scanDevice]);

  // Load browser data when tab switches
  useEffect(() => {
    setSearch('');
    if (activeTab === 'playlists' && playlists.length === 0) loadPlaylists();
    if (activeTab === 'albums'    && randomAlbums.length === 0) loadRandomAlbums();
    if (activeTab === 'artists'   && artists.length === 0)   loadArtists();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  // Live album search with 300ms debounce
  useEffect(() => {
    if (activeTab !== 'albums') return;
    const q = search.trim();
    if (!q) { setAlbumSearchResults([]); return; }
    setAlbumSearchLoading(true);
    const timer = setTimeout(async () => {
      try {
        const { albums } = await searchSubsonic(q, { albumCount: 20, artistCount: 0, songCount: 0 });
        setAlbumSearchResults(albums);
      } catch {
        setAlbumSearchResults([]);
      } finally {
        setAlbumSearchLoading(false);
      }
    }, 300);
    return () => { clearTimeout(timer); setAlbumSearchLoading(false); };
  }, [search, activeTab]);

  const loadPlaylists = useCallback(async () => {
    setLoadingBrowser(true);
    try { setPlaylists(await getPlaylists()); } catch { /* ignore */ }
    finally { setLoadingBrowser(false); }
  }, []);
  const loadRandomAlbums = useCallback(async () => {
    setLoadingBrowser(true);
    try { setRandomAlbums(await getAlbumList('random', 10)); } catch { /* ignore */ }
    finally { setLoadingBrowser(false); }
  }, []);
  const loadArtists = useCallback(async () => {
    setLoadingBrowser(true);
    try { setArtists(await getArtists()); } catch { /* ignore */ }
    finally { setLoadingBrowser(false); }
  }, []);

  const toggleArtistExpand = useCallback(async (artistId: string) => {
    setExpandedArtistIds(prev => {
      const next = new Set(prev);
      if (next.has(artistId)) { next.delete(artistId); return next; }
      next.add(artistId);
      return next;
    });
    if (!artistAlbumsMap.has(artistId)) {
      setLoadingArtistIds(prev => new Set(prev).add(artistId));
      try {
        const { albums } = await getArtist(artistId);
        setArtistAlbumsMap(prev => new Map(prev).set(artistId, albums));
      } finally {
        setLoadingArtistIds(prev => { const n = new Set(prev); n.delete(artistId); return n; });
      }
    }
  }, [artistAlbumsMap]);

  const q                 = search.toLowerCase();
  const filteredPlaylists = useMemo(() => playlists.filter(p => p.name.toLowerCase().includes(q)), [playlists, q]);
  const filteredArtists   = useMemo(() => artists.filter(a => a.name.toLowerCase().includes(q)), [artists, q]);

  const handleChooseFolder = async () => {
    const sel = await openDialog({ directory: true, multiple: false, title: t('deviceSync.chooseFolder') });
    if (sel) {
      const dir = sel as string;
      setTargetDir(dir);
      // If the device has a psysonic-sync.json, always import it — replacing any
      // sources from a previous device so switching sticks works correctly.
      try {
        const manifest = await invoke<{ version: number; sources: DeviceSyncSource[]; filenameTemplate?: string } | null>(
          'read_device_manifest', { destDir: dir }
        );
        if (manifest?.sources?.length) {
          useDeviceSyncStore.getState().clearSources();
          manifest.sources.forEach(s => useDeviceSyncStore.getState().addSource(s));
          setDeviceManifestTemplate(manifest.filenameTemplate ?? null);
          showToast(t('deviceSync.manifestImported', { count: manifest.sources.length }), 4000, 'info');
        }
      } catch { /* no manifest, that's fine */ }
      // Trigger a device scan after folder change
      setTimeout(() => scanDevice(), 100);
    }
  };

  // ─── Sync (non-blocking) ────────────────────────────────────────────────

  const promptSyncSummary = async () => {
    if (!targetDir)          { showToast(t('deviceSync.noTargetDir'), 3000, 'error'); return; }
    if (sources.length === 0){ showToast(t('deviceSync.noSources'),   3000, 'error'); return; }

    setPreSyncLoading(true);
    setPreSyncOpen(true);

    try {
      const { getClient } = await import('../api/subsonic');
      const { baseUrl, params } = getClient();
      const payload = await invoke<{
        addBytes: number; addCount: number; delBytes: number; delCount: number; availableBytes: number; tracks: SubsonicSong[];
      }>('calculate_sync_payload', {
        sources,
        deletionIds: pendingDeletion,
        auth: { baseUrl, ...params },
        targetDir,
        template: filenameTemplate,
      });

      setSyncDelta(payload);
    } catch {
      showToast(t('deviceSync.fetchError'), 3000, 'error');
      setPreSyncOpen(false);
    } finally {
      setPreSyncLoading(false);
    }
  };

  const handleSyncExecution = async () => {
    setPreSyncOpen(false);

    // 1. Handle pending deletions first
    const deletionSources = sources.filter(s => pendingDeletion.includes(s.id));
    if (deletionSources.length > 0) {
      try {
        const allPaths: string[] = [];
        const trackArrays = await Promise.all(deletionSources.map(s => fetchTracksForSource(s)));
        const deletionTracks = trackArrays.flat();
        
        const paths = await invoke<string[]>('compute_sync_paths', {
          tracks: deletionTracks.map(t => trackToSyncInfo(t, '')),
          destDir: targetDir,
          template: filenameTemplate,
        });
        allPaths.push(...paths);
        
        await invoke<number>('delete_device_files', { paths: allPaths });
        removeSources(deletionSources.map(s => s.id));
        // Update manifest so it stays in sync after deletions
        const remainingSources = useDeviceSyncStore.getState().sources;
        if (targetDir) invoke('write_device_manifest', { destDir: targetDir, sources: remainingSources }).catch(() => {});
        showToast(
          t('deviceSync.deleteComplete', { count: deletionSources.length }),
          3000, 'info'
        );
      } catch {
        showToast(t('deviceSync.fetchError'), 3000, 'error');
      }
    }

    const allTracks = syncDelta.tracks;
    if (allTracks.length === 0) {
      scanDevice();
      return;
    }

    const jobId = uuid();
    useDeviceSyncJobStore.getState().startSync(jobId, allTracks.length);

    showToast(t('deviceSync.syncInBackground'), 3000, 'info');

    invoke('sync_batch_to_device', {
      tracks: allTracks.map(track => trackToSyncInfo(track, buildDownloadUrl(track.id))),
      destDir: targetDir,
      template: filenameTemplate,
      jobId,
      expectedBytes: syncDelta.addBytes,
    }).catch((err: string) => {
      useDeviceSyncJobStore.getState().complete(0, 0, allTracks.length);
      if (err.includes('NOT_ENOUGH_SPACE')) {
        showToast(t('deviceSync.notEnoughSpace'), 5000, 'error');
      } else if (err === 'NOT_MOUNTED_VOLUME') {
        showToast(t('deviceSync.notMountedVolume'), 5000, 'error');
      } else {
        showToast(t('deviceSync.fetchError'), 3000, 'error');
      }
    });
  };

  // ─── Actions ────────────────────────────────────────────────────────────

  const handleMarkCheckedForDeletion = () => {
    if (checkedIds.length === 0) return;
    markForDeletion(checkedIds);
  };

  const allChecked = sources.length > 0 && sources.every(s => checkedIds.includes(s.id));
  const toggleAll  = () => setCheckedIds(allChecked ? [] : sources.map(s => s.id));

  const pendingCount   = Array.from(sourceStatuses.values()).filter(s => s === 'pending').length;
  const syncedCount    = Array.from(sourceStatuses.values()).filter(s => s === 'synced').length;
  const deletionCount  = pendingDeletion.length;

  // ─── Dynamic action button label ────────────────────────────────────────
  const actionButtonLabel = useMemo(() => {
    if (deletionCount > 0 && pendingCount === 0) return t('deviceSync.actionDelete');
    if (pendingCount > 0 && deletionCount === 0) return t('deviceSync.actionTransfer');
    if (pendingCount > 0 && deletionCount > 0)  return t('deviceSync.actionApplyAll');
    return t('deviceSync.syncButton'); // both zero — button will be disabled
  }, [pendingCount, deletionCount, t]);

  const actionButtonDisabled =
    !targetDir ||
    sources.length === 0 ||
    isRunning ||
    (!driveDetected && !!targetDir) ||
    (pendingCount === 0 && deletionCount === 0);

  // ─── Template presets & token insertion ────────────────────────────────
  const TEMPLATE_PRESETS = useMemo(() => [
    { key: 'standard',  value: '{artist}/{album}/{track_number} - {title}',              label: t('deviceSync.templatePresetStandard') },
    { key: 'multidisc', value: '{artist}/{album}/{disc_number}-{track_number} - {title}', label: t('deviceSync.templatePresetMultiDisc') },
    { key: 'altfolder', value: '{artist} - {album}/{track_number} - {title}',             label: t('deviceSync.templatePresetAltFolder') },
  ], [t]);

  const TEMPLATE_TOKENS = ['{artist}', '{album}', '{title}', '{track_number}', '{disc_number}', '{year}', '/', '-'];

  const activePreset = TEMPLATE_PRESETS.find(p => p.value === filenameTemplate)?.key ?? null;

  const templateInputRef = useRef<HTMLInputElement>(null);
  const cursorPosRef = useRef<number>(filenameTemplate.length);

  const insertToken = useCallback((token: string) => {
    const input = templateInputRef.current;
    const pos = cursorPosRef.current;
    const next = filenameTemplate.slice(0, pos) + token + filenameTemplate.slice(pos);
    setFilenameTemplate(next);
    requestAnimationFrame(() => {
      if (!input) return;
      input.focus();
      const newPos = pos + token.length;
      input.setSelectionRange(newPos, newPos);
      cursorPosRef.current = newPos;
    });
  }, [filenameTemplate, setFilenameTemplate]);

  const trackCursor = useCallback((e: React.SyntheticEvent<HTMLInputElement>) => {
    cursorPosRef.current = (e.currentTarget.selectionStart ?? filenameTemplate.length);
  }, [filenameTemplate.length]);

  // ─── Template preview (dummy track) ─────────────────────────────────────
  const PREVIEW_TRACK = {
    artist: 'Artist Name',
    album: 'Album Title',
    title: 'Track Title',
    track_number: '01',
    disc_number: '1',
    year: '2024',
  } as const;

  const templatePreviewText = useMemo(() => {
    try {
      const result = filenameTemplate
        .replace(/\{artist\}/g,       PREVIEW_TRACK.artist)
        .replace(/\{album\}/g,        PREVIEW_TRACK.album)
        .replace(/\{title\}/g,        PREVIEW_TRACK.title)
        .replace(/\{track_number\}/g, PREVIEW_TRACK.track_number)
        .replace(/\{disc_number\}/g,  PREVIEW_TRACK.disc_number)
        .replace(/\{year\}/g,         PREVIEW_TRACK.year);
      return `${result}.mp3`;
    } catch {
      return '';
    }
  }, [filenameTemplate]);

  const tabs: { key: SourceTab; icon: React.ReactNode; label: string }[] = [
    { key: 'playlists', icon: <ListMusic size={14} />, label: t('deviceSync.tabPlaylists') },
    { key: 'albums',    icon: <Disc3 size={14} />,     label: t('deviceSync.tabAlbums') },
    { key: 'artists',   icon: <Users size={14} />,     label: t('deviceSync.tabArtists') },
  ];

  return (
    <div className="device-sync-page">

      {/* ── Header ── */}
      <div className="device-sync-header">
        <div className="device-sync-header-title">
          <HardDriveUpload size={20} />
          <h1>{t('deviceSync.title')}</h1>
        </div>

        <div className="device-sync-config-row">
          
          {/* ── Left: Template ── */}
          <div className="device-sync-template-section">
            <span className="device-sync-label-inline">{t('deviceSync.filenameTemplate')}</span>
            <div className="device-sync-template-presets">
              {TEMPLATE_PRESETS.map(p => (
                <button
                  key={p.key}
                  className={`device-sync-template-preset-btn${activePreset === p.key ? ' active' : ''}`}
                  onClick={() => setFilenameTemplate(p.value)}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div className="device-sync-template-input-wrap">
              <div className="device-sync-template-input-row">
                <input
                  ref={templateInputRef}
                  className="input device-sync-template-input"
                  value={filenameTemplate}
                  onChange={e => { setFilenameTemplate(e.target.value); trackCursor(e); }}
                  onSelect={trackCursor}
                  onKeyUp={trackCursor}
                  onClick={trackCursor}
                  spellCheck={false}
                />
                {filenameTemplate && (
                  <button
                    className="device-sync-template-clear"
                    onClick={() => { setFilenameTemplate(''); cursorPosRef.current = 0; templateInputRef.current?.focus(); }}
                    data-tooltip={t('common.clear')}
                    data-tooltip-pos="bottom"
                  >
                    <X size={13} />
                  </button>
                )}
              </div>
              <div className="device-sync-template-tokens">
                {TEMPLATE_TOKENS.map(tok => (
                  <button
                    key={tok}
                    className="device-sync-template-token"
                    onClick={() => insertToken(tok)}
                    data-tooltip={tok === '/' ? t('deviceSync.tokenSlashHint') : undefined}
                    data-tooltip-pos="bottom"
                  >
                    {tok}
                  </button>
                ))}
              </div>
              {templatePreviewText && (
                <span className="device-sync-template-preview">
                  {t('deviceSync.templatePreview')}: {templatePreviewText}
                </span>
              )}
            </div>
          </div>

          {/* ── Right: Drive config ── */}
          <div className="device-sync-target-section">
            <span className="device-sync-label-inline">{t('deviceSync.targetDevice')}</span>
            <div className="device-sync-header-config">
              <div className="device-sync-drive-layout">
                {/* Row 1: Controls */}
                <div className="device-sync-drive-controls">
                  {/* Fallback manual folder picker & Refresh */}
                  <button className="btn btn-ghost" onClick={handleChooseFolder} data-tooltip={t('deviceSync.browseManual')}>
                    <FolderOpen size={18} />
                  </button>
                  <button
                    className="btn btn-ghost device-sync-refresh-btn"
                    onClick={refreshDrives}
                    disabled={drivesLoading}
                    data-tooltip={t('deviceSync.refreshDrives')}
                  >
                    <RefreshCw size={18} className={drivesLoading ? 'spin' : ''} />
                  </button>

                  {/* Dropdown element */}
                  {drives.length > 0 ? (
                    <>
                      <Usb size={18} className="device-sync-drive-icon" />
                      <CustomSelect
                        className="input device-sync-drive-select"
                        value={targetDir ?? ''}
                        onChange={v => {
                          setTargetDir(v);
                          if (v) {
                            setTimeout(() => scanDevice(), 100);
                          }
                        }}
                        options={[
                          { value: '', label: t('deviceSync.selectDrive') },
                          ...drives.map(d => ({ value: d.mount_point, label: d.name || d.mount_point }))
                        ]}
                      />
                    </>
                  ) : (
                    <span className="device-sync-no-drives">
                      <AlertCircle size={18} />
                      {t('deviceSync.noDrivesDetected')}
                    </span>
                  )}
                </div>

              {/* Row 2: Metadata */}
              {activeDrive && (
                <div className="device-sync-drive-meta">
                  {formatBytes(activeDrive.available_space)} {t('deviceSync.free')} / {formatBytes(activeDrive.total_space)} &bull; {activeDrive.file_system}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>



      {/* ── Main ── */}
      <div className="device-sync-main">

        {/* ── Browser (left) ── */}
        <div className="device-sync-browser">
            <div className="device-sync-tabs">
              {tabs.map(tab => (
                <button
                  key={tab.key}
                  className={`device-sync-tab${activeTab === tab.key ? ' active' : ''}`}
                  onClick={() => setActiveTab(tab.key)}
                >
                  {tab.icon}{tab.label}
                </button>
              ))}
            </div>
            <div className="device-sync-search-wrap">
              <input
                className="input"
                placeholder={t('deviceSync.searchPlaceholder')}
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
              {activeTab === 'albums' && (
                <span className="device-sync-live-badge">
                  <Zap size={10} />{t('deviceSync.liveSearch')}
                </span>
              )}
            </div>
            <div className="device-sync-list">
              {(loadingBrowser || albumSearchLoading) && (
                <div className="device-sync-loading"><Loader2 size={16} className="spin" /></div>
              )}
              {activeTab === 'albums' && !search.trim() && !loadingBrowser && randomAlbums.length > 0 && (
                <div className="device-sync-section-label">
                  <Shuffle size={11} />{t('deviceSync.randomAlbumsLabel')}
                </div>
              )}
              {activeTab === 'playlists' && filteredPlaylists.map(pl => (
                <BrowserRow key={pl.id} name={pl.name} meta={`${pl.songCount} tracks`}
                  selected={sources.some(s => s.id === pl.id) && !pendingDeletion.includes(pl.id)}
                  onToggle={() => handleToggleSource({ type: 'playlist', id: pl.id, name: pl.name })} />
              ))}
              {activeTab === 'albums' && (search.trim() ? albumSearchResults : randomAlbums).map(al => (
                <BrowserRow key={al.id} name={al.name} meta={al.artist}
                  selected={sources.some(s => s.id === al.id) && !pendingDeletion.includes(al.id)}
                  onToggle={() => handleToggleSource({ type: 'album', id: al.id, name: al.name })} />
              ))}
              {activeTab === 'artists' && filteredArtists.map(ar => (
                <React.Fragment key={ar.id}>
                  <div className="device-sync-artist-row">
                    <button
                      className="device-sync-expand-btn"
                      onClick={() => toggleArtistExpand(ar.id)}
                    >
                      {loadingArtistIds.has(ar.id)
                        ? <Loader2 size={13} className="spin" />
                        : expandedArtistIds.has(ar.id)
                          ? <ChevronDown size={13} />
                          : <ChevronRight size={13} />}
                    </button>
                    <span className="device-sync-row-name">{ar.name}</span>
                    {ar.albumCount != null &&
                      <span className="device-sync-row-meta">{ar.albumCount} Albums</span>}
                  </div>
                  {expandedArtistIds.has(ar.id) && artistAlbumsMap.has(ar.id) &&
                    artistAlbumsMap.get(ar.id)!.map(al => (
                      <BrowserRow key={al.id} name={al.name} meta={al.year?.toString()}
                        selected={sources.some(s => s.id === al.id) && !pendingDeletion.includes(al.id)}
                        indent
                        onToggle={() => handleToggleSource({ type: 'album', id: al.id, name: al.name })} />
                    ))
                  }
                </React.Fragment>
              ))}
            </div>
          </div>

        {/* ── Device Manager (right) ── */}
        <div className="device-sync-device-panel">
          <div className="device-sync-panel-header">
            <span className="device-sync-panel-title">
              {t('deviceSync.onDevice')}
              {scanning && <Loader2 size={12} className="spin" style={{ marginLeft: 6 }} />}
            </span>
            <div className="device-sync-panel-actions">
              {/* Sync button */}
              <button
                className="btn btn-surface"
                onClick={promptSyncSummary}
                disabled={actionButtonDisabled}
              >
                {isRunning
                  ? <><Loader2 size={13} className="spin" /> {jobDone + jobSkip + jobFail}/{jobTotal}</>
                  : <>
                      {deletionCount > 0 && pendingCount === 0
                        ? <Trash2 size={13} />
                        : <HardDriveUpload size={13} />}
                      {actionButtonLabel}
                    </>
                }
              </button>

              {/* Mark for deletion */}
              {checkedIds.length > 0 && !isRunning && (
                <button
                  className="btn btn-danger"
                  onClick={handleMarkCheckedForDeletion}
                >
                  <Trash2 size={13} />
                  {t('deviceSync.deleteFromDevice', { count: checkedIds.length })}
                </button>
              )}
            </div>
          </div>

          {/* Status summary badges */}
          {sources.length > 0 && driveDetected && (
            <div className="device-sync-status-summary">
              {syncedCount > 0 && (
                <span className="device-sync-badge synced">
                  <CheckCircle2 size={11} /> {syncedCount} {t('deviceSync.statusSynced')}
                </span>
              )}
              {pendingCount > 0 && (
                <span className="device-sync-badge pending">
                  <Clock size={11} /> {pendingCount} {t('deviceSync.statusPending')}
                </span>
              )}
              {deletionCount > 0 && (
                <span className="device-sync-badge deletion">
                  <Trash2 size={11} /> {deletionCount} {t('deviceSync.statusDeletion')}
                </span>
              )}
            </div>
          )}

          {sources.length === 0 || !driveDetected ? (
            <p className="device-sync-empty">{t('deviceSync.noSourcesSelected')}</p>
          ) : (
            <>
              <div className="device-sync-list-header">
                <label className="device-sync-check-label">
                  <input type="checkbox" checked={allChecked} onChange={toggleAll} />
                </label>
                <span className="device-sync-list-col-name">{t('deviceSync.colName')}</span>
                <span className="device-sync-list-col-type">{t('deviceSync.colType')}</span>
                <span className="device-sync-list-col-status">{t('deviceSync.colStatus')}</span>
                <span className="device-sync-list-col-actions" />
              </div>
              <div className="device-sync-device-list">
                {sources.map(s => {
                  const status = sourceStatuses.get(s.id) ?? 'pending';
                  return (
                    <label
                      key={s.id}
                      className={`device-sync-device-row ${status}${checkedIds.includes(s.id) ? ' checked' : ''}`}
                    >
                      <input
                        type="checkbox"
                        checked={checkedIds.includes(s.id)}
                        onChange={() => toggleChecked(s.id)}
                        disabled={status === 'deletion'}
                      />
                      <span className="device-sync-row-name">{s.name}</span>
                      <span className="device-sync-source-type">{s.type}</span>
                      <span className={`device-sync-status-icon ${status}`}>
                        {status === 'synced'   && <CheckCircle2 size={13} />}
                        {status === 'pending'  && <Clock size={13} />}
                        {status === 'deletion' && <Trash2 size={13} />}
                      </span>
                      <span className="device-sync-row-actions">
                        {status === 'synced' && (
                          <button
                            className="device-sync-action-btn danger"
                            onClick={e => { e.preventDefault(); markForDeletion([s.id]); }}
                            data-tooltip={t('deviceSync.markForDeletion')}
                          >
                            <Trash2 size={12} />
                          </button>
                        )}
                        {status === 'pending' && (
                          <button
                            className="device-sync-action-btn muted"
                            onClick={e => { e.preventDefault(); handleToggleSource(s); }}
                            data-tooltip={t('deviceSync.removeSource')}
                          >
                            <Trash2 size={12} />
                          </button>
                        )}
                        {status === 'deletion' && (
                          <button
                            className="device-sync-action-btn undo"
                            onClick={e => { e.preventDefault(); unmarkDeletion(s.id); }}
                            data-tooltip={t('deviceSync.undoDeletion')}
                          >
                            <Undo2 size={12} />
                          </button>
                        )}
                      </span>
                    </label>
                  );
                })}
              </div>
            </>
          )}

          {/* Background sync progress (non-blocking) */}
          {jobStatus === 'running' && (
            <div className="device-sync-bg-progress">
              <div className="device-sync-bg-progress-bar-wrap">
                <div
                  className="device-sync-bg-progress-bar"
                  style={{ width: jobTotal > 0
                    ? `${((jobDone + jobSkip + jobFail) / jobTotal) * 100}%`
                    : '0%' }}
                />
              </div>
              <span className="device-sync-bg-progress-text">
                <Loader2 size={12} className="spin" />
                {t('deviceSync.syncInProgress', { done: jobDone + jobSkip, total: jobTotal })}
                {jobFail > 0 && <span className="device-sync-stat-error"><AlertCircle size={11} /> {jobFail}</span>}
              </span>
              <button
                className="btn btn-ghost"
                style={{ fontSize: 12, padding: '2px 10px' }}
                onClick={() => {
                  const jobId = useDeviceSyncJobStore.getState().jobId;
                  if (jobId) invoke('cancel_device_sync', { jobId });
                  useDeviceSyncJobStore.getState().cancel();
                }}
              >
                {t('deviceSync.cancelSync')}
              </button>
            </div>
          )}

          {jobStatus === 'cancelled' && (
            <div className="device-sync-bg-progress done">
              <span className="device-sync-bg-progress-text">
                <AlertCircle size={12} style={{ color: 'var(--text-muted)' }} />
                {t('deviceSync.syncCancelled', { done: jobDone, total: jobTotal })}
              </span>
              <button className="btn btn-ghost" onClick={() => useDeviceSyncJobStore.getState().reset()}>
                {t('deviceSync.dismiss')}
              </button>
            </div>
          )}

          {jobStatus === 'done' && (
            <div className="device-sync-bg-progress done">
              <span className="device-sync-bg-progress-text">
                <CheckCircle2 size={12} className="color-success" />
                {t('deviceSync.syncResult', { done: jobDone, skipped: jobSkip, total: jobTotal })}
              </span>
              <button className="btn btn-ghost" onClick={() => useDeviceSyncJobStore.getState().reset()}>
                {t('deviceSync.dismiss')}
              </button>
            </div>
          )}

        </div>

      </div>

      {/* Pre-Sync Summary Modal */}
      {preSyncOpen && (
        <div className="modal-overlay">
          <div className="modal-content device-sync-modal">
            <h2 className="modal-title">{t('deviceSync.syncSummary')}</h2>

            {preSyncLoading ? (
              <div className="device-sync-loading-modal" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', margin: '20px' }}>
                <Loader2 size={32} className="spin" />
                <p style={{ marginTop: '10px' }}>{t('deviceSync.calculating')}</p>
              </div>
            ) : (
              <div className="device-sync-summary-stats" style={{ display: 'flex', flexDirection: 'column', gap: '8px', margin: '10px 0' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
                  <span>{t('deviceSync.filesToAdd')}</span>
                  <span className="color-success">+{syncDelta.addCount} ({(syncDelta.addBytes / 1_048_576).toFixed(1)} MB)</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
                  <span>{t('deviceSync.filesToDelete')}</span>
                  <span className="color-error">-{syncDelta.delCount} ({(syncDelta.delBytes / 1_048_576).toFixed(1)} MB)</span>
                </div>
                <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '10px 0' }} />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold' }}>
                  <span>{t('deviceSync.netChange')}</span>
                  <span>{((syncDelta.addBytes - syncDelta.delBytes) / 1_048_576).toFixed(1)} MB</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold', color: syncDelta.addBytes > syncDelta.availableBytes + syncDelta.delBytes ? 'var(--danger)' : 'inherit', marginTop: '10px' }}>
                  <span>{t('deviceSync.availableSpace')}</span>
                  <span>{(syncDelta.availableBytes / 1_048_576).toFixed(1)} MB</span>
                </div>
                {syncDelta.addBytes > syncDelta.availableBytes + syncDelta.delBytes && (
                  <div className="sync-warning error" style={{ background: 'color-mix(in srgb, var(--danger) 15%, transparent)', padding: '10px', borderRadius: 'var(--radius-md)', marginTop: '15px', display: 'flex', gap: '10px', color: 'var(--danger)', alignItems: 'flex-start' }}>
                    <AlertCircle size={16} style={{ flexShrink: 0, marginTop: '2px' }} />
                    <span>{t('deviceSync.spaceWarning')}</span>
                  </div>
                )}
              </div>
            )}

            {!preSyncLoading && (
              <div className="modal-actions" style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '25px' }}>
                <button className="btn btn-ghost" onClick={() => setPreSyncOpen(false)}>
                  {t('deviceSync.cancel')}
                </button>
                <button
                  className="btn btn-primary"
                  onClick={handleSyncExecution}
                  disabled={syncDelta.addBytes > syncDelta.availableBytes + syncDelta.delBytes}
                >
                  {t('deviceSync.proceed')}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── BrowserRow ──────────────────────────────────────────────────────────────

function BrowserRow({ name, meta, selected, onToggle, indent }: {
  name: string; meta?: string; selected: boolean; onToggle: () => void; indent?: boolean;
}) {
  return (
    <button className={`device-sync-browser-row${selected ? ' selected' : ''}${indent ? ' indent' : ''}`} onClick={onToggle}>
      <span className="device-sync-row-check">
        {selected ? <CheckCircle2 size={14} /> : <span className="device-sync-row-circle" />}
      </span>
      <span className="device-sync-row-name">{name}</span>
      {meta && <span className="device-sync-row-meta">{meta}</span>}
    </button>
  );
}
