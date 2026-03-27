import React, { useEffect, useRef, useState } from 'react';
import { getCachedUrl } from '../utils/imageCache';

interface CachedImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  src: string;
  cacheKey: string;
}

export function useCachedUrl(fetchUrl: string, cacheKey: string): string {
  const [resolved, setResolved] = useState('');
  useEffect(() => {
    if (!fetchUrl) { setResolved(''); return; }
    let cancelled = false;
    getCachedUrl(fetchUrl, cacheKey).then(url => { if (!cancelled) setResolved(url); });
    return () => { cancelled = true; };
  }, [fetchUrl, cacheKey]);
  return resolved || fetchUrl;
}

export default function CachedImage({ src, cacheKey, style, onLoad, ...props }: CachedImageProps) {
  const resolvedSrc = useCachedUrl(src, cacheKey);
  const [loaded, setLoaded] = useState(false);
  const prevSrc = useRef('');

  if (resolvedSrc !== prevSrc.current) {
    prevSrc.current = resolvedSrc;
    setLoaded(false);
  }

  return (
    <img
      src={resolvedSrc}
      style={{ ...style, opacity: loaded ? 1 : 0, transition: loaded ? 'opacity 0.15s ease' : 'none' }}
      onLoad={e => { setLoaded(true); onLoad?.(e); }}
      {...props}
    />
  );
}
