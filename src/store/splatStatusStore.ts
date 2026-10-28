import { create } from 'zustand';

export type SplatStatus = 'idle' | 'loading' | 'ready' | 'error';

interface SplatStatusState {
  status: SplatStatus;
  progress: number;
  error?: string;
  setStatus: (status: SplatStatus, options?: { progress?: number; error?: string }) => void;
}

/** Estado compartido de carga del Gaussian splat (editor y visor público). */
export const useSplatStatus = create<SplatStatusState>((set) => ({
  status: 'idle',
  progress: 0,
  error: undefined,
  setStatus: (status, options) =>
    set({ status, progress: options?.progress ?? 0, error: options?.error }),
}));
