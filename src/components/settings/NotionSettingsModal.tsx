import { useEffect, useState } from 'react';
import { ExternalLink, KeyRound, Loader2, PlugZap, ShieldCheck, Trash2 } from 'lucide-react';
import { Button, Field, Modal, TextInput } from '@/components/ui';
import { useUiStore } from '@/store/uiStore';
import {
  clearNotionConfig,
  getNotionStatus,
  saveNotionConfig,
} from '@/services/notion/notionService';
import type { NotionConfigStatus } from '@/types/notion';

export function NotionSettingsModal() {
  const open = useUiStore((state) => state.notionModalOpen);
  const setOpen = useUiStore((state) => state.setNotionModalOpen);
  const toast = useUiStore((state) => state.toast);
  const [status, setStatus] = useState<NotionConfigStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [token, setToken] = useState('');
  const [parentPageId, setParentPageId] = useState('');

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    getNotionStatus()
      .then((next) => {
        setStatus(next);
        setParentPageId(next.parentPageId || '');
        setToken('');
      })
      .catch((error) => toast(error.message, 'error'))
      .finally(() => setLoading(false));
  }, [open, toast]);

  const save = async () => {
    if (!parentPageId.trim()) {
      toast('Indica la página padre de proyectos de Notion.', 'warning');
      return;
    }
    if (!token.trim() && !status?.hasToken) {
      toast('Indica el token de la integración de Notion.', 'warning');
      return;
    }
    setSaving(true);
    try {
      const next = await saveNotionConfig({
        notionSecret: token.trim() || undefined,
        parentPageId: parentPageId.trim(),
      });
      setStatus(next);
      setToken('');
      if (next.error) {
        toast(next.error, 'warning');
      } else {
        toast('Notion conectado correctamente.', 'success');
      }
    } catch (error) {
      toast((error as Error).message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const disconnect = async () => {
    setSaving(true);
    try {
      await clearNotionConfig();
      setStatus({ configured: false, hasToken: false, parentPageId: '' });
      setParentPageId('');
      setToken('');
      toast('Configuración de Notion eliminada.', 'success');
    } catch (error) {
      toast((error as Error).message, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => setOpen(false)}
      title="Conectar Notion"
      subtitle="Modulab usa Notion como archivo de proyectos y de fichas de expositores."
      size="lg"
      footer={
        <>
          {status?.configured ? (
            <Button variant="ghost" onClick={disconnect} icon={<Trash2 size={15} />} disabled={saving}>
              Desconectar
            </Button>
          ) : null}
          <Button variant="ghost" onClick={() => setOpen(false)}>Cerrar</Button>
          <Button variant="primary" onClick={save} loading={saving} icon={<PlugZap size={16} />}>
            Guardar conexión
          </Button>
        </>
      }
    >
      {loading ? (
        <div className="settings-status"><Loader2 size={16} className="spin" /> Comprobando conexión…</div>
      ) : status?.configured ? (
        <div className="settings-status is-ok">
          <ShieldCheck size={16} />
          <span>
            Conectado a <strong>{status.parentPageTitle || status.parentPageId}</strong>
            {status.maskedToken ? ` · token ${status.maskedToken}` : ''}
          </span>
        </div>
      ) : (
        <div className="settings-status">
          <KeyRound size={16} />
          <span>Todavía no hay una integración de Notion configurada.</span>
        </div>
      )}

      {status?.error ? <div className="settings-status is-error">{status.error}</div> : null}

      <ol className="settings-steps">
        <li>
          Crea una integración interna en{' '}
          <a href="https://www.notion.so/my-integrations" target="_blank" rel="noreferrer" className="code">
            notion.so/my-integrations <ExternalLink size={10} />
          </a>{' '}
          y copia su token secreto.
        </li>
        <li>
          Crea una página en Notion que será la <strong>página padre de proyectos</strong>. Dentro,
          cada proyecto será un bloque <strong>toggle</strong>.
        </li>
        <li>
          Comparte esa página con la integración: menú <strong>··· → Conexiones →</strong> tu integración.
        </li>
        <li>
          Pega el enlace de la página padre aquí. Modulab extrae el ID automáticamente del enlace.
        </li>
      </ol>

      <Field label="Token de integración" hint={status?.hasToken ? 'Déjalo vacío para conservar el token actual.' : 'Empieza por ntn_ o secret_.'}>
        <TextInput
          type="password"
          autoComplete="off"
          placeholder={status?.hasToken ? status.maskedToken || 'Token guardado' : 'ntn_…'}
          value={token}
          onChange={(event) => setToken(event.target.value)}
        />
      </Field>

      <Field label="Página padre de proyectos" hint="Pega la URL completa de Notion o solo el ID de la página.">
        <TextInput
          placeholder="https://www.notion.so/mi-espacio/Proyectos-1234…"
          value={parentPageId}
          onChange={(event) => setParentPageId(event.target.value)}
        />
      </Field>

      <div className="hint-box">
        <strong>Para las personas:</strong> dentro de un proyecto puedes crear un toggle llamado
        <strong> «Personas»</strong> y, dentro, un toggle por expositor. Modulab leerá el título, la
        descripción, las imágenes y líneas como <span className="code">Stand: A-01</span> o
        <span className="code"> Proyecto: …</span>. La sincronización se hace desde el panel de expositores.
      </div>
    </Modal>
  );
}
