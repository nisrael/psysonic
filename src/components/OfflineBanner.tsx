import React from 'react';
import { WifiOff, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface Props {
  onRetry: () => void;
  isChecking: boolean;
}

export default function OfflineBanner({ onRetry, isChecking }: Props) {
  const { t } = useTranslation();
  return (
    <div className="offline-banner">
      <WifiOff size={14} />
      <span>{t('connection.offlineModeBanner')}</span>
      <button
        className="offline-banner-retry"
        onClick={onRetry}
        disabled={isChecking}
      >
        <RefreshCw size={12} className={isChecking ? 'spin' : ''} />
        {t('connection.retry')}
      </button>
    </div>
  );
}
