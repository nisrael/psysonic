import { useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Check, Copy } from 'lucide-react';
import { startOrbitSession, buildOrbitShareLink } from '../utils/orbit';
import { useAuthStore } from '../store/authStore';
import { useOrbitStore } from '../store/orbitStore';
import { ORBIT_DEFAULT_MAX_USERS } from '../api/orbit';

interface Props { onClose: () => void; }

/**
 * Orbit — start-session modal.
 *
 * Two-step: host picks a name + max participants and presses "Start".
 * Once the session is created we swap the form for the share link + a
 * copy button, then the host closes the modal manually.
 */
export default function OrbitStartModal({ onClose }: Props) {
  const [name, setName]         = useState('');
  const [maxUsers, setMaxUsers] = useState(ORBIT_DEFAULT_MAX_USERS);
  const [busy, setBusy]         = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [shareLink, setShareLink] = useState<string | null>(null);
  const [copied, setCopied]     = useState(false);

  const onStart = async () => {
    setError(null);
    const trimmed = name.trim();
    if (!trimmed) { setError('Name required'); return; }
    setBusy(true);
    try {
      const state = await startOrbitSession({ name: trimmed, maxUsers });
      const server = useAuthStore.getState().getActiveServer();
      const base = server?.url ?? '';
      setShareLink(buildOrbitShareLink(base, state.sid));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Start failed');
    } finally {
      setBusy(false);
    }
  };

  const onCopy = async () => {
    if (!shareLink) return;
    try {
      await navigator.clipboard.writeText(shareLink);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch { /* silent */ }
  };

  const inStartedState = !!shareLink;
  const bindingActive  = useOrbitStore.getState().phase === 'active';

  return createPortal(
    <div
      className="modal-overlay orbit-start-overlay"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="orbit-start-title"
    >
      <div className="modal-content orbit-start-modal">
        <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
          <X size={18} />
        </button>

        {!inStartedState && (
          <>
            <h3 id="orbit-start-title" className="orbit-start-modal__title">Start a session</h3>
            <p className="orbit-start-modal__sub">Anyone you share the link with can join from this server.</p>

            <label className="orbit-start-modal__label">
              Name
              <input
                type="text"
                autoFocus
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Friday night"
                maxLength={40}
                className="orbit-start-modal__input"
              />
            </label>

            <label className="orbit-start-modal__label">
              Max guests: <strong>{maxUsers}</strong>
              <input
                type="range"
                min={1}
                max={32}
                value={maxUsers}
                onChange={e => setMaxUsers(Number(e.target.value))}
                className="orbit-start-modal__range"
              />
            </label>

            {error && <div className="orbit-start-modal__error">{error}</div>}

            <div className="orbit-start-modal__actions">
              <button type="button" className="btn btn-surface" onClick={onClose}>Cancel</button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={onStart}
                disabled={busy || !name.trim()}
              >
                {busy ? 'Starting…' : 'Start'}
              </button>
            </div>
          </>
        )}

        {inStartedState && (
          <>
            <h3 id="orbit-start-title" className="orbit-start-modal__title">Session live{bindingActive ? '' : '…'}</h3>
            <p className="orbit-start-modal__sub">Share this with anyone on this server:</p>

            <div className="orbit-start-modal__link">
              <code>{shareLink}</code>
              <button
                type="button"
                className="orbit-start-modal__copy"
                onClick={onCopy}
                data-tooltip={copied ? 'Copied' : 'Copy'}
                aria-label="Copy share link"
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
              </button>
            </div>

            <div className="orbit-start-modal__actions">
              <button type="button" className="btn btn-primary" onClick={onClose}>Done</button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
