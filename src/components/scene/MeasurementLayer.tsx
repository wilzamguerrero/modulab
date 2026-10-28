import type { CSSProperties } from 'react';
import { Html, Line } from '@react-three/drei';
import { type MeasureAxis, useEditorStore } from '@/store/editorStore';

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

const AXIS_COLOR: Record<MeasureAxis, string> = {
  none: '#d7ff4f',
  x: '#ff8a8a',
  y: '#7dff9c',
  z: '#7db8ff',
};

const AXIS_LABEL: Record<MeasureAxis, string> = {
  none: 'libre',
  x: 'ancho · X',
  y: 'alto · Y',
  z: 'fondo · Z',
};

function distanceLabel(a: [number, number, number], b: [number, number, number]): string {
  return Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]).toFixed(2);
}

/** Dibuja las medidas (línea entre A y B + etiqueta) y la guía en vivo. */
export function MeasurementLayer() {
  const measurements = useEditorStore((state) => state.measurements);
  const pending = useEditorStore((state) => state.measurePending);
  const hover = useEditorStore((state) => state.measureHover);
  const axis = useEditorStore((state) => state.measureAxis);
  const axisColor = AXIS_COLOR[axis];

  const mid = (a: [number, number, number], b: [number, number, number]): [number, number, number] => [
    (a[0] + b[0]) / 2,
    (a[1] + b[1]) / 2,
    (a[2] + b[2]) / 2,
  ];

  return (
    <group userData={{ measureHelper: true }}>
      {measurements.map((m) => {
        const a = m.a;
        const b = m.b;
        return (
          <group key={m.id}>
            <Line points={[a, b]} color="#d7ff4f" lineWidth={2} />
            {[a, b].map((point, index) => (
              <mesh key={index} position={point}>
                <sphereGeometry args={[0.05, 12, 12]} />
                <meshBasicMaterial color="#d7ff4f" />
              </mesh>
            ))}
            <Html center position={mid(a, b)} zIndexRange={[120, 0]} style={{ pointerEvents: 'none' }}>
              <div style={LABEL_STYLE}>{distanceLabel(a, b)} m</div>
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

      {pending && hover ? (
        <group>
          <Line
            points={[pending, hover]}
            color={axisColor}
            lineWidth={1.8}
            dashed
            dashSize={0.08}
            gapSize={0.05}
          />
          <mesh position={hover}>
            <sphereGeometry args={[0.055, 12, 12]} />
            <meshBasicMaterial color={axisColor} />
          </mesh>
          <Html center position={mid(pending, hover)} zIndexRange={[130, 0]} style={{ pointerEvents: 'none' }}>
            <div style={{ ...LABEL_STYLE, borderColor: axisColor, color: axisColor }}>
              {distanceLabel(pending, hover)} m · {AXIS_LABEL[axis]}
            </div>
          </Html>
        </group>
      ) : null}
    </group>
  );
}
