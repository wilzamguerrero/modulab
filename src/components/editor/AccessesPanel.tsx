import { CopyPlus, Eye, EyeOff, Flag, LogIn, LogOut, Trash2 } from 'lucide-react';
import type { AccessKind, Project, Vec2 } from '@/types/project';
import { Badge, Button, HelpButton, IconButton } from '@/components/ui';
import { useEditorStore } from '@/store/editorStore';
import { useUiStore } from '@/store/uiStore';
import { polygonBounds, polygonCentroid, pointInPolygon } from '@/utils/geometry';
import { getLevel, getSpace } from '@/utils/levels';
import {
  accessColor,
  accessKindLabel,
  accessTitle,
} from '@/utils/accessPoints';

function freePosition(vertices: Vec2[]): Vec2 {
  if (vertices.length < 3) return { x: 0, z: 0 };
  const center = polygonCentroid(vertices);
  if (pointInPolygon(center, vertices)) return center;
  return polygonBounds(vertices).center;
}

const KIND_ICONS: Record<AccessKind, typeof Flag> = {
  entrance: LogIn,
  exit: LogOut,
  both: Flag,
};

export function AccessesPanel({ project }: { project: Project }) {
  const toast = useUiStore((state) => state.toast);
  const setView = useEditorStore((state) => state.setView);
  const setSelection = useEditorStore((state) => state.setSelection);
  const addAccess = useEditorStore((state) => state.addAccess);
  const updateAccess = useEditorStore((state) => state.updateAccess);
  const duplicateAccess = useEditorStore((state) => state.duplicateAccess);
  const deleteAccess = useEditorStore((state) => state.deleteAccess);
  const activeLevelId = useEditorStore((state) => state.activeLevelId);
  const activeSpaceId = useEditorStore((state) => state.activeSpaceId);

  const add = (kind: AccessKind) => {
    const space = getSpace(getLevel(project, activeLevelId), activeSpaceId);
    const id = addAccess(freePosition(space?.vertices ?? []), kind);
    if (id) {
      setView('3d');
      toast(
        `${accessKindLabel(kind)} creada. Arrástrala a la puerta o edita su posición en el inspector.`,
        'success',
      );
    }
  };

  return (
    <div>
      <section className="panel-section">
        <div className="panel-title">
          <span><Flag size={12} /> Entradas y salidas</span>
          <span className="panel-title-actions">
            <HelpButton title="Entradas y salidas">
              <p>
                Las banderas de acceso marcan por dónde se entra y se sale del recinto. Son
                independientes de los expositores y se ven en el editor, en la planta y en el
                visor público.
              </p>
              <p>
                Cada bandera puede ser <strong>solo entrada</strong>, <strong>solo salida</strong> o
                <strong> entrada y salida</strong>. Duplica una bandera para tener la entrada y la
                salida en puertas distintas y cambia su tipo sin tocar la otra.
              </p>
              <p>
                La etiqueta y el color se editan en el inspector. La flecha del suelo indica el
                sentido del paso.
              </p>
            </HelpButton>
            <Badge tone={project.accesses.length ? 'accent' : 'neutral'}>
              {project.accesses.length}
            </Badge>
          </span>
        </div>
        <div className="inline-actions">
          <Button
            size="sm"
            variant="primary"
            onClick={() => add('entrance')}
            icon={<LogIn size={13} />}
          >
            Entrada
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => add('exit')}
            icon={<LogOut size={13} />}
          >
            Salida
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => add('both')}
            icon={<Flag size={13} />}
          >
            Ambas
          </Button>
        </div>
      </section>

      <section className="panel-section">
        <div className="panel-title">
          <span>Listado</span>
          <small>{project.accesses.length}</small>
        </div>
        <div className="stack">
          {project.accesses.map((access) => {
            const color = accessColor(access);
            const Icon = KIND_ICONS[access.kind];
            return (
              <article
                key={access.id}
                className="list-card"
                onClick={() => {
                  setSelection({ type: 'access', id: access.id });
                  setView('3d');
                }}
              >
                <div className="list-thumb" style={{ borderColor: color, color }}>
                  <Icon size={18} />
                </div>
                <div className="list-card-main">
                  <div className="list-card-title">
                    <span className="color-dot" style={{ background: color }} />
                    {accessTitle(access)}
                  </div>
                  <div className="list-card-sub">
                    {accessKindLabel(access.kind)}
                    {access.visible ? '' : ' · oculta'}
                  </div>
                </div>
                <IconButton
                  label={access.visible ? 'Ocultar acceso' : 'Mostrar acceso'}
                  icon={access.visible ? <Eye size={13} /> : <EyeOff size={13} />}
                  onClick={(event) => {
                    event.stopPropagation();
                    updateAccess(access.id, { visible: !access.visible });
                  }}
                />
                <IconButton
                  label="Duplicar acceso"
                  icon={<CopyPlus size={13} />}
                  onClick={(event) => {
                    event.stopPropagation();
                    const id = duplicateAccess(access.id);
                    if (id) toast('Acceso duplicado.', 'success');
                  }}
                />
                <IconButton
                  label="Eliminar acceso"
                  icon={<Trash2 size={13} />}
                  onClick={(event) => {
                    event.stopPropagation();
                    deleteAccess(access.id);
                    toast('Acceso eliminado.', 'success');
                  }}
                />
              </article>
            );
          })}
          {project.accesses.length === 0 ? (
            <div className="empty-state" style={{ padding: '20px 12px' }}>
              <Flag size={18} />
              <h3>Todavía no hay entradas ni salidas</h3>
              <p>
                Añade una bandera y arrástrala a la puerta. Puedes duplicarla para marcar la salida
                en otro sitio.
              </p>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
