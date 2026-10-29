import { create } from 'zustand';
import { createId } from '@/utils/id';

export type ToastKind = 'info' | 'success' | 'error' | 'warning';

export interface Toast {
  id: string;
  kind: ToastKind;
  message: string;
}

interface UiState {
  toasts: Toast[];
  notionModalOpen: boolean;
  shortcutsOpen: boolean;
  /** Cámara ortográfica (proyección casi paralela) en la vista 3D. */
  orthographic: boolean;
  toast: (message: string, kind?: ToastKind) => string;
  dismissToast: (id: string) => void;
  setNotionModalOpen: (open: boolean) => void;
  setShortcutsOpen: (open: boolean) => void;
  setOrthographic: (orthographic: boolean) => void;
}

export const useUiStore = create<UiState>()((set, get) => ({
  toasts: [],
  notionModalOpen: false,
  shortcutsOpen: false,
  orthographic: false,
  toast: (message, kind = 'info') => {
    const id = createId('toast');
    set((state) => ({ toasts: [...state.toasts.slice(-3), { id, kind, message }] }));
    window.setTimeout(() => get().dismissToast(id), kind === 'error' ? 6500 : 4200);
    return id;
  },
  dismissToast: (id) => set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),
  setNotionModalOpen: (notionModalOpen) => set({ notionModalOpen }),
  setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen }),
  setOrthographic: (orthographic) => set({ orthographic }),
}));
