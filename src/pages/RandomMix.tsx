import React, { useEffect, useState } from 'react';
import { getRandomSongs, getGenres, SubsonicSong, SubsonicGenre, star, unstar } from '../api/subsonic';
import { usePlayerStore } from '../store/playerStore';
import { useAuthStore } from '../store/authStore';
import { Play, Star, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react';
import { useTranslation } from 'react-i18next';

const AUDIOBOOK_GENRES = [
  'hörbuch', 'hoerbuch', 'hörspiel', 'hoerspiel',
  'audiobook', 'audio book', 'spoken word', 'spokenword',
  'podcast', 'kapitel', 'thriller', 'krimi', 'speech',
  'fantasy', 'comedy', 'literature',
];

interface SuperGenre {
  id: string;
  label: string;
  keywords: string[];
}

const SUPER_GENRES: SuperGenre[] = [
  { id: 'metal', label: 'Metal', keywords: ['metal', 'thrash', 'doom', 'sludge', 'hardcore', 'grindcore', 'deathcore', 'metalcore', 'stoner', 'crust', 'black', 'death'] },
  { id: 'rock', label: 'Rock', keywords: ['rock', 'punk', 'grunge', 'alternative', 'indie', 'post-rock', 'prog', 'garage', 'psychedelic', 'shoegaze'] },
  { id: 'pop', label: 'Pop', keywords: ['pop', 'synth-pop', 'dream pop', 'electropop', 'indie pop', 'dance pop'] },
  { id: 'electronic', label: 'Electronic', keywords: ['electronic', 'techno', 'trance', 'ambient', 'edm', 'house', 'dubstep', 'drum and bass', 'dnb', 'electro', 'idm', 'synthwave', 'darkwave', 'industrial'] },
  { id: 'jazz', label: 'Jazz', keywords: ['jazz', 'blues', 'soul', 'funk', 'swing', 'bebop', 'fusion'] },
  { id: 'classical', label: 'Classical', keywords: ['classical', 'orchestra', 'symphony', 'baroque', 'opera', 'chamber', 'romantic'] },
  { id: 'hiphop', label: 'Hip-Hop', keywords: ['hip-hop', 'hip hop', 'rap', 'r&b', 'rnb', 'trap', 'grime'] },
  { id: 'country', label: 'Country', keywords: ['country', 'folk', 'bluegrass', 'americana', 'western'] },
  { id: 'world', label: 'World', keywords: ['world', 'latin', 'reggae', 'ska', 'afro', 'celtic', 'flamenco', 'bossa nova'] },
];

function formatDuration(seconds: number): string {
  if (!seconds || isNaN(seconds)) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function RandomMix() {
  const { t } = useTranslation();
  const [songs, setSongs] = useState<SubsonicSong[]>([]);
  const [loading, setLoading] = useState(true);
  const playTrack = usePlayerStore(s => s.playTrack);
  const openContextMenu = usePlayerStore(s => s.openContextMenu);
  const contextMenuOpen = usePlayerStore(s => s.contextMenu.isOpen);
  const [contextMenuSongId, setContextMenuSongId] = useState<string | null>(null);
  const [starredSongs, setStarredSongs] = useState<Set<string>>(new Set());
  const { excludeAudiobooks, setExcludeAudiobooks, customGenreBlacklist, setCustomGenreBlacklist } = useAuthStore();
  const [addedGenre, setAddedGenre] = useState<string | null>(null);

  // Blacklist panel state
  const [blacklistOpen, setBlacklistOpen] = useState(false);
  const [newGenre, setNewGenre] = useState('');

  // Genre Mix state
  const [serverGenres, setServerGenres] = useState<SubsonicGenre[]>([]);
  const [selectedSuperGenre, setSelectedSuperGenre] = useState<string | null>(null);
  const [genreMixSongs, setGenreMixSongs] = useState<SubsonicSong[]>([]);
  const [genreMixLoading, setGenreMixLoading] = useState(false);

  const fetchSongs = () => {
    setLoading(true);
    getRandomSongs(50)
      .then(fetched => {
        setSongs(fetched);
        const st = new Set<string>();
        fetched.forEach(s => { if (s.starred) st.add(s.id); });
        setStarredSongs(st);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  useEffect(() => {
    if (!contextMenuOpen) setContextMenuSongId(null);
  }, [contextMenuOpen]);

  useEffect(() => {
    fetchSongs();
    getGenres().then(setServerGenres).catch(() => {});
  }, []);

  const filteredSongs = songs.filter(song => {
    if (!excludeAudiobooks) return true;
    const checkText = (text: string) => {
      const t = text.toLowerCase();
      if (AUDIOBOOK_GENRES.some(ag => t.includes(ag))) return true;
      if (customGenreBlacklist.some(bg => t.includes(bg.toLowerCase()))) return true;
      return false;
    };
    if (song.genre && checkText(song.genre)) return false;
    if (song.title && checkText(song.title)) return false;
    if (song.album && checkText(song.album)) return false;
    return true;
  });

  const handlePlayAll = () => {
    if (filteredSongs.length > 0) playTrack(filteredSongs[0], filteredSongs);
  };

  const toggleSongStar = async (song: SubsonicSong, e: React.MouseEvent) => {
    e.stopPropagation();
    const currentlyStarred = starredSongs.has(song.id);
    const nextStarred = new Set(starredSongs);
    if (currentlyStarred) nextStarred.delete(song.id);
    else nextStarred.add(song.id);
    setStarredSongs(nextStarred);

    try {
      if (currentlyStarred) await unstar(song.id, 'song');
      else await star(song.id, 'song');
    } catch (err) {
      console.error('Failed to toggle song star', err);
      setStarredSongs(new Set(starredSongs));
    }
  };

  // Compute which super-genres have matching server genres
  const availableSuperGenres = SUPER_GENRES.filter(sg =>
    serverGenres.some(sg2 =>
      sg.keywords.some(kw => sg2.value.toLowerCase().includes(kw))
    )
  );

  const loadGenreMix = async (superGenreId: string) => {
    const sg = SUPER_GENRES.find(s => s.id === superGenreId);
    if (!sg) return;
    const matched = serverGenres
      .filter(sg2 => sg.keywords.some(kw => sg2.value.toLowerCase().includes(kw)))
      .map(sg2 => sg2.value);
    setGenreMixLoading(true);
    setGenreMixSongs([]);

    const perGenre = Math.max(1, Math.ceil(50 / matched.length));
    const accumulated: SubsonicSong[] = [];
    let resolved = 0;

    await Promise.allSettled(matched.map(g =>
      getRandomSongs(perGenre, g, 45000).then(songs => {
        accumulated.push(...songs);
        resolved++;
        // Show first batch immediately; update on every subsequent resolve
        setGenreMixSongs([...accumulated]);
        if (resolved === 1) setGenreMixLoading(false);
      }).catch(() => { resolved++; })
    ));

    // Final shuffle once all requests are done
    setGenreMixSongs(prev => {
      const s = [...prev];
      for (let i = s.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [s[i], s[j]] = [s[j], s[i]];
      }
      return s.slice(0, 50);
    });
    setGenreMixLoading(false);
  };


  return (
    <div className="content-body animate-fade-in">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <h1 className="page-title">{t('randomMix.title')}</h1>

        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button className="btn btn-surface" onClick={fetchSongs} disabled={loading} data-tooltip={t('randomMix.remixTooltip')}>
            <RefreshCw size={18} className={loading ? 'spin' : ''} /> {t('randomMix.remix')}
          </button>
          <button className="btn btn-primary" onClick={handlePlayAll} disabled={loading || filteredSongs.length === 0}>
            <Play size={18} fill="currentColor" /> {t('randomMix.playAll')}
          </button>
        </div>
      </div>

      {/* ── Filter + Genre Mix panel ─────────────────────────────── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: '1px',
        background: 'var(--border)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        marginBottom: '2rem',
        overflow: 'hidden',
      }}>
        {/* Left: Blacklist */}
        <div style={{ background: 'var(--bg-elevated)', padding: '1rem 1.25rem' }}>
          <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
            {t('randomMix.filterPanelTitle')}
          </div>

          <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', cursor: 'pointer', fontSize: 13, marginBottom: '0.75rem' }}>
            <input
              type="checkbox"
              checked={excludeAudiobooks}
              onChange={e => setExcludeAudiobooks(e.target.checked)}
              style={{ marginTop: 2 }}
            />
            <div>
              <div style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{t('randomMix.excludeAudiobooks')}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{t('randomMix.excludeAudiobooksDesc')}</div>
            </div>
          </label>

          <button
            className="btn btn-ghost"
            style={{ fontSize: 12, padding: '3px 8px', marginBottom: blacklistOpen ? '0.5rem' : 0 }}
            onClick={() => setBlacklistOpen(v => !v)}
          >
            {blacklistOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            {t('randomMix.blacklistToggle')} ({customGenreBlacklist.length})
          </button>

          {blacklistOpen && (
            <div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', marginBottom: '0.5rem', minHeight: 24 }}>
                {customGenreBlacklist.length === 0 ? (
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t('settings.randomMixBlacklistEmpty')}</span>
                ) : (
                  customGenreBlacklist.map(genre => (
                    <span key={genre} style={{
                      display: 'inline-flex', alignItems: 'center', gap: 3,
                      background: 'color-mix(in srgb, var(--accent) 15%, transparent)',
                      color: 'var(--accent)', borderRadius: 'var(--radius-sm)',
                      padding: '1px 7px', fontSize: 11, fontWeight: 500,
                    }}>
                      {genre}
                      <button
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', padding: 0, lineHeight: 1, fontSize: 13 }}
                        onClick={() => setCustomGenreBlacklist(customGenreBlacklist.filter(g => g !== genre))}
                      >×</button>
                    </span>
                  ))
                )}
              </div>
              <div style={{ display: 'flex', gap: '0.4rem' }}>
                <input
                  className="input"
                  type="text"
                  value={newGenre}
                  onChange={e => setNewGenre(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && newGenre.trim()) {
                      const trimmed = newGenre.trim();
                      if (!customGenreBlacklist.includes(trimmed)) setCustomGenreBlacklist([...customGenreBlacklist, trimmed]);
                      setNewGenre('');
                    }
                  }}
                  placeholder={t('settings.randomMixBlacklistPlaceholder')}
                  style={{ fontSize: 12 }}
                />
                <button
                  className="btn btn-ghost"
                  style={{ fontSize: 12, padding: '4px 10px', flexShrink: 0 }}
                  onClick={() => {
                    const trimmed = newGenre.trim();
                    if (trimmed && !customGenreBlacklist.includes(trimmed)) setCustomGenreBlacklist([...customGenreBlacklist, trimmed]);
                    setNewGenre('');
                  }}
                  disabled={!newGenre.trim()}
                >{t('settings.randomMixBlacklistAdd')}</button>
              </div>
            </div>
          )}
        </div>

        {/* Right: Genre Mix */}
        <div style={{ background: 'var(--bg-elevated)', padding: '1rem 1.25rem' }}>
          <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
            {t('randomMix.genreMixTitle')}
          </div>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: '0.75rem' }}>{t('randomMix.genreMixDesc')}</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
            {serverGenres.length === 0 ? (
              <div className="spinner" style={{ width: 14, height: 14 }} />
            ) : availableSuperGenres.length === 0 ? (
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('randomMix.genreMixNoGenres')}</span>
            ) : (
              availableSuperGenres.map(sg => (
                <button
                  key={sg.id}
                  className={`btn ${selectedSuperGenre === sg.id ? 'btn-primary' : 'btn-surface'}`}
                  style={{ fontSize: 12, padding: '4px 12px' }}
                  onClick={() => { setSelectedSuperGenre(sg.id); loadGenreMix(sg.id); }}
                  disabled={genreMixLoading}
                >
                  {sg.label}
                </button>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Genre Mix tracklist (shown when a super-genre is selected) */}
      {(genreMixLoading || genreMixSongs.length > 0) && (
        <div style={{ marginBottom: '2rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
              {SUPER_GENRES.find(s => s.id === selectedSuperGenre)?.label} Mix
              {genreMixLoading && <div className="spinner" style={{ width: 12, height: 12, borderWidth: 2 }} />}
            </span>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button className="btn btn-primary" style={{ fontSize: 12, padding: '4px 12px' }} onClick={() => genreMixSongs.length > 0 && playTrack(genreMixSongs[0], genreMixSongs)} disabled={genreMixLoading || genreMixSongs.length === 0}>
                <Play size={14} fill="currentColor" /> {t('randomMix.playAll')}
              </button>
            </div>
          </div>
          {genreMixLoading && genreMixSongs.length === 0 ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '2rem' }}><div className="spinner" /></div>
          ) : (
            <div className="tracklist">
              <div className="tracklist-header" style={{ gridTemplateColumns: '36px 1fr 1fr 1fr 120px 80px' }}>
                <span></span>
                <span>{t('randomMix.trackTitle')}</span>
                <span>{t('randomMix.trackArtist')}</span>
                <span>{t('randomMix.trackAlbum')}</span>
                <span>{t('randomMix.trackGenre')}</span>
                <span style={{ textAlign: 'right' }}>{t('randomMix.trackDuration')}</span>
              </div>
              {genreMixSongs.map(song => (
                <div key={song.id} className={`track-row${contextMenuSongId === song.id ? ' context-active' : ''}`} style={{ gridTemplateColumns: '36px 1fr 1fr 1fr 120px 80px' }}
                  onDoubleClick={() => playTrack(song, genreMixSongs)} role="row" draggable
                  onContextMenu={e => { e.preventDefault(); setContextMenuSongId(song.id); openContextMenu(e.clientX, e.clientY, { id: song.id, title: song.title, artist: song.artist, album: song.album, albumId: song.albumId, artistId: song.artistId, duration: song.duration, coverArt: song.coverArt, track: song.track, year: song.year, bitRate: song.bitRate, suffix: song.suffix, userRating: song.userRating }, 'song'); }}
                  onDragStart={e => {
                    e.dataTransfer.effectAllowed = 'copy';
                    e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'song', track: { id: song.id, title: song.title, artist: song.artist, album: song.album, albumId: song.albumId, artistId: song.artistId, duration: song.duration, coverArt: song.coverArt, track: song.track, year: song.year, bitRate: song.bitRate, suffix: song.suffix, userRating: song.userRating } }));
                  }}
                >
                  <button className="btn btn-ghost" style={{ padding: 4 }} onClick={e => { e.stopPropagation(); playTrack(song, genreMixSongs); }}>
                    <Play size={14} fill="currentColor" />
                  </button>
                  <div className="track-info"><span className="track-title" data-tooltip={song.title}>{song.title}</span></div>
                  <div className="track-artist-cell"><span className="track-artist">{song.artist}</span></div>
                  <div className="track-info"><span className="track-title" style={{ fontSize: '0.85rem', color: 'var(--subtext0)' }}>{song.album}</span></div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{song.genre ?? '—'}</div>
                  <span className="track-duration" style={{ textAlign: 'right' }}>{formatDuration(song.duration)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {!selectedSuperGenre && (loading && songs.length === 0 ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '4rem' }}>
          <div className="spinner" />
        </div>
      ) : (
        <div className="tracklist">
          <div className="tracklist-header" style={{ gridTemplateColumns: '36px 1fr 1fr 1fr 120px 60px 80px' }}>
            <span></span>
            <span>{t('randomMix.trackTitle')}</span>
            <span>{t('randomMix.trackArtist')}</span>
            <span>{t('randomMix.trackAlbum')}</span>
            <span data-tooltip={t('randomMix.genreClickHint')} data-tooltip-wrap style={{ cursor: 'help' }}>
              {t('randomMix.trackGenre')} <span style={{ color: 'var(--accent)', fontWeight: 700, fontSize: 13 }}>ⓘ</span>
            </span>
            <span style={{ textAlign: 'center' }}>{t('randomMix.trackFavorite')}</span>
            <span style={{ textAlign: 'right' }}>{t('randomMix.trackDuration')}</span>
          </div>

          {filteredSongs.map((song) => (
            <div
              key={song.id}
              className={`track-row${contextMenuSongId === song.id ? ' context-active' : ''}`}
              style={{ gridTemplateColumns: '36px 1fr 1fr 1fr 120px 60px 80px' }}
              onDoubleClick={() => playTrack(song, filteredSongs)}
              role="row"
              draggable
              onContextMenu={e => {
                e.preventDefault();
                const track = { id: song.id, title: song.title, artist: song.artist, album: song.album, albumId: song.albumId, artistId: song.artistId, duration: song.duration, coverArt: song.coverArt, track: song.track, year: song.year, bitRate: song.bitRate, suffix: song.suffix, userRating: song.userRating };
                setContextMenuSongId(song.id);
                openContextMenu(e.clientX, e.clientY, track, 'song');
              }}
              onDragStart={e => {
                e.dataTransfer.effectAllowed = 'copy';
                const track = {
                  id: song.id, title: song.title, artist: song.artist, album: song.album,
                  albumId: song.albumId, artistId: song.artistId, duration: song.duration, coverArt: song.coverArt, track: song.track,
                  year: song.year, bitRate: song.bitRate, suffix: song.suffix, userRating: song.userRating,
                };
                e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'song', track }));
              }}
            >
              <button
                className="btn btn-ghost"
                style={{ padding: 4 }}
                onClick={(e) => { e.stopPropagation(); playTrack(song, filteredSongs); }}
                data-tooltip={t('randomMix.play')}
              >
                <Play size={14} fill="currentColor" />
              </button>

              <div className="track-info">
                <span className="track-title" data-tooltip={song.title}>{song.title}</span>
              </div>

              <div className="track-artist-cell">
                <span className="track-artist" data-tooltip={song.artist}>{song.artist}</span>
              </div>

              <div className="track-info">
                <span className="track-title" style={{ fontSize: '0.85rem', color: 'var(--subtext0)' }} data-tooltip={song.album}>{song.album}</span>
              </div>

              {(() => {
                const genre = song.genre;
                if (!genre) return <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>—</div>;
                const isBlocked = AUDIOBOOK_GENRES.some(ag => genre.toLowerCase().includes(ag)) ||
                  customGenreBlacklist.some(bg => genre.toLowerCase().includes(bg.toLowerCase()));
                const justAdded = addedGenre === genre;
                return (
                  <button
                    className="btn btn-ghost"
                    style={{
                      fontSize: 11,
                      padding: '2px 8px',
                      borderRadius: 'var(--radius-sm)',
                      background: isBlocked ? 'color-mix(in srgb, var(--danger) 15%, transparent)' : justAdded ? 'color-mix(in srgb, var(--accent) 15%, transparent)' : 'var(--bg-hover)',
                      color: isBlocked ? 'var(--danger)' : justAdded ? 'var(--accent)' : 'var(--text-muted)',
                      border: 'none',
                      cursor: isBlocked ? 'default' : 'pointer',
                      maxWidth: '100%',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      height: 'auto',
                      minHeight: 'unset',
                    }}
                    onClick={() => {
                      if (isBlocked) return;
                      const already = customGenreBlacklist.some(bg => genre.toLowerCase().includes(bg.toLowerCase()));
                      if (!already) {
                        setCustomGenreBlacklist([...customGenreBlacklist, genre]);
                        setAddedGenre(genre);
                        setTimeout(() => setAddedGenre(null), 1500);
                      }
                    }}
                    data-tooltip={isBlocked ? t('randomMix.genreBlocked') : justAdded ? t('randomMix.genreAddedToBlacklist') : genre}
                  >
                    {genre}
                  </button>
                );
              })()}

              <div style={{ display: 'flex', justifyContent: 'center' }}>
                <button
                  className="btn btn-ghost"
                  onClick={(e) => toggleSongStar(song, e)}
                  data-tooltip={starredSongs.has(song.id) ? t('randomMix.favoriteRemove') : t('randomMix.favoriteAdd')}
                  style={{ padding: '4px', height: 'auto', minHeight: 'unset', color: starredSongs.has(song.id) ? 'var(--accent)' : 'var(--text-muted)' }}
                >
                  <Star size={14} fill={starredSongs.has(song.id) ? "currentColor" : "none"} />
                </button>
              </div>

              <span className="track-duration" style={{ textAlign: 'right' }}>
                {formatDuration(song.duration)}
              </span>
            </div>
          ))}
        </div>
      ))}

    </div>
  );
}
