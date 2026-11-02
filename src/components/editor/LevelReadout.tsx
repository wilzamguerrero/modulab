import { useMemo } from 'react';
import type { Level } from '@/types/project';
import { useEditorStore } from '@/store/editorStore';
import { levelPivot } from '@/utils/levelTransform';

/** Grados con un decimal, sin ceros de relleno: 12°, -7.5°. */
export function formatDegrees(radians: number, decimals = 1): string {
  const degrees = (radians * 180) / Math.PI;
  const fixed = degrees.toFixed(decimals);
  return `${fixed.replace(/\.?0+$/, '') || '0'}°`;
}

/**
 * Lectura numérica del piso mientras se mueve o se gira.
 *
 * El gizmo solo era visual: no se sabía cuánto se había desplazado ni cuántos
 * grados se llevaban girados. Aquí se muestra el centro actual del piso (que es
 * el pivote del giro) y su ángulo acumulado; mientras se arrastra se añaden las
 * magnitudes del propio arrastre, así se puede corregir con precisión.
 */
export function LevelReadout({ level, inline = false }: { level: Level; inline?: boolean }) {
  const drag = useEditorStore((state) => state.levelDragReadout);
  // `previewLevelTransform` ya deja el proyecto con el desplazamiento y el giro
  // aplicados en cada frame, así que el centro y el ángulo de aquí son siempre
  // los reales: no hay que sumar nada del arrastre (se contaría dos veces).
  const pivot = useMemo(() => levelPivot(level), [level]);
  const live = drag && drag.levelId === level.id ? drag : null;

  return (
    <div className={`level-readout${inline ? ' is-inline' : ''}${live ? ' is-live' : ''}`}>
      <span>
        Centro
        <strong>
          {pivot.x.toFixed(2)} · {pivot.z.toFixed(2)} m
        </strong>
      </span>
      <span>
        Giro
        <strong>{formatDegrees(level.rotation ?? 0)}</strong>
      </span>
      {live ? (
        <span className="level-readout-delta">
          En curso
          <strong>
            Δ {live.delta.x.toFixed(2)} · Δ {live.delta.z.toFixed(2)} m
            {Math.abs(live.angle) > 1e-9 ? ` · ${formatDegrees(live.angle)}` : ''}
          </strong>
        </span>
      ) : null}
    </div>
  );
}