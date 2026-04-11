import { create } from 'zustand';

interface SelectionState {
  selectedIds: Set<string>;
  setSelectedIds: (update: (prev: Set<string>) => Set<string>) => void;
  clearAll: () => void;
}

export const useSelectionStore = create<SelectionState>((set) => ({
  selectedIds: new Set<string>(),
  setSelectedIds: (update) => set((s) => ({ selectedIds: update(s.selectedIds) })),
  clearAll: () => set({ selectedIds: new Set() }),
}));
