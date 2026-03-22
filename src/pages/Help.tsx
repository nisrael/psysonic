import React, { useState } from 'react';
import { ChevronDown, Rocket, Play, LibraryBig, Settings2, Radio, Wrench, Shuffle } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface FaqItem { q: string; a: string; }
interface FaqSection { icon: React.ReactNode; title: string; items: FaqItem[]; }

function AccordionItem({ q, a, open, onToggle }: FaqItem & { open: boolean; onToggle: () => void }) {
  return (
    <div className={`help-item${open ? ' help-item-open' : ''}`}>
      <button className="help-question" onClick={onToggle} aria-expanded={open}>
        <span>{q}</span>
        <ChevronDown size={16} className="help-chevron" />
      </button>
      {open && <div className="help-answer">{a}</div>}
    </div>
  );
}

export default function Help() {
  const { t } = useTranslation();
  const [openKey, setOpenKey] = useState<string | null>(null);

  const toggle = (key: string) => setOpenKey(prev => prev === key ? null : key);

  const sections: FaqSection[] = [
    {
      icon: <Rocket size={18} />,
      title: t('help.s1'),
      items: [
        { q: t('help.q1'), a: t('help.a1') },
        { q: t('help.q2'), a: t('help.a2') },
        { q: t('help.q3'), a: t('help.a3') },
      ],
    },
    {
      icon: <Play size={18} />,
      title: t('help.s2'),
      items: [
        { q: t('help.q4'), a: t('help.a4') },
        { q: t('help.q5'), a: t('help.a5') },
        { q: t('help.q6'), a: t('help.a6') },
        { q: t('help.q7'), a: t('help.a7') },
        { q: t('help.q8'), a: t('help.a8') },
        { q: t('help.q22'), a: t('help.a22') },
        { q: t('help.q24'), a: t('help.a24') },
        { q: t('help.q29'), a: t('help.a29') },
        { q: t('help.q30'), a: t('help.a30') },
      ],
    },
    {
      icon: <LibraryBig size={18} />,
      title: t('help.s3'),
      items: [
        { q: t('help.q9'),  a: t('help.a9') },
        { q: t('help.q10'), a: t('help.a10') },
        { q: t('help.q11'), a: t('help.a11') },
        { q: t('help.q25'), a: t('help.a25') },
      ],
    },
    {
      icon: <Settings2 size={18} />,
      title: t('help.s4'),
      items: [
        { q: t('help.q12'), a: t('help.a12') },
        { q: t('help.q13'), a: t('help.a13') },
        { q: t('help.q14'), a: t('help.a14') },
        { q: t('help.q15'), a: t('help.a15') },
        { q: t('help.q31'), a: t('help.a31') },
        { q: t('help.q32'), a: t('help.a32') },
      ],
    },
    {
      icon: <Radio size={18} />,
      title: t('help.s5'),
      items: [
        { q: t('help.q16'), a: t('help.a16') },
        { q: t('help.q17'), a: t('help.a17') },
      ],
    },
    {
      icon: <Shuffle size={18} />,
      title: t('help.s7'),
      items: [
        { q: t('help.q26'), a: t('help.a26') },
        { q: t('help.q27'), a: t('help.a27') },
        { q: t('help.q28'), a: t('help.a28') },
      ],
    },
    {
      icon: <Wrench size={18} />,
      title: t('help.s6'),
      items: [
        { q: t('help.q18'), a: t('help.a18') },
        { q: t('help.q19'), a: t('help.a19') },
        { q: t('help.q20'), a: t('help.a20') },
        { q: t('help.q21'), a: t('help.a21') },
      ],
    },
  ];

  return (
    <div className="content-body animate-fade-in">
      <h1 className="page-title" style={{ marginBottom: '2rem' }}>{t('help.title')}</h1>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '1.25rem', alignItems: 'start' }}>
        {sections.map((section, si) => (
          <section key={si} className="settings-section">
            <div className="settings-section-header">
              {section.icon}
              <h2>{section.title}</h2>
            </div>
            <div className="help-list">
              {section.items.map((item, ii) => {
                const key = `${si}-${ii}`;
                return <AccordionItem key={key} q={item.q} a={item.a} open={openKey === key} onToggle={() => toggle(key)} />;
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
