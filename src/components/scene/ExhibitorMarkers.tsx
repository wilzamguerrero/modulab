import { Html } from '@react-three/drei';
import type { Exhibitor } from '@/types/project';

export function ExhibitorMarkers({
  exhibitors,
  selectedId,
  editor = false,
  onSelect,
}: {
  exhibitors: Exhibitor[];
  selectedId?: string | null;
  editor?: boolean;
  onSelect?: (id: string) => void;
}) {
  return (
    <group>
      {exhibitors
        .filter((exhibitor) => exhibitor.visible)
        .map((exhibitor) => {
          const selected = selectedId === exhibitor.id;
          const color = selected ? '#d7ff4f' : '#7dd3fc';
          return (
            <group
              key={exhibitor.id}
              position={[exhibitor.position.x, 0, exhibitor.position.z]}
              onClick={(event) => {
                if (!onSelect) return;
                event.stopPropagation();
                onSelect(exhibitor.id);
              }}
            >
              <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
                <ringGeometry args={selected ? [0.34, 0.46, 40] : [0.22, 0.3, 40]} />
                <meshBasicMaterial
                  color={color}
                  transparent
                  opacity={selected ? 0.95 : 0.55}
                  depthWrite={false}
                />
              </mesh>
              <mesh position={[0, 0.72, 0]}>
                <cylinderGeometry args={[0.012, 0.012, 1.44, 6]} />
                <meshBasicMaterial color={color} transparent opacity={0.5} depthWrite={false} />
              </mesh>
              <mesh position={[0, 1.48, 0]}>
                <sphereGeometry args={[selected ? 0.11 : 0.075, 16, 12]} />
                <meshBasicMaterial color={color} />
              </mesh>
              {selected ? (
                <pointLight color="#d7ff4f" intensity={0.8} distance={3.2} position={[0, 1.5, 0]} />
              ) : null}
              {editor ? (
                <Html
                  center
                  position={[0, 2.05, 0]}
                  distanceFactor={9}
                  style={{ pointerEvents: 'none' }}
                >
                  <div className={`marker-label${selected ? ' is-selected' : ''}`}>
                    <strong>{exhibitor.name || 'Expositor'}</strong>
                    {exhibitor.standCode ? <span>{exhibitor.standCode}</span> : null}
                  </div>
                </Html>
              ) : null}
            </group>
          );
        })}
    </group>
  );
}
