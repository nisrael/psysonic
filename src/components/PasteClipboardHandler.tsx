import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../store/authStore';
import { decodeSharePayloadFromText } from '../utils/shareLink';
import { decodeServerMagicStringFromText } from '../utils/serverMagicString';
import { applySharePastePayload } from '../utils/applySharePaste';
import { showToast } from '../utils/toast';
import { parseOrbitShareLink, joinOrbitSession, OrbitJoinError } from '../utils/orbit';

/**
 * Global paste: library share links (`psysonic2-`) and server invites (`psysonic1-`)
 * outside text fields. Shares require login; invites open add-server (settings or login).
 */
export default function PasteClipboardHandler() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const isLoggedIn = useAuthStore(s => s.isLoggedIn);
  const busy = useRef(false);

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable
      ) {
        return;
      }
      const text = e.clipboardData?.getData('text/plain') ?? '';

      // Orbit share link — handled before library shares.
      const orbit = parseOrbitShareLink(text.trim());
      if (orbit) {
        e.preventDefault();
        e.stopPropagation();
        if (!isLoggedIn) { showToast('Log in before joining a session', 4000, 'info'); return; }
        const active = useAuthStore.getState().getActiveServer();
        const activeUrl = (active?.url ?? '').replace(/\/+$/, '');
        const wantUrl   = orbit.serverBase.replace(/\/+$/, '');
        if (activeUrl !== wantUrl) {
          showToast(`Switch to ${wantUrl} first, then paste again`, 5000, 'info');
          return;
        }
        if (busy.current) return;
        busy.current = true;
        joinOrbitSession(orbit.sid)
          .then(() => showToast('Joined session', 2500, 'info'))
          .catch(err => {
            if (err instanceof OrbitJoinError) {
              const msg: Record<string, string> = {
                'not-found': 'Session not found',
                'ended':     'Session has ended',
                'full':      'Session is full',
                'kicked':    'You can\'t rejoin this session',
                'no-user':   'No active server',
                'server-error': 'Couldn\'t join',
              };
              showToast(msg[err.reason] ?? err.message, 4000, 'error');
            } else {
              showToast('Couldn\'t join session', 4000, 'error');
            }
          })
          .finally(() => { busy.current = false; });
        return;
      }

      const share = decodeSharePayloadFromText(text);
      if (share) {
        if (!isLoggedIn) {
          e.preventDefault();
          e.stopPropagation();
          showToast(t('sharePaste.notLoggedIn'), 4000, 'info');
          return;
        }
        if (busy.current) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        busy.current = true;
        void applySharePastePayload(share, navigate, t).finally(() => {
          busy.current = false;
        });
        return;
      }
      const invite = decodeServerMagicStringFromText(text);
      if (!invite) return;
      if (busy.current) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      busy.current = true;
      if (isLoggedIn) {
        navigate('/settings', { state: { tab: 'server' as const, openAddServerInvite: invite } });
      } else {
        navigate('/login', { state: { openAddServerInvite: invite } });
      }
      queueMicrotask(() => {
        busy.current = false;
      });
    };
    document.addEventListener('paste', onPaste, true);
    return () => document.removeEventListener('paste', onPaste, true);
  }, [navigate, t, isLoggedIn]);

  return null;
}
