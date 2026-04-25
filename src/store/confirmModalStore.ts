import { create } from 'zustand';

let _resolve: ((accepted: boolean) => void) | null = null;

interface ConfirmRequest {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
}

interface ConfirmModalStore extends ConfirmRequest {
  isOpen: boolean;
  request: (req: ConfirmRequest) => Promise<boolean>;
  confirm: () => void;
  cancel: () => void;
}

export const useConfirmModalStore = create<ConfirmModalStore>(set => ({
  isOpen: false,
  title: '',
  message: '',
  confirmLabel: '',
  cancelLabel: undefined,
  danger: false,

  request: (req) =>
    new Promise<boolean>(resolve => {
      // If a previous prompt is still pending, treat the old one as cancelled.
      if (_resolve) _resolve(false);
      _resolve = resolve;
      set({ isOpen: true, ...req });
    }),

  confirm: () => {
    _resolve?.(true);
    _resolve = null;
    set({ isOpen: false });
  },

  cancel: () => {
    _resolve?.(false);
    _resolve = null;
    set({ isOpen: false });
  },
}));
