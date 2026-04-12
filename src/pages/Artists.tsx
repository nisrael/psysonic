import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { getArtists, SubsonicArtist, buildCoverArtUrl, coverArtCacheKey } from '../api/subsonic';
import { LayoutGrid, List, Images, CheckSquare2, ListMusic, Check } from 'lucide-react';
import { usePlayerStore } from '../store/playerStore';
import { useAuthStore } from '../store/authStore';
import CachedImage from '../components/CachedImage';
import { useTranslation } from 'react-i18next';

const ALL_SENTINEL = 'ALL';
const ALPHABET = [ALL_SENTINEL, '#', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')];

// Catppuccin accent colors — one is picked deterministically from the artist name
const CTP_COLORS = [
  'var(--ctp-rosewater)', 'var(--ctp-flamingo)', 'var(--ctp-pink)',    'var(--ctp-mauve)',
  'var(--ctp-red)',       'var(--ctp-maroon)',    'var(--ctp-peach)',   'var(--ctp-yellow)',
  'var(--ctp-green)',     'var(--ctp-teal)',      'var(--ctp-sky)',     'var(--ctp-sapphire)',
  'var(--ctp-blue)',      'var(--ctp-lavender)',
];

function nameColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return CTP_COLORS[h % CTP_COLORS.length];
}

function nameInitial(name: string): string {
  // \p{L} matches any Unicode letter — covers cyrillic, arabic, CJK, etc.
  const letter = name.match(/\p{L}/u)?.[0];
  if (letter) return letter.toUpperCase();
  const alnum = name.match(/[0-9]/)?.[0];
  return alnum ?? '?';
}

function ArtistCardAvatar({ artist, showImages }: { artist: SubsonicArtist; showImages: boolean }) {
  const color = nameColor(artist.name);
  if (showImages && artist.coverArt) {
    return (
      <div className="artist-card-avatar">
        <CachedImage
          src={buildCoverArtUrl(artist.coverArt, 300)}
          cacheKey={coverArtCacheKey(artist.coverArt, 300)}
          alt={artist.name}
        />
      </div>
    );
  }
  return (
    <div className="artist-card-avatar artist-card-avatar-initial" style={{ borderColor: color }}>
      <span style={{ color }}>{nameInitial(artist.name)}</span>
    </div>
  );
}

function ArtistRowAvatar({ artist, showImages }: { artist: SubsonicArtist; showImages: boolean }) {
  const color = nameColor(artist.name);
  if (showImages && artist.coverArt) {
    return (
      <div className="artist-avatar">
        <CachedImage
          src={buildCoverArtUrl(artist.coverArt, 64)}
          cacheKey={coverArtCacheKey(artist.coverArt, 64)}
          alt={artist.name}
          style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }}
        />
      </div>
    );
  }
  return (
    <div className="artist-avatar artist-avatar-initial" style={{ borderColor: color }}>
      <span style={{ color }}>{nameInitial(artist.name)}</span>
    </div>
  );
}

export default function Artists() {
  const { t } = useTranslation();
  const [artists, setArtists] = useState<SubsonicArtist[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [letterFilter, setLetterFilter] = useState(ALL_SENTINEL);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

  const showArtistImages = useAuthStore(s => s.showArtistImages);
  const PAGE_SIZE = showArtistImages ? 50 : 100; // Menor con imágenes para reducir I/O
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [loadingMore, setLoadingMore] = useState(false);
  const observerTarget = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const openContextMenu = usePlayerStore(state => state.openContextMenu);
  const setShowArtistImages = useAuthStore(s => s.setShowArtistImages);
  const musicLibraryFilterVersion = useAuthStore(s => s.musicLibraryFilterVersion);

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

  const selectedArtists = artists.filter(a => selectedIds.has(a.id));

  useEffect(() => {
    getArtists().then(data => { setArtists(data); setLoading(false); }).catch(() => setLoading(false));
  }, [musicLibraryFilterVersion]);

  const loadMore = useCallback(() => {
    if (loadingMore) return;
    setLoadingMore(true);
    setVisibleCount(prev => prev + PAGE_SIZE);
    setTimeout(() => setLoadingMore(false), 100);
  }, [loadingMore, PAGE_SIZE]);

  // Reset infinite scroll when filters or image setting change
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [filter, letterFilter, viewMode, PAGE_SIZE]);

  // Filter pipeline
  let filtered = artists;

  if (letterFilter !== ALL_SENTINEL) {
    filtered = filtered.filter(a => {
      const first = a.name[0]?.toUpperCase() ?? '#';
      const isAlpha = /^[A-Z]$/.test(first);
      if (letterFilter === '#') return !isAlpha;
      return first === letterFilter;
    });
  }

  if (filter) {
    filtered = filtered.filter(a => a.name.toLowerCase().includes(filter.toLowerCase()));
  }

  const visible = filtered.slice(0, visibleCount);
  const hasMore = visibleCount < filtered.length;

  // Intersection Observer for infinite scroll (after hasMore declaration)
  useEffect(() => {
    const observer = new IntersectionObserver(
      entries => { if (entries[0].isIntersecting) loadMore(); },
      { rootMargin: '200px' }
    );
    if (observerTarget.current) observer.observe(observerTarget.current);
    return () => observer.disconnect();
  }, [loadMore, hasMore]);

  // Group by first letter (for list view)
  const groups: Record<string, SubsonicArtist[]> = {};
  visible.forEach(a => {
    const letter = a.name[0]?.toUpperCase() ?? '#';
    const key = /^[A-Z]$/.test(letter) ? letter : '#';
    if (!groups[key]) groups[key] = [];
    groups[key].push(a);
  });
  const letters = Object.keys(groups).sort();

  return (
    <div className="content-body animate-fade-in">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <h1 className="page-title" style={{ marginBottom: 0 }}>
            {selectionMode && selectedIds.size > 0
              ? t('artists.selectionCount', { count: selectedIds.size })
              : t('artists.title')}
          </h1>
          <input
            className="input"
            style={{ maxWidth: 220 }}
            placeholder={t('artists.search')}
            value={filter}
            onChange={e => setFilter(e.target.value)}
            id="artist-filter-input"
          />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {!(selectionMode && selectedIds.size > 0) && (<>
              <button
                className={`btn btn-surface`}
                onClick={() => setShowArtistImages(!showArtistImages)}
                style={showArtistImages ? { background: 'var(--accent)', color: 'var(--ctp-crust)', padding: '0.5rem' } : { padding: '0.5rem' }}
                data-tooltip={showArtistImages ? t('artists.imagesOn') : t('artists.imagesOff')}
                data-tooltip-wrap
              >
                <Images size={20} />
              </button>
              <button
                className={`btn btn-surface ${viewMode === 'grid' ? 'btn-sort-active' : ''}`}
                onClick={() => setViewMode('grid')}
                style={viewMode === 'grid' ? { background: 'var(--accent)', color: 'var(--ctp-crust)', padding: '0.5rem' } : { padding: '0.5rem' }}
                data-tooltip={t('artists.gridView')}
              >
                <LayoutGrid size={20} />
              </button>
              <button
                className={`btn btn-surface ${viewMode === 'list' ? 'btn-sort-active' : ''}`}
                onClick={() => setViewMode('list')}
                style={viewMode === 'list' ? { background: 'var(--accent)', color: 'var(--ctp-crust)', padding: '0.5rem' } : { padding: '0.5rem' }}
                data-tooltip={t('artists.listView')}
              >
                <List size={20} />
              </button>
            </>
          )}
          <button
            className={`btn btn-surface${selectionMode ? ' btn-sort-active' : ''}`}
            onClick={toggleSelectionMode}
            data-tooltip={selectionMode ? t('artists.cancelSelect') : t('artists.startSelect')}
            data-tooltip-pos="bottom"
            style={selectionMode ? { background: 'var(--accent)', color: 'var(--ctp-crust)' } : {}}
          >
            <CheckSquare2 size={15} />
            {selectionMode ? t('artists.cancelSelect') : t('artists.select')}
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem', marginBottom: '2rem' }}>
        {ALPHABET.map(l => (
          <button
            key={l}
            onClick={() => setLetterFilter(l)}
            className={`artists-alpha-btn${letterFilter === l ? ' artists-alpha-btn--active' : ''}`}
          >
            {l === ALL_SENTINEL ? t('artists.all') : l}
          </button>
        ))}
      </div>

      {loading && <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}><div className="spinner" /></div>}

      {!loading && viewMode === 'grid' && (
        <div className="album-grid-wrap">
          {visible.map(artist => (
            <div
              key={artist.id}
              className={`artist-card${selectionMode && selectedIds.has(artist.id) ? ' selected' : ''}${selectionMode ? ' artist-card--selectable' : ''}`}
              onClick={() => {
                if (selectionMode) {
                  toggleSelect(artist.id);
                } else {
                  navigate(`/artist/${artist.id}`);
                }
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                if (selectionMode && selectedIds.size > 0) {
                  openContextMenu(e.clientX, e.clientY, selectedArtists, 'multi-artist');
                } else {
                  openContextMenu(e.clientX, e.clientY, artist, 'artist');
                }
              }}
              style={selectionMode && selectedIds.has(artist.id) ? {
                outline: '2px solid var(--accent)',
                outlineOffset: '2px',
                borderRadius: 'var(--radius-md)'
              } : {}}
            >
              {selectionMode && (
                <div className={`artist-card-select-check${selectedIds.has(artist.id) ? ' artist-card-select-check--on' : ''}`}>
                  {selectedIds.has(artist.id) && <Check size={14} strokeWidth={3} />}
                </div>
              )}
              <ArtistCardAvatar artist={artist} showImages={showArtistImages} />
              <div style={{ textAlign: 'center' }}>
                <div className="artist-card-name">{artist.name}</div>
                {artist.albumCount != null && (
                  <div className="artist-card-meta">{t('artists.albumCount', { count: artist.albumCount })}</div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && viewMode === 'list' && (
        <>
          {letters.map(letter => (
            <div key={letter} style={{ marginBottom: '1.5rem' }}>
              <h3 className="letter-heading">{letter}</h3>
              <div className="artist-list">
                {groups[letter].map(artist => (
                  <button
                    key={artist.id}
                    className={`artist-row${selectionMode && selectedIds.has(artist.id) ? ' selected' : ''}`}
                    onClick={() => {
                      if (selectionMode) {
                        toggleSelect(artist.id);
                      } else {
                        navigate(`/artist/${artist.id}`);
                      }
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      if (selectionMode && selectedIds.size > 0) {
                        openContextMenu(e.clientX, e.clientY, selectedArtists, 'multi-artist');
                      } else {
                        openContextMenu(e.clientX, e.clientY, artist, 'artist');
                      }
                    }}
                    id={`artist-${artist.id}`}
                    style={selectionMode && selectedIds.has(artist.id) ? {
                      background: 'var(--accent-dim)',
                      color: 'var(--accent)'
                    } : {}}
                  >
                    <ArtistRowAvatar artist={artist} showImages={showArtistImages} />
                    <div style={{ textAlign: 'left' }}>
                      <div className="artist-name">{artist.name}</div>
                      {artist.albumCount != null && (
                        <div className="artist-meta">{t('artists.albumCount', { count: artist.albumCount })}</div>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </>
      )}

      {!loading && hasMore && (
        <div ref={observerTarget} style={{ height: '20px', margin: '2rem 0', display: 'flex', justifyContent: 'center' }}>
          {loadingMore && <div className="spinner" style={{ width: 20, height: 20 }} />}
        </div>
      )}

      {!loading && filtered.length === 0 && (
        <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
          {t('artists.notFound')}
        </div>
      )}
    </div>
  );
}
