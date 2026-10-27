import { useEffect } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import { SoftShadows } from '@react-three/drei';
import type { ShadowQuality } from '@/types/project';

/**
 * Fuerza el mapa de sombras suave y, en calidades media/alta, activa PCSS
 * (contact-hardening soft shadows) de Drei. La calidad baja se queda con un
 * PCF suave normal para no castigar equipos modestos.
 */
export function SceneShadows({ quality }: { quality: ShadowQuality }) {
  const gl = useThree((state) => state.gl);

  useEffect(() => {
    if (quality !== 'low') {
      gl.shadowMap.needsUpdate = true;
      return;
    }
    // Se espera un frame para que el cleanup de SoftShadows (si venía de
    // calidad media/alta) haya restaurado su tipo antes de fijar PCF suave.
    const frame = requestAnimationFrame(() => {
      gl.shadowMap.type = THREE.PCFSoftShadowMap;
      gl.shadowMap.needsUpdate = true;
    });
    return () => cancelAnimationFrame(frame);
  }, [gl, quality]);

  if (quality === 'low') return null;

  return (
    <SoftShadows
      key={quality}
      size={quality === 'high' ? 28 : 18}
      samples={quality === 'high' ? 32 : 24}
      focus={0.5}
    />
  );
}
