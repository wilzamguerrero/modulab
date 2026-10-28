import type { CSSProperties } from 'react';
import { Html, Line } from '@react-three/drei';
import { useEditorStore } from '@/store/editorStore';

const LABEL_STYLE: CSSProperties = {
  background: 'rgba(10, 13, 16, 0.9)',
  border: '1px solid #d7ff4f',
  color: '#d7ff4f',
  padding: '1px 6px',
  borderRadius: 4,
  fontSize: 11,
  lineHeight: 1.2,
  whiteSpace: 'nowrap',
};

/** Dibuja las medidas (línea entre A y B + etiqueta con la distancia). */
export function MeasurementLayer() {
  const measurements = useEditorStore((state) => state.measurements);
  const pending = useEditorStore((state) => state.measurePending);

  return (
    <group userData={{ measureHelper: true }}>
      {measurements.map((m) => {
        const a = m.a;
        const b = m.b;
        const midpoint: [number, number, number] = [
          (a[0] + b[0]) / 2,
          (a[1] + b[1]) / 2,
          (a[2] + b[2]) / 2,
        ];
        const distance = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
        return (
          <group key={m.id}>
            <Line points={[a, b]} color="#d7ff4f" lineWidth={2} />
            {[a, b].map((point, index) => (
              <mesh key={index} position={point}>
                <sphereGeometry args={[0.05, 12, 12]} />
                <meshBasicMaterial color="#d7ff4f" />
              </mesh>
            ))}
            <Html center position={midpoint} zIndexRange={[120, 0]} style={{ pointerEvents: 'none' }}>
              <div style={LABEL_STYLE}>{distance.toFixed(2)} m</div>
            </Html>
          </group>
        );
      })}

      {pending ? (
        <mesh position={pending}>
          <sphereGeometry args={[0.08, 14, 14]} />
          <meshBasicMaterial color="#ffd34f" />
        </mesh>
      ) : null}
    </group>
  );
}
