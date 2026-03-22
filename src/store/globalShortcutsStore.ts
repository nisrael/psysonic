import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { invoke } from '@tauri-apps/api/core';
import { formatKeyCode } from './keybindingsStore';

export type GlobalAction = 'play-pause' | 'next' | 'prev' | 'volume-up' | 'volume-down';

const MODIFIER_CODES = [
  'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight',
  'ShiftLeft', 'ShiftRight', 'MetaLeft', 'MetaRight', 'OSLeft', 'OSRight',
];

/** Build a Tauri-compatible shortcut string from a KeyboardEvent, or null if invalid. */
export function buildGlobalShortcut(e: KeyboardEvent): string | null {
  if (MODIFIER_CODES.includes(e.code)) return null;
  // Require at least Ctrl, Alt, or Meta — Shift alone is too invasive
  if (!e.ctrlKey && !e.altKey && !e.metaKey) return null;

  const mods: string[] = [];
  if (e.ctrlKey)  mods.push('ctrl');
  if (e.altKey)   mods.push('alt');
  if (e.shiftKey) mods.push('shift');
  if (e.metaKey)  mods.push('super');

  return [...mods, e.code].join('+');
}

/** Human-readable label for a stored shortcut string, e.g. "ctrl+alt+ArrowRight" → "Ctrl+Alt+→". */
export function formatGlobalShortcut(shortcut: string): string {
  return shortcut.split('+').map(part => {
    if (part === 'ctrl')  return 'Ctrl';
    if (part === 'alt')   return 'Alt';
    if (part === 'shift') return 'Shift';
    if (part === 'super' || part === 'meta') return 'Super';
    return formatKeyCode(part);
  }).join('+');
}

// Module-level guard — prevents double-registration from React StrictMode's
// intentional double-invocation of effects in development.
let _registerAllCalled = false;

interface GlobalShortcutsState {
  shortcuts: Partial<Record<GlobalAction, string>>;
  setShortcut: (action: GlobalAction, shortcut: string | null) => Promise<void>;
  registerAll: () => Promise<void>;
  resetAll: () => Promise<void>;
}

export const useGlobalShortcutsStore = create<GlobalShortcutsState>()(
  persist(
    (set, get) => ({
      shortcuts: {},

      setShortcut: async (action, shortcut) => {
        const prev = get().shortcuts[action];
        if (prev) {
          try { await invoke('unregister_global_shortcut', { shortcut: prev }); } catch {}
        }
        if (shortcut) {
          try {
            await invoke('register_global_shortcut', { shortcut, action });
            set(s => ({ shortcuts: { ...s.shortcuts, [action]: shortcut } }));
          } catch (e) {
            console.warn('[GlobalShortcuts] Failed to register:', shortcut, e);
          }
        } else {
          set(s => {
            const next = { ...s.shortcuts };
            delete next[action];
            return { shortcuts: next };
          });
        }
      },

      registerAll: async () => {
        if (_registerAllCalled) return;
        _registerAllCalled = true;
        const { shortcuts } = get();
        for (const [action, shortcut] of Object.entries(shortcuts)) {
          if (shortcut) {
            try {
              await invoke('register_global_shortcut', { shortcut, action });
            } catch (e) {
              console.warn('[GlobalShortcuts] Failed to re-register:', shortcut, e);
            }
          }
        }
      },

      resetAll: async () => {
        const { shortcuts } = get();
        for (const shortcut of Object.values(shortcuts)) {
          if (shortcut) {
            try { await invoke('unregister_global_shortcut', { shortcut }); } catch {}
          }
        }
        set({ shortcuts: {} });
      },
    }),
    { name: 'psysonic_global_shortcuts' }
  )
);
