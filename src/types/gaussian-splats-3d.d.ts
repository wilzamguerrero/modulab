// Tipos mínimos para @mkkellogg/gaussian-splats-3d (la librería no incluye .d.ts).
declare module '@mkkellogg/gaussian-splats-3d' {
  import * as THREE from 'three';

  export enum SceneFormat {
    Ply = 0,
    Splat = 1,
    KSplat = 2,
  }

  export interface SplatSceneOptions {
    path?: string;
    format?: SceneFormat;
    showLoadingUI?: boolean;
    progressiveLoad?: boolean;
    splatAlphaRemovalThreshold?: number;
    position?: number[];
    rotation?: number[];
    scale?: number[];
    onProgress?: (percent: number) => void;
  }

  export interface DropInViewerOptions {
    sharedMemoryForWorkers?: boolean;
    gpuAcceleratedSort?: boolean;
    dynamicScene?: boolean;
    selfDrivenMode?: boolean;
    [key: string]: unknown;
  }

  export class DropInViewer extends THREE.Group {
    constructor(options?: DropInViewerOptions);
    viewer: {
      splatMesh?: THREE.Object3D;
      dispose?: () => void;
      [key: string]: unknown;
    };
    splatMesh: THREE.Object3D | null;
    addSplatScene(path: string, options?: SplatSceneOptions): Promise<void>;
    addSplatScenes(scenes: SplatSceneOptions[]): Promise<void>;
    dispose(): void;
  }

  export class Viewer {
    constructor(options?: Record<string, unknown>);
    dispose(): void;
  }
}
