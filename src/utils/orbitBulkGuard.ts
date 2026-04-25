import { useOrbitStore } from '../store/orbitStore';
import { useConfirmModalStore } from '../store/confirmModalStore';
import i18n from '../i18n';

/**
 * Ask the user before dropping many tracks into the shared Orbit queue.
 *
 * Returns `true` when there's no active Orbit session, when `count <= 1`, or
 * when the user accepted the confirm dialog. Returns `false` only when an
 * active-Orbit user explicitly cancelled.
 *
 * Lives in its own module so `playerStore` can use it without pulling the
 * full `utils/orbit.ts` (which itself imports `playerStore` — circular).
 */
export async function orbitBulkGuard(count: number): Promise<boolean> {
  const role = useOrbitStore.getState().role;
  if (role !== 'host' && role !== 'guest') return true;
  if (count <= 1) return true;

  return useConfirmModalStore.getState().request({
    title: i18n.t('orbit.bulkConfirmTitle'),
    message: i18n.t('orbit.bulkConfirmBody', { count }),
    confirmLabel: i18n.t('orbit.bulkConfirmYes'),
    cancelLabel: i18n.t('orbit.bulkConfirmNo'),
  });
}
