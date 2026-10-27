import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import type { LightConfig, ShadowQuality } from '@/types/project';
import { shadowMapSize } from '@/data/shadows';
import type { Bounds2D } from '@/utils/geometry';

function useTarget(position: LightConfig['target']) {
  const target = useMemo(() => new THREE.Object3D(), []);
  useEffect(() => {
    target.position.set(position[0], position[1], position[2]);
    target.updateMatrixWorld(true);
  }, [target, position]);
  return target;
}

const DEFAULT_SHADOW_BOUNDS: Bounds2D = {
  minX: -15,
  maxX: 15,
  minZ: -15,
  maxZ: 15,
  width: 30,
  depth: 30,
  center: { x: 0, z: 0 },
};

/**
 * Ajusta el frustum ortotográfico de la luz direccional al tamaño real de la
 * planta. Un frustum de 60×60 m con un mapa de 1024 px deja sombras muy
 * escalonadas; al ceñirlo al recinto se gana nitidez sin subir la resolución.
 */
function directionalShadowFrame(light: LightConfig, bounds: Bounds2D) {
  const halfExtent =
    Math.max(bounds.width, bounds.depth, 8) / 2 +
    4 +
    Math.hypot(light.target[0] - bounds.center.x, light.target[2] - bounds.center.z);
  const half = Math.min(120, halfExtent);
  const distance = Math.hypot(
    light.position[0] - light.target[0],
    light.position[1] - light.target[1],
    light.position[2] - light.target[2],
  );
  return {
    half,
    near: 0.1,
    far: Math.max(24, distance + half * 2 + 12),
  };
}

function DirectionalLight({
  light,
  mapSize,
  bounds,
}: {
  light: LightConfig;
  mapSize: number;
  bounds: Bounds2D;
}) {
  const target = useTarget(light.target);
  const shadow = useMemo(
    () => directionalShadowFrame(light, bounds),
    [
      bounds,
      light.position[0],
      light.position[1],
      light.position[2],
      light.target[0],
      light.target[1],
      light.target[2],
    ],
  );

  return (
    <>
      <primitive object={target} />
      <directionalLight
        color={light.color}
        intensity={light.intensity}
        position={light.position}
        target={target}
        castShadow={light.castShadow}
        shadow-mapSize-width={mapSize}
        shadow-mapSize-height={mapSize}
        shadow-camera-left={-shadow.half}
        shadow-camera-right={shadow.half}
        shadow-camera-top={shadow.half}
        shadow-camera-bottom={-shadow.half}
        shadow-camera-near={shadow.near}
        shadow-camera-far={shadow.far}
        shadow-bias={0}
        shadow-normalBias={0.025}
      />
    </>
  );
}

function SpotLight({ light, mapSize }: { light: LightConfig; mapSize: number }) {
  const target = useTarget(light.target);
  return (
    <>
      <primitive object={target} />
      <spotLight
        color={light.color}
        intensity={light.intensity}
        position={light.position}
        target={target}
        distance={light.distance}
        angle={light.angle ?? Math.PI / 5}
        penumbra={light.penumbra ?? 0.4}
        decay={2}
        castShadow={light.castShadow}
        shadow-mapSize-width={mapSize}
        shadow-mapSize-height={mapSize}
        shadow-camera-near={0.1}
        shadow-camera-far={light.distance ? Math.max(light.distance, 1) : 100}
        shadow-bias={0}
        shadow-normalBias={0.025}
      />
    </>
  );
}

function LightSource({
  light,
  mapSize,
  shadowBounds,
}: {
  light: LightConfig;
  mapSize: number;
  shadowBounds: Bounds2D;
}) {
  if (!light.enabled) return null;
  switch (light.type) {
    case 'ambient':
      return <ambientLight color={light.color} intensity={light.intensity} />;
    case 'hemisphere':
      return (
        <hemisphereLight
          color={light.color}
          groundColor="#3b4148"
          intensity={light.intensity}
          position={light.position}
        />
      );
    case 'directional':
      return <DirectionalLight light={light} mapSize={mapSize} bounds={shadowBounds} />;
    case 'point':
      return (
        <pointLight
          color={light.color}
          intensity={light.intensity}
          position={light.position}
          distance={light.distance}
          decay={2}
          castShadow={light.castShadow}
          shadow-mapSize-width={Math.min(mapSize, 2048)}
          shadow-mapSize-height={Math.min(mapSize, 2048)}
          shadow-camera-near={0.1}
          shadow-camera-far={light.distance ? Math.max(light.distance, 1) : 100}
          shadow-bias={0}
          shadow-normalBias={0.025}
        />
      );
    case 'spot':
      return <SpotLight light={light} mapSize={mapSize} />;
    default:
      return null;
  }
}

function LightMarker({
  light,
  selected,
  onClick,
}: {
  light: LightConfig;
  selected?: boolean;
  onClick?: () => void;
}) {
  const isAmbient = light.type === 'ambient' || light.type === 'hemisphere';
  const color = selected ? '#d7ff4f' : light.enabled ? '#ffe6a8' : '#5a646e';
  return (
    <group
      position={light.position}
      onClick={(event) => {
        if (!onClick) return;
        event.stopPropagation();
        onClick();
      }}
    >
      <mesh>
        <sphereGeometry args={[isAmbient ? 0.14 : 0.11, 16, 12]} />
        <meshBasicMaterial color={color} transparent opacity={light.enabled ? 0.95 : 0.45} />
      </mesh>
      <mesh>
        <sphereGeometry args={[selected ? 0.26 : 0.2, 16, 12]} />
        <meshBasicMaterial color={color} transparent opacity={selected ? 0.18 : 0.07} depthWrite={false} />
      </mesh>
      {selected ? (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
          <ringGeometry args={[0.28, 0.34, 32]} />
          <meshBasicMaterial color="#d7ff4f" transparent opacity={0.8} depthWrite={false} />
        </mesh>
      ) : null}
    </group>
  );
}

export function SceneLights({
  lights,
  editor = false,
  selectedLightId,
  onSelectLight,
  shadowQuality = 'medium',
  shadowBounds = DEFAULT_SHADOW_BOUNDS,
}: {
  lights: LightConfig[];
  editor?: boolean;
  selectedLightId?: string | null;
  onSelectLight?: (id: string) => void;
  shadowQuality?: ShadowQuality;
  shadowBounds?: Bounds2D;
}) {
  const capped = lights.slice(0, 16);
  const mapSize = shadowMapSize(shadowQuality);
  return (
    <group>
      {capped.map((light) => (
        <LightSource
          key={`source-${light.id}`}
          light={light}
          mapSize={mapSize}
          shadowBounds={shadowBounds}
        />
      ))}
      {editor
        ? capped.map((light) => (
            <LightMarker
              key={`marker-${light.id}`}
              light={light}
              selected={selectedLightId === light.id}
              onClick={onSelectLight ? () => onSelectLight(light.id) : undefined}
            />
          ))
        : null}
    </group>
  );
}
