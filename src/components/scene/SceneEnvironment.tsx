import { useEffect } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

/**
 * Iluminación de entorno suave y local (sin descargar HDR externos).
 *
 * RoomEnvironment aporta rellenos laterales y superiores que evitan que las
 * caras interiores de los muros queden casi negras cuando la luz direccional
 * llega desde fuera del recinto. No sustituye a las luces del proyecto: solo
 * completa sus reflejos y la iluminación difusa de los materiales PBR.
 */
export function SceneEnvironment({ intensity = 0.4 }: { intensity?: number }) {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);

  useEffect(() => {
    const generator = new THREE.PMREMGenerator(gl);
    const room = new RoomEnvironment();
    const target = generator.fromScene(room, 0.04);

    scene.environment = target.texture;
    scene.environmentIntensity = intensity;
    room.dispose();
    generator.dispose();

    return () => {
      if (scene.environment === target.texture) {
        scene.environment = null;
      }
      target.dispose();
    };
  }, [gl, scene, intensity]);

  return null;
}
