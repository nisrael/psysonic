import React, { useEffect, useState } from 'react';
import { getAlbumList, getArtists, getGenres, SubsonicAlbum, SubsonicGenre } from '../api/subsonic';
import AlbumRow from '../components/AlbumRow';
import { useTranslation } from 'react-i18next';

export default function Statistics() {
  const { t } = useTranslation();
  const [recent, setRecent] = useState<SubsonicAlbum[]>([]);
  const [frequent, setFrequent] = useState<SubsonicAlbum[]>([]);
  const [highest, setHighest] = useState<SubsonicAlbum[]>([]);
  const [genres, setGenres] = useState<SubsonicGenre[]>([]);
  const [artistCount, setArtistCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      getAlbumList('recent', 20).catch(() => []),
      getAlbumList('frequent', 12).catch(() => []),
      getAlbumList('highest', 12).catch(() => []),
      getGenres().catch(() => []),
      getArtists().catch(() => []),
    ]).then(([rc, fr, hi, g, a]) => {
      setRecent(rc);
      setFrequent(fr);
      setHighest(hi);
      setGenres(g.sort((a, b) => b.songCount - a.songCount).slice(0, 20));
      setArtistCount(a.length);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const loadMore = async (
    type: 'frequent' | 'highest',
    currentList: SubsonicAlbum[],
    setter: React.Dispatch<React.SetStateAction<SubsonicAlbum[]>>
  ) => {
    try {
      const more = await getAlbumList(type, 12, currentList.length);
      const newItems = more.filter(m => !currentList.find(c => c.id === m.id));
      if (newItems.length > 0) setter(prev => [...prev, ...newItems]);
    } catch (e) {
      console.error('Failed to load more', e);
    }
  };

  const totalSongs = genres.reduce((acc, g) => acc + g.songCount, 0);
  const totalAlbums = genres.reduce((acc, g) => acc + g.albumCount, 0);
  const maxGenreCount = Math.max(...genres.map(g => g.songCount), 1);

  const stats = [
    { label: t('statistics.statArtists'), value: artistCount },
    { label: t('statistics.statAlbums'), value: totalAlbums || null },
    { label: t('statistics.statSongs'), value: totalSongs || null },
    { label: t('statistics.statGenres'), value: genres.length || null },
  ];

  return (
    <div className="content-body animate-fade-in">
      <h1 className="page-title">{t('statistics.title')}</h1>

      {loading ? (
        <div className="loading-center"><div className="spinner" /></div>
      ) : (
        <div className="stats-page">

          <div className="stats-overview">
            {stats.map(s => (
              <div key={s.label} className="stats-card">
                <span className="stats-card-value">{s.value?.toLocaleString() ?? '—'}</span>
                <span className="stats-card-label">{s.label}</span>
              </div>
            ))}
          </div>

          {recent.length > 0 && (
            <AlbumRow title={t('statistics.recentlyPlayed')} albums={recent} />
          )}

          <AlbumRow
            title={t('statistics.mostPlayed')}
            albums={frequent}
            onLoadMore={() => loadMore('frequent', frequent, setFrequent)}
            moreText={t('statistics.loadMore')}
          />

          <AlbumRow
            title={t('statistics.highestRated')}
            albums={highest}
            onLoadMore={() => loadMore('highest', highest, setHighest)}
            moreText={t('statistics.loadMore')}
          />

          {genres.length > 0 && (
            <section>
              <h2 className="section-title">{t('statistics.genreDistribution')}</h2>
              <div className="genre-chart">
                {genres.map(genre => (
                  <div key={genre.value} className="genre-row">
                    <div className="genre-row-header">
                      <span className="genre-name">{genre.value}</span>
                      <span className="genre-counts">
                        {t('statistics.genreSongs', { count: genre.songCount })}
                        {' · '}
                        {t('statistics.genreAlbums', { count: genre.albumCount })}
                      </span>
                    </div>
                    <div className="genre-bar-track">
                      <div
                        className="genre-bar-fill"
                        style={{ width: `${(genre.songCount / maxGenreCount) * 100}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

        </div>
      )}
    </div>
  );
}
