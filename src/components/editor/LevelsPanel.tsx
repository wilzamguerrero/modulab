import { useMemo, useState } from 'react';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Copy,
  CopyPlus,
  DoorOpen,
  Eye,
  EyeOff,
  Layers,
  Move,
  MoveDown,
  MoveUp,
  Plus,
  RotateCw,
  Trash2,
  Triangle,
} from 'lucide-react';
import type { Project } from '@/types/project';
import {
  Badge,
  Button,
  ConfirmDialog,
  Field,
  HelpButton,
  IconButton,
  NumberInput,
} from '@/components/ui';
import { useEditorStore } from '@/store/editorStore';
import { useUiStore } from '@/store/uiStore';
import { polygonArea, polygonCentroid, formatArea } from '@/utils/geometry';
import { levelContents } from '@/utils/levelTransform';
import { getLevel, getSpace, sortedLevels } from '@/utils/levels';

const STAIR_KIND_LABEL = { straight: 'Recta', l: 'En L', u: 'En U' } as const;

export function LevelsPanel({ project }: { project: Project }) {
  const toast = useUiStore((state) => state.toast);
  const activeLevelId = useEditorStore((state) => state.activeLevelId);
  const activeSpaceId = useEditorStore((state) => state.activeSpaceId);
  const setActiveLevel = useEditorStore((state) => state.setActiveLevel);
  const setActiveSpace = useEditorStore((state) => state.setActiveSpace);
  const addLevel = useEditorStore((state) => state.addLevel);
  const updateLevel = useEditorStore((state) => state.updateLevel);
  const deleteLevel = useEditorStore((state) => state.deleteLevel);
  const duplicateLevel = useEditorStore((state) => state.duplicateLevel);
  const deleteSpace = useEditorStore((state) => state.deleteSpace);
  const addStair = useEditorStore((state) => state.addStair);
  const deleteStair = useEditorStore((state) => state.deleteStair);
  const setSelection = useEditorStore((state) => state.setSelection);
  const setView = useEditorStore((state) => state.setView);
  const setTool = useEditorStore((state) => state.setTool);
  const setPlanDrawMode = useEditorStore((state) => state.setPlanDrawMode);
  const setLevelFloorThickness = useEditorStore((state) => state.setLevelFloorThickness);
  const levelGizmoId = useEditorStore((state) => state.levelGizmoId);
  const levelGizmoMode = useEditorStore((state) => state.levelGizmoMode);
  const setLevelGizmo = useEditorStore((state) => state.setLevelGizmo);

  const [confirmLevel, setConfirmLevel] = useState<string | null>(null);
  const [confirmSpace, setConfirmSpace] = useState<string | null>(null);
  /** Nivel cuyo menú de duplicado está abierto. */
  const [duplicateMenu, setDuplicateMenu] = useState<string | null>(null);

  const levels = useMemo(() => sortedLevels(project), [project]);
  const activeLevel = getLevel(project, activeLevelId);
  const activeSpace = getSpace(activeLevel, activeSpaceId);

  const levelObjects = confirmLevel
    ? project.objects.filter((object) => object.levelId === confirmLevel).length
    : 0;
  const levelExhibitors = confirmLevel
    ? project.exhibitors.filter((exhibitor) => exhibitor.levelId === confirmLevel).length
    : 0;

  const levelContentsSummary = useMemo(() => {
    if (!activeLevel) return '';
    const counts = levelContents(project, activeLevel.id);
    const parts = [
      `${counts.spaces} espacio(s)`,
      `${counts.walls} muro(s) libre(s)`,
      `${counts.holes} corte(s)`,
      `${counts.stairs} escalera(s)`,
      `${counts.objects} objeto(s)`,
      `${counts.exhibitors} expositor(es)`,
    ];
    return `Se moverá con el piso: ${parts.join(' · ')}.`;
  }, [activeLevel, project]);

  const duplicate = (levelId: string, levelName: string, placement: 'same' | 'above' | 'below') => {
    const id = duplicateLevel(levelId, { placement });
    setDuplicateMenu(null);
    if (!id) return;
    const where =
      placement === 'same'
        ? 'al lado, a la misma elevación'
        : placement === 'above'
          ? 'en un nivel superior'
          : 'en un nivel inferior';
    toast(`«${levelName}» duplicado ${where}.`, 'success');
  };

  const startNewSpace = () => {
    setView('plan');
    setPlanDrawMode('space');
    setTool('draw');
    setSelection(null);
  };

  const addStairAtCenter = () => {
    const target = activeSpace ?? activeLevel?.spaces[0];
    const position = target && target.vertices.length >= 3
      ? polygonCentroid(target.vertices)
      : { x: 0, z: 0 };
    const id = addStair(position);
    if (id) {
      setView('plan');
      toast('Escalera añadida. Ajusta escalones, altura y ancho en el inspector.', 'success');
    } else {
      toast('Añade o activa un nivel antes de colocar una escalera.', 'warning');
    }
  };

  return (
    <div>
      <section className="panel-section">
        <div className="panel-title">
          <span><Layers size={12} /> Niveles</span>
          <span className="panel-title-actions">
            <HelpButton title="Niveles y espacios">
              <p>
                Cada nivel es una planta con su propia elevación. Los niveles pueden ser
                superiores (positivos) o inferiores (negativos) y contienen varios espacios.
              </p>
              <p>
                Cambia de nivel con el selector superior o con Alt+↑ / Alt+↓. Usa Alt+← / Alt+→
                para cambiar de espacio.
              </p>
              <p>
                Al duplicar un nivel eliges dónde va la copia: al lado en la misma elevación
                (útil para repetir un piso en otra posición) o en un nivel superior o inferior.
              </p>
            </HelpButton>
            <Badge tone="neutral">{project.levels.length}</Badge>
          </span>
        </div>
        <div className="inline-actions">
          <Button
            size="sm"
            variant="outline"
            icon={<ArrowUpFromLine size={13} />}
            onClick={() => addLevel('above')}
          >
            Nivel superior
          </Button>
          <Button
            size="sm"
            variant="outline"
            icon={<ArrowDownToLine size={13} />}
            onClick={() => addLevel('below')}
          >
            Nivel inferior
          </Button>
        </div>
        <div className="segment-list">
          {levels.map((level) => {
            const isActive = level.id === activeLevel?.id;
            const spaceCount = level.spaces.length;
            const area = level.spaces.reduce(
              (total, space) => total + polygonArea(space.vertices),
              0,
            );
            return (
              <div className="segment-row is-stacked" key={level.id}>
                <button
                  type="button"
                  className={`segment-name${isActive ? ' is-wall' : ''}`}
                  onClick={() => {
                    setActiveLevel(level.id);
                    setView('plan');
                  }}
                  title="Activar nivel"
                >
                  <span className="segment-label">{level.name}</span>
                  <strong>{level.elevation.toFixed(2)} m</strong>
                </button>
                <div className="segment-meta">
                  <span className="chip is-active">{spaceCount} espacios</span>
                  <span className="chip">{formatArea(area)}</span>
                  <span className="segment-meta-actions">
                    <IconButton
                      label={level.visible ? 'Ocultar nivel' : 'Mostrar nivel'}
                      size="sm"
                      icon={level.visible ? <Eye size={12} /> : <EyeOff size={12} />}
                      onClick={() => updateLevel(level.id, { visible: !level.visible })}
                    />
                    <IconButton
                      label="Duplicar nivel"
                      size="sm"
                      icon={<Copy size={12} />}
                      onClick={() =>
                        setDuplicateMenu(duplicateMenu === level.id ? null : level.id)
                      }
                    />
                    <IconButton
                      label="Eliminar nivel"
                      size="sm"
                      icon={<Trash2 size={12} />}
                      disabled={project.levels.length <= 1}
                      onClick={() => setConfirmLevel(level.id)}
                    />
                  </span>
                </div>
                {duplicateMenu === level.id ? (
                  <div className="duplicate-menu">
                    <p className="duplicate-menu-title">
                      ¿Dónde colocar la copia de «{level.name}»?
                    </p>
                    <div className="duplicate-menu-actions">
                      <Button
                        size="sm"
                        variant="outline"
                        icon={<CopyPlus size={13} />}
                        onClick={() => duplicate(level.id, level.name, 'same')}
                      >
                        Mismo nivel, al lado
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        icon={<MoveUp size={13} />}
                        onClick={() => duplicate(level.id, level.name, 'above')}
                      >
                        Nivel superior
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        icon={<MoveDown size={13} />}
                        onClick={() => duplicate(level.id, level.name, 'below')}
                      >
                        Nivel inferior
                      </Button>
                    </div>
                    <p className="panel-note">
                      La copia incluye espacios, muros, escaleras y los objetos y expositores del
                      piso. En «mismo nivel» queda desplazada a un lado para poder reubicarla.
                    </p>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
        {activeLevel ? (
          <>
            <Field label="Elevación del nivel activo">
              <NumberInput
                value={activeLevel.elevation}
                onChange={(value) => updateLevel(activeLevel.id, { elevation: value })}
                step={0.1}
                suffix="m"
              />
            </Field>
            <Field label="Espesor del forjado del nivel">
              <NumberInput
                value={activeLevel.spaces[0]?.thickness ?? 0.2}
                onChange={(value) => setLevelFloorThickness(value)}
                min={0.02}
                max={2}
                step={0.01}
                suffix="m"
              />
            </Field>
            <p className="panel-note">
              El suelo es una losa maciza: la cara superior queda a la elevación del nivel y el
              canto cuelga este espesor. Se aplica a todos los espacios del nivel.
            </p>
            <div className="panel-title">
              <span><Move size={12} /> Mover el piso completo</span>
            </div>
            <p className="panel-note">
              Mueve o gira el nivel entero con todo lo que tiene encima (espacios, muros,
              huecos, escaleras, objetos y expositores). Útil para colocar un piso sobre otro.
            </p>
            <div className="inline-actions">
              <Button
                size="sm"
                variant={levelGizmoId === activeLevel.id && levelGizmoMode === 'translate' ? 'primary' : 'outline'}
                icon={<Move size={13} />}
                onClick={() => {
                  setView('3d');
                  setLevelGizmo(
                    levelGizmoId === activeLevel.id && levelGizmoMode === 'translate'
                      ? null
                      : activeLevel.id,
                    'translate',
                  );
                }}
              >
                Mover piso
              </Button>
              <Button
                size="sm"
                variant={levelGizmoId === activeLevel.id && levelGizmoMode === 'rotate' ? 'primary' : 'outline'}
                icon={<RotateCw size={13} />}
                onClick={() => {
                  setView('3d');
                  setLevelGizmo(
                    levelGizmoId === activeLevel.id && levelGizmoMode === 'rotate'
                      ? null
                      : activeLevel.id,
                    'rotate',
                  );
                }}
              >
                Girar piso
              </Button>
            </div>
            <p className="panel-note">
              {levelContentsSummary}
            </p>
          </>
        ) : null}
      </section>

      <section className="panel-section">
        <div className="panel-title">
          <span><DoorOpen size={12} /> Espacios del nivel</span>
          <span className="panel-title-actions">
            <small>{activeLevel?.name ?? '—'}</small>
          </span>
        </div>
        <div className="inline-actions">
          <Button
            size="sm"
            variant="primary"
            icon={<Plus size={13} />}
            onClick={startNewSpace}
            disabled={!activeLevel}
          >
            Añadir espacio
          </Button>
        </div>
        <div className="segment-list">
          {(activeLevel?.spaces ?? []).map((space, index) => {
            const isActive = space.id === activeSpace?.id;
            return (
              <div className="segment-row" key={space.id}>
                <button
                  type="button"
                  className={`segment-name${isActive ? ' is-wall' : ''}`}
                  onClick={() => {
                    setActiveSpace(space.id);
                    setView('plan');
                  }}
                  title="Activar espacio"
                >
                  <span
                    className="color-dot"
                    style={{ background: space.color }}
                  />
                  <span className="segment-label">
                    {space.name || `Espacio ${index + 1}`}
                  </span>
                  <strong>{formatArea(polygonArea(space.vertices))}</strong>
                </button>
                <IconButton
                  label="Eliminar espacio"
                  size="sm"
                  icon={<Trash2 size={12} />}
                  disabled={(activeLevel?.spaces.length ?? 0) <= 1}
                  onClick={() => setConfirmSpace(space.id)}
                />
              </div>
            );
          })}
          {(activeLevel?.spaces.length ?? 0) === 0 ? (
            <p className="panel-note">El nivel no tiene espacios. Dibuja uno para empezar.</p>
          ) : null}
        </div>
      </section>

      <section className="panel-section">
        <div className="panel-title">
          <span><Triangle size={12} /> Escaleras</span>
          <span className="panel-title-actions">
            <small>{activeLevel?.stairs.length ?? 0}</small>
          </span>
        </div>
        <div className="inline-actions">
          <Button
            size="sm"
            variant="outline"
            icon={<Plus size={13} />}
            onClick={addStairAtCenter}
            disabled={!activeLevel}
          >
            Añadir escalera
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setView('plan');
              setTool('stair');
            }}
            disabled={!activeLevel}
          >
            Colocar con clic
          </Button>
        </div>
        <div className="segment-list">
          {(activeLevel?.stairs ?? []).map((stair) => (
            <div className="segment-row is-stacked" key={stair.id}>
              <button
                type="button"
                className="segment-name"
                onClick={() => {
                  setView('plan');
                  setSelection({ type: 'stair', id: stair.id });
                }}
              >
                <span className="segment-label">{stair.name}</span>
                <strong>{STAIR_KIND_LABEL[stair.kind]}</strong>
              </button>
              <div className="segment-meta">
                <span className="chip">{stair.steps} peldaños</span>
                <span className="chip">{stair.rise.toFixed(2)} m</span>
                <span className="segment-meta-actions">
                  <IconButton
                    label="Eliminar escalera"
                    size="sm"
                    icon={<Trash2 size={12} />}
                    onClick={() => deleteStair(stair.id)}
                  />
                </span>
              </div>
            </div>
          ))}
          {(activeLevel?.stairs.length ?? 0) === 0 ? (
            <p className="panel-note">Aún no hay escaleras en este nivel.</p>
          ) : null}
        </div>
      </section>

      <ConfirmDialog
        open={Boolean(confirmLevel)}
        title="Eliminar nivel"
        message={
          <>
            Se eliminarán el nivel, sus espacios, muros, aberturas y escaleras, además de{' '}
            <strong>{levelObjects}</strong> objeto(s) y <strong>{levelExhibitors}</strong>{' '}
            expositor(es) situados en él. Esta acción se puede deshacer.
          </>
        }
        confirmLabel="Eliminar nivel"
        danger
        onConfirm={() => {
          if (confirmLevel) {
            deleteLevel(confirmLevel);
            toast('Nivel eliminado.', 'success');
          }
          setConfirmLevel(null);
        }}
        onCancel={() => setConfirmLevel(null)}
      />

      <ConfirmDialog
        open={Boolean(confirmSpace)}
        title="Eliminar espacio"
        message="Se eliminarán el contorno, sus muros y sus aberturas. Los objetos y expositores se conservan."
        confirmLabel="Eliminar espacio"
        danger
        onConfirm={() => {
          if (confirmSpace) deleteSpace(confirmSpace);
          setConfirmSpace(null);
        }}
        onCancel={() => setConfirmSpace(null)}
      />
    </div>
  );
}
