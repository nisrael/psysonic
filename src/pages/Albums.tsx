import React, { useEffect, useState, useCallback, useRef } from 'react';
import AlbumCard from '../components/AlbumCard';
import GenreFilterBar from '../components/GenreFilterBar';
import { getAlbumList, getAlbumsByGenre, getAlbum, SubsonicAlbum, buildDownloadUrl } from '../api/subsonic';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../store/authStore';
import { useOfflineStore } from '../store/offlineStore';
import { useDownloadModalStore } from '../store/downloadModalStore';
import { writeFile } from '@tauri-apps/plugin-fs';
import { join } from '@tauri-apps/api/path';
import { showToast } from '../utils/toast';
import { X, CheckSquare2, Download, HardDriveDownload } from 'lucide-react';

type SortType = 'alphabeticalByName' | 'alphabeticalByArtist';

const PAGE_SIZE = 30;
const CURRENT_YEAR = new Date().getFullYear();

function sanitizeFilename(name: string): string {
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim() || 'download';
}

async function fetchByGenres(genres: string[]): Promise<SubsonicAlbum[]> {
  const results = await Promise.all(genres.map(g => getAlbumsByGenre(g, 500, 0)));
  const seen = new Set<string>();
  return results.flat().filter(a => { if (seen.has(a.id)) return false; seen.add(a.id); return true; });
}

export default function Albums() {
  const { t } = useTranslation();
  const musicLibraryFilterVersion = useAuthStore(s => s.musicLibraryFilterVersion);
  const auth = useAuthStore();
  const serverId = useAuthStore(s => s.activeServerId ?? '');
  const { downloadAlbum } = useOfflineStore();
  const requestDownloadFolder = useDownloadModalStore(s => s.requestFolder);

  const [albums, setAlbums] = useState<SubsonicAlbum[]>([]);
  const [sort, setSort] = useState<SortType>('alphabeticalByName');
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [selectedGenres, setSelectedGenres] = useState<string[]>([]);
  const [yearFrom, setYearFrom] = useState('');
  const [yearTo, setYearTo] = useState('');
  const observerTarget = useRef<HTMLDivElement>(null);

  // ── Multi-selection ──────────────────────────────────────────────────────
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const toggleSelectionMode = () => {
    setSelectionMode(v => !v);
    setSelectedIds(new Set());
  };

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const clearSelection = () => {
    setSelectionMode(false);
    setSelectedIds(new Set());
  };

  const selectedAlbums = albums.filter(a => selectedIds.has(a.id));

  const handleDownloadZips = async () => {
    if (selectedAlbums.length === 0) return;
    const folder = auth.downloadFolder || await requestDownloadFolder();
    if (!folder) return;

    let done = 0;
    for (const album of selectedAlbums) {
      showToast(t('albums.downloadingZip', { current: done + 1, total: selectedAlbums.length, name: album.name }), 8000, 'info');
      try {
        const url = buildDownloadUrl(album.id);
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const blob = await response.blob();
        const buffer = await blob.arrayBuffer();
        const path = await join(folder, `${sanitizeFilename(album.name)}.zip`);
        await writeFile(path, new Uint8Array(buffer));
        done++;
      } catch (e) {
        console.error('ZIP download failed for', album.name, e);
        showToast(t('albums.downloadZipFailed', { name: album.name }), 4000, 'error');
      }
    }
    showToast(t('albums.downloadZipDone', { count: done }), 4000, 'info');
    clearSelection();
  };

  const handleAddOffline = async () => {
    if (selectedAlbums.length === 0) return;
    let queued = 0;
    for (const album of selectedAlbums) {
      try {
        const detail = await getAlbum(album.id);
        downloadAlbum(album.id, album.name, album.artist, album.coverArt, album.year, detail.songs, serverId);
        queued++;
      } catch {
        showToast(t('albums.offlineFailed', { name: album.name }), 3000, 'error');
      }
    }
    if (queued > 0) showToast(t('albums.offlineQueuing', { count: queued }), 3000, 'info');
    clearSelection();
  };

  // ── Data loading ─────────────────────────────────────────────────────────
  const genreFiltered = selectedGenres.length > 0;
  const fromNum = parseInt(yearFrom, 10);
  const toNum = parseInt(yearTo, 10);
  const yearActive = !isNaN(fromNum) && !isNaN(toNum) && fromNum >= 1 && toNum >= 1;

  const load = useCallback(async (
    sortType: SortType,
    offset: number,
    append = false,
    yearFilter?: { from: number; to: number },
  ) => {
    setLoading(true);
    try {
      const extra = yearFilter ? { fromYear: yearFilter.from, toYear: yearFilter.to } : {};
      const type = yearFilter ? 'byYear' : sortType;
      const data = await getAlbumList(type, PAGE_SIZE, offset, extra);
      if (append) setAlbums(prev => [...prev, ...data]);
      else setAlbums(data);
      setHasMore(data.length === PAGE_SIZE);
    } finally {
      setLoading(false);
    }
  }, [musicLibraryFilterVersion]);

  const loadFiltered = useCallback(async (genres: string[], sortType: SortType) => {
    setLoading(true);
    try {
      const data = await fetchByGenres(genres);
      const sorted = [...data].sort((a, b) =>
        sortType === 'alphabeticalByArtist'
          ? a.artist.localeCompare(b.artist)
          : a.name.localeCompare(b.name)
      );
      setAlbums(sorted);
      setHasMore(false);
    } finally {
      setLoading(false);
    }
  }, [musicLibraryFilterVersion]);

  useEffect(() => {
    setPage(0);
    if (genreFiltered) {
      loadFiltered(selectedGenres, sort);
    } else if (yearActive) {
      load(sort, 0, false, { from: fromNum, to: toNum });
    } else {
      load(sort, 0);
    }
  }, [sort, genreFiltered, selectedGenres, yearActive, fromNum, toNum, load, loadFiltered]);

  const loadMore = useCallback(() => {
    if (loading || !hasMore || genreFiltered) return;
    const next = page + 1;
    setPage(next);
    const yf = yearActive ? { from: fromNum, to: toNum } : undefined;
    load(sort, next * PAGE_SIZE, true, yf);
  }, [loading, hasMore, page, sort, load, genreFiltered, yearActive, fromNum, toNum]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      entries => { if (entries[0].isIntersecting) loadMore(); },
      { rootMargin: '200px' }
    );
    if (observerTarget.current) observer.observe(observerTarget.current);
    return () => observer.disconnect();
  }, [loadMore]);

  const clearYear = () => { setYearFrom(''); setYearTo(''); };

  const sortOptions: { value: SortType; label: string }[] = [
    { value: 'alphabeticalByName',   label: t('albums.sortByName') },
    { value: 'alphabeticalByArtist', label: t('albums.sortByArtist') },
  ];

  return (
    <div className="content-body animate-fade-in">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '0.75rem' }}>
        <h1 className="page-title" style={{ marginBottom: 0 }}>
          {selectionMode && selectedIds.size > 0
            ? t('albums.selectionCount', { count: selectedIds.size })
            : t('albums.title')}
        </h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
          {selectionMode && selectedIds.size > 0 ? (
            <>
              <button className="btn btn-surface albums-selection-action-btn" onClick={handleAddOffline}>
                <HardDriveDownload size={15} />
                {t('albums.addOffline')}
              </button>
              <button className="btn btn-surface albums-selection-action-btn" onClick={handleDownloadZips}>
                <Download size={15} />
                {t('albums.downloadZips')}
              </button>
            </>
          ) : (
            <>
              {!yearActive && sortOptions.map(o => (
                <button
                  key={o.value}
                  className={`btn btn-surface ${sort === o.value ? 'btn-sort-active' : ''}`}
                  onClick={() => setSort(o.value)}
                  style={sort === o.value ? { background: 'var(--accent)', color: 'var(--ctp-crust)' } : {}}
                >
                  {o.label}
                </button>
              ))}

              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                  {t('albums.yearFilterLabel')}
                </span>
                <input
                  className="input"
                  type="number"
                  min={1900}
                  max={CURRENT_YEAR}
                  placeholder={t('albums.yearFrom')}
                  value={yearFrom}
                  onChange={e => setYearFrom(e.target.value)}
                  style={{ width: 68, padding: '4px 6px', fontSize: 12 }}
                />
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>–</span>
                <input
                  className="input"
                  type="number"
                  min={1900}
                  max={CURRENT_YEAR}
                  placeholder={t('albums.yearTo')}
                  value={yearTo}
                  onChange={e => setYearTo(e.target.value)}
                  style={{ width: 68, padding: '4px 6px', fontSize: 12 }}
                />
                {yearActive && (
                  <button
                    className="btn btn-ghost"
                    onClick={clearYear}
                    data-tooltip={t('albums.yearFilterClear')}
                    style={{ padding: '4px 6px' }}
                  >
                    <X size={13} />
                  </button>
                )}
              </div>

              <GenreFilterBar selected={selectedGenres} onSelectionChange={setSelectedGenres} />
            </>
          )}

          <button
            className={`btn btn-surface${selectionMode ? ' btn-sort-active' : ''}`}
            onClick={toggleSelectionMode}
            data-tooltip={selectionMode ? t('albums.cancelSelect') : t('albums.startSelect')}
            data-tooltip-pos="bottom"
            style={selectionMode ? { background: 'var(--accent)', color: 'var(--ctp-crust)' } : {}}
          >
            <CheckSquare2 size={15} />
            {selectionMode ? t('albums.cancelSelect') : t('albums.select')}
          </button>
        </div>
      </div>

      {loading && albums.length === 0 ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}>
          <div className="spinner" />
        </div>
      ) : (
        <>
          <div className="album-grid-wrap">
            {albums.map(a => (
              <AlbumCard
                key={a.id}
                album={a}
                selectionMode={selectionMode}
                selected={selectedIds.has(a.id)}
                onToggleSelect={toggleSelect}
              />
            ))}
          </div>
          {!genreFiltered && (
            <div ref={observerTarget} style={{ height: '20px', margin: '2rem 0', display: 'flex', justifyContent: 'center' }}>
              {loading && hasMore && <div className="spinner" style={{ width: 20, height: 20 }} />}
            </div>
          )}
        </>
      )}

    </div>
  );
}
