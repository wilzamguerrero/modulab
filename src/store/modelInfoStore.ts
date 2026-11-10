import { create } from 'zustand';
import type { ModelInfo, ModelMaterialSlot, PrimitiveShape, Vec3 } from '@/types/project';
import { getModelInfo } from '@/services/assets/modelLoader';

function primitiveInfo(shape: PrimitiveShape): ModelInfo {
  const names: Record<PrimitiveShape, string> = {
    box: 'Cubo',
    sphere: 'Esfera',
    cylinder: 'Cilindro',
    cone: 'Cono',
    spider: 'Araña con impreso',
  };
  // La araña tiene las medidas reales del producto (0.60 × 1.60 m).
  const size: Vec3 = shape === 'spider' ? [0.6, 1.6, 0.08] : [1, 1, 1];
  return {
    url: `primitive:${shape}`,
    size,
    offset: [0, 0.5, 0] as Vec3,
    materials: [
      {
        key: '0:Primitive',
        name: names[shape],
        color: '#d8d2c4',
        roughness: 0.65,
        metalness: 0.02,
      } satisfies ModelMaterialSlot,
    ],
  };
}

interface ModelInfoState {
  info: Record<string, ModelInfo>;
  loading: Record<string, boolean>;
  errors: Record<string, string>;
  ensure: (url: string) => Promise<ModelInfo | null>;
  register: (info: ModelInfo) => void;
  clear: () => void;
}

const pending = new Map<string, Promise<ModelInfo | null>>();

export const useModelInfoStore = create<ModelInfoState>()((set, get) => ({
  info: {},
  loading: {},
  errors: {},
  register: (info) =>
    set((state) => ({
      info: { ...state.info, [info.url]: info },
      errors: { ...state.errors, [info.url]: '' },
    })),
  ensure: async (url) => {
    if (url.startsWith('primitive:')) {
      const shape = url.split(':')[1] as PrimitiveShape;
      const info = primitiveInfo(shape);
      if (!get().info[url]) set((state) => ({ info: { ...state.info, [url]: info } }));
      return info;
    }
    const cached = get().info[url];
    if (cached) return cached;
    const existing = pending.get(url);
    if (existing) return existing;
    set((state) => ({ loading: { ...state.loading, [url]: true }, errors: { ...state.errors, [url]: '' } }));
    const promise = getModelInfo(url)
      .then((info) => {
        set((state) => ({
          info: { ...state.info, [url]: info },
          loading: { ...state.loading, [url]: false },
        }));
        return info;
      })
      .catch((error) => {
        set((state) => ({
          loading: { ...state.loading, [url]: false },
          errors: { ...state.errors, [url]: (error as Error).message || 'No se pudo cargar el modelo.' },
        }));
        return null;
      })
      .finally(() => {
        pending.delete(url);
      });
    pending.set(url, promise);
    return promise;
  },
  clear: () => set({ info: {}, loading: {}, errors: {} }),
}));

export function primitiveModelInfo(shape: PrimitiveShape): ModelInfo {
  return primitiveInfo(shape);
}
