import React, { useEffect, useState, useMemo } from 'react';
import { SubsonicPlaylist, getPlaylists, getPlaylist, deletePlaylist } from '../api/subsonic';
import { usePlayerStore } from '../store/playerStore';
import { Play, Trash2, ChevronUp, ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';

type SortKey = 'name' | 'songCount' | 'duration';
type SortDir = 'asc' | 'desc';

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function SortHeader({
  label, sortKey, current, dir, onSort
}: {
  label: string;
  sortKey: SortKey;
  current: SortKey;
  dir: SortDir;
  onSort: (k: SortKey) => void;
}) {
  const active = current === sortKey;
  return (
    <button className={`playlist-sort-btn${active ? ' active' : ''}`} onClick={() => onSort(sortKey)}>
      {label}
      {active ? (dir === 'asc' ? <ChevronUp size={13} /> : <ChevronDown size={13} />) : null}
    </button>
  );
}

export default function Playlists() {
  const { t } = useTranslation();
  const [playlists, setPlaylists] = useState<SubsonicPlaylist[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const playTrack = usePlayerStore(s => s.playTrack);
  const clearQueue = usePlayerStore(s => s.clearQueue);

  const fetchPlaylists = () => {
    setLoading(true);
    getPlaylists()
      .then(data => { setPlaylists(data); setLoading(false); })
      .catch(err => { console.error('Failed to load playlists', err); setLoading(false); });
  };

  useEffect(() => { fetchPlaylists(); }, []);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
  };

  const handlePlay = async (id: string) => {
    try {
      const data = await getPlaylist(id);
      const tracks = data.songs.map((s: any) => ({
        id: s.id, title: s.title, artist: s.artist, album: s.album,
        albumId: s.albumId, artistId: s.artistId, duration: s.duration,
        coverArt: s.coverArt, track: s.track, year: s.year,
        bitRate: s.bitRate, suffix: s.suffix, userRating: s.userRating,
      }));
      if (tracks.length > 0) { clearQueue(); playTrack(tracks[0], tracks); }
    } catch (e) { console.error('Failed to play playlist', e); }
  };

  const handleDelete = async (id: string, name: string) => {
    if (confirm(t('playlists.confirmDelete', { name }))) {
      try { await deletePlaylist(id); fetchPlaylists(); }
      catch (e) { console.error('Failed to delete playlist', e); }
    }
  };

  const visible = useMemo(() => {
    const q = filter.toLowerCase();
    const filtered = q ? playlists.filter(p => p.name.toLowerCase().includes(q)) : playlists;
    return [...filtered].sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'name') cmp = a.name.localeCompare(b.name);
      else if (sortKey === 'songCount') cmp = a.songCount - b.songCount;
      else cmp = a.duration - b.duration;
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [playlists, filter, sortKey, sortDir]);

  return (
    <div className="content-body animate-fade-in">
      <div className="playlist-page-header">
        <h1 className="page-title">{t('playlists.title')}</h1>
        <input
          className="playlist-filter-input"
          type="search"
          placeholder={t('playlists.filterPlaceholder')}
          value={filter}
          onChange={e => setFilter(e.target.value)}
        />
      </div>

      {loading ? (
        <div className="loading-center"><div className="spinner" /></div>
      ) : playlists.length === 0 ? (
        <div className="empty-state" style={{ whiteSpace: 'pre-line' }}>{t('playlists.empty')}</div>
      ) : (
        <div className="playlist-list">
          <div className="playlist-list-header">
            <div />
            <SortHeader label={t('playlists.colName')} sortKey="name" current={sortKey} dir={sortDir} onSort={handleSort} />
            <SortHeader label={t('playlists.colTracks')} sortKey="songCount" current={sortKey} dir={sortDir} onSort={handleSort} />
            <SortHeader label={t('playlists.colDuration')} sortKey="duration" current={sortKey} dir={sortDir} onSort={handleSort} />
            <div />
          </div>

          {visible.length === 0 ? (
            <div className="empty-state">{t('playlists.noResults')}</div>
          ) : visible.map(p => (
            <div key={p.id} className="playlist-row">
              <button className="playlist-play-icon" onClick={() => handlePlay(p.id)} data-tooltip={t('playlists.play')}>
                <Play size={14} fill="currentColor" />
              </button>
              <span className="playlist-name truncate">{p.name}</span>
              <span className="playlist-meta">{t('playlists.track', { count: p.songCount })}</span>
              <span className="playlist-meta">{formatDuration(p.duration)}</span>
              <button
                className="btn btn-ghost playlist-delete-btn"
                onClick={() => handleDelete(p.id, p.name)}
                data-tooltip={t('playlists.deleteTooltip')}
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
