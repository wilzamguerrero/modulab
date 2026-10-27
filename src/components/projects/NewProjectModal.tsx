import { useMemo, useState } from 'react';
import { ArrowRight, Check, Cloud, FileJson, LayoutTemplate, Loader2, Sparkles } from 'lucide-react';
import { Button, Field, Modal, Segmented, Switch, TextInput } from '@/components/ui';
import { MiniPlan } from '@/components/ui/MiniPlan';
import { TEMPLATES, type TemplateId } from '@/data/templates';
import type { Project } from '@/types/project';
import { createAndSaveProject, saveProjectToNotion } from '@/services/projects/projectService';
import { useUiStore } from '@/store/uiStore';

export function NewProjectModal({
  open,
  onClose,
  onCreated,
  notionConfigured,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (project: Project) => void;
  notionConfigured: boolean;
}) {
  const toast = useUiStore((state) => state.toast);
  const [name, setName] = useState('');
  const [event, setEvent] = useState('');
  const [description, setDescription] = useState('');
  const [template, setTemplate] = useState<TemplateId>('rectangle');
  const [saveToNotion, setSaveToNotion] = useState(notionConfigured);
  const [creating, setCreating] = useState(false);

  const selectedTemplate = useMemo(
    () => TEMPLATES.find((entry) => entry.id === template) ?? TEMPLATES[0],
    [template],
  );

  const reset = () => {
    setName('');
    setEvent('');
    setDescription('');
    setTemplate('rectangle');
    setSaveToNotion(notionConfigured);
    setCreating(false);
  };

  const create = async () => {
    if (!name.trim()) {
      toast('Ponle un nombre al proyecto.', 'warning');
      return;
    }
    setCreating(true);
    try {
      let project = await createAndSaveProject({
        name: name.trim(),
        event: event.trim(),
        description: description.trim(),
        template,
      });
      if (saveToNotion && notionConfigured) {
        try {
          project = await saveProjectToNotion(project);
          toast('Proyecto creado y guardado en Notion.', 'success');
        } catch (error) {
          toast(
            `El proyecto se creó localmente, pero no se pudo guardar en Notion: ${(error as Error).message}`,
            'warning',
          );
        }
      } else {
        toast('Proyecto creado.', 'success');
      }
      onCreated(project);
      reset();
      onClose();
    } catch (error) {
      toast((error as Error).message, 'error');
    } finally {
      setCreating(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => { reset(); onClose(); }}
      title="Nuevo espacio expositivo"
      subtitle="Elige una planta de partida. Podrás editar cada vértice y muro después."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={() => { reset(); onClose(); }}>Cancelar</Button>
          <Button variant="primary" onClick={create} loading={creating} icon={<Sparkles size={16} />}>
            Crear proyecto
          </Button>
        </>
      }
    >
      <div className="grid-2">
        <Field label="Nombre del proyecto">
          <TextInput
            autoFocus
            placeholder="Muestra de grado 2026"
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') create(); }}
          />
        </Field>
        <Field label="Evento o materia">
          <TextInput
            placeholder="MAD · Universidad de Nariño"
            value={event}
            onChange={(event) => setEvent(event.target.value)}
          />
        </Field>
      </div>

      <Field label="Descripción breve" hint="Opcional. Aparecerá en la ficha del proyecto.">
        <TextInput
          placeholder="Distribución de stands y recorrido para la muestra."
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </Field>

      <div>
        <div className="panel-title" style={{ marginBottom: 8 }}>
          <span>Planta inicial</span>
          <small>{selectedTemplate.description}</small>
        </div>
        <div className="template-grid">
          {TEMPLATES.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={`template-card${entry.id === template ? ' is-active' : ''}`}
              onClick={() => setTemplate(entry.id)}
            >
              <MiniPlan vertices={entry.vertices} accent={entry.id === template ? 'var(--accent)' : 'rgba(255,255,255,.45)'} />
              <strong>{entry.name}</strong>
              <span>{entry.vertices.length ? `${entry.vertices.length} vértices` : 'Lienzo vacío'}</span>
            </button>
          ))}
        </div>
      </div>

      {notionConfigured ? (
        <div className="hint-box" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <strong>Guardar en Notion</strong>
            <div style={{ marginTop: 2 }}>Crea un toggle en tu página padre y guarda los datos editables.</div>
          </div>
          <Switch checked={saveToNotion} onChange={setSaveToNotion} label="" />
        </div>
      ) : null}
    </Modal>
  );
}
