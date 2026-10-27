import { useId, useMemo } from 'react';
import type { Project, Vec2 } from '@/types/project';
import { polygonBounds, polygonCentroid } from '@/utils/geometry';

export function MiniPlan({
  project,
  vertices,
  className,
  showObjects = false,
  accent = 'var(--accent)',
}: {
  project?: Project;
  vertices?: Vec2[];
  className?: string;
  showObjects?: boolean;
  accent?: string;
}) {
  const patternId = useId().replace(/:/g, '');
  const points = vertices ?? project?.floor.vertices ?? [];
  const bounds = useMemo(() => polygonBounds(points), [points]);
  const center = useMemo(() => (points.length ? polygonCentroid(points) : { x: 0, z: 0 }), [points]);
  const padding = Math.max(bounds.width, bounds.depth) * 0.12 + 1;
  const viewWidth = Math.max(bounds.width + padding * 2, 4);
  const viewHeight = Math.max(bounds.depth + padding * 2, 4);
  const viewX = bounds.minX - padding;
  const viewY = bounds.minZ - padding;

  return (
    <svg
      className={className}
      viewBox={`${viewX} ${viewY} ${viewWidth} ${viewHeight}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="Vista de planta"
    >
      <defs>
        <pattern id={`grid-${patternId}`} width="1" height="1" patternUnits="userSpaceOnUse">
          <path d="M 1 0 L 0 0 0 1" fill="none" stroke="rgba(255,255,255,.07)" strokeWidth="0.02" />
        </pattern>
        <pattern id={`grid-major-${patternId}`} width="5" height="5" patternUnits="userSpaceOnUse">
          <path d="M 5 0 L 0 0 0 5" fill="none" stroke="rgba(255,255,255,.11)" strokeWidth="0.035" />
        </pattern>
      </defs>
      <rect
        x={viewX}
        y={viewY}
        width={viewWidth}
        height={viewHeight}
        fill={`url(#grid-${patternId})`}
      />
      <rect
        x={viewX}
        y={viewY}
        width={viewWidth}
        height={viewHeight}
        fill={`url(#grid-major-${patternId})`}
      />
      {points.length >= 3 ? (
        <>
          <polygon
            points={points.map((point) => `${point.x},${point.z}`).join(' ')}
            fill="rgba(215,255,79,.11)"
            stroke={accent}
            strokeWidth="0.05"
            strokeLinejoin="round"
          />
          {project
            ? project.edges.map((edge, index) => {
                if (!edge.wall) return null;
                const a = points[index];
                const b = points[(index + 1) % points.length];
                return (
                  <line
                    key={edge.id}
                    x1={a.x}
                    y1={a.z}
                    x2={b.x}
                    y2={b.z}
                    stroke="rgba(255,255,255,.82)"
                    strokeWidth={Math.max(edge.thickness, 0.06)}
                    strokeLinecap="square"
                  />
                );
              })
            : null}
          {showObjects && project
            ? project.objects.map((object) => {
                const size = object.size ?? [0.8, 1, 0.8];
                const width = Math.max(size[0] * object.transform.scale[0], 0.15);
                const depth = Math.max(size[2] * object.transform.scale[2], 0.15);
                return (
                  <rect
                    key={object.id}
                    x={object.transform.position[0] - width / 2}
                    y={object.transform.position[2] - depth / 2}
                    width={width}
                    height={depth}
                    rx={0.05}
                    fill="rgba(255,255,255,.16)"
                    stroke="rgba(255,255,255,.45)"
                    strokeWidth="0.03"
                    transform={`rotate(${(object.transform.rotationY * 180) / Math.PI} ${object.transform.position[0]} ${object.transform.position[2]})`}
                  />
                );
              })
            : null}
          {showObjects && project
            ? project.exhibitors.map((exhibitor) => (
                <circle
                  key={exhibitor.id}
                  cx={exhibitor.position.x}
                  cy={exhibitor.position.z}
                  r={0.22}
                  fill={accent}
                  stroke="#0b0d0f"
                  strokeWidth="0.05"
                />
              ))
            : null}
        </>
      ) : (
        <g opacity="0.5">
          <circle cx={center.x} cy={center.z} r="0.35" fill={accent} />
          <text
            x={center.x}
            y={center.z + 1.4}
            textAnchor="middle"
            fill="rgba(255,255,255,.55)"
            fontSize={Math.max(viewWidth / 14, 0.5)}
            fontFamily="inherit"
          >
            Sin planta
          </text>
        </g>
      )}
    </svg>
  );
}
