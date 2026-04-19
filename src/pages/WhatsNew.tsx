import React, { useMemo } from 'react';
import { Sparkles, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { version } from '../../package.json';
import changelogRaw from '../../CHANGELOG.md?raw';
import { renderChangelogBody } from '../utils/changelogMarkdown';

export default function WhatsNew() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const close = () => {
    if (window.history.length > 1) navigate(-1);
    else navigate('/');
  };

  const entry = useMemo(() => {
    const blocks = changelogRaw.split(/\n(?=## \[)/).filter((b: string) => b.startsWith('## ['));
    const block = blocks.find((b: string) => b.startsWith(`## [${version}]`));
    if (!block) return null;
    const lines = block.split('\n');
    const match = lines[0].match(/## \[([^\]]+)\](?:\s*-\s*(.+))?/);
    const body = lines.slice(1).join('\n').trim();
    return { version: match?.[1] ?? version, date: match?.[2] ?? '', body };
  }, []);

  return (
    <div className="whats-new">
      <header className="whats-new__header">
        <div className="whats-new__title-row">
          <Sparkles size={20} className="whats-new__icon" />
          <div>
            <h1 className="whats-new__title">{t('whatsNew.title')}</h1>
            <div className="whats-new__subtitle">
              v{entry?.version ?? version}
              {entry?.date && <span className="whats-new__date"> · {entry.date}</span>}
            </div>
          </div>
          <button
            type="button"
            className="whats-new__close"
            onClick={close}
            aria-label={t('whatsNew.close')}
            data-tooltip={t('whatsNew.close')}
            data-tooltip-pos="bottom"
          >
            <X size={18} />
          </button>
        </div>
      </header>

      <div className="whats-new__body">
        {entry ? (
          renderChangelogBody(entry.body)
        ) : (
          <p className="whats-new__empty">{t('whatsNew.empty')}</p>
        )}
      </div>
    </div>
  );
}
