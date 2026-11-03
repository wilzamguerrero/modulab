import { useCallback, useEffect, useState } from 'react';
import { ExternalLink, Loader2, LogIn, RefreshCcw, ShieldCheck, Trash2 } from 'lucide-react';
import { Button, Modal, Spinner } from '@/components/ui';
import { useUiStore } from '@/store/uiStore';
import {
  clearNotionConfig,
  getNotionStatus,
  listNotionPages,
  selectNotionPage,
  startNotionOAuth,
} from '@/services/notion/notionService';
import type { NotionConfigStatus, NotionPageOption } from '@/types/notion';

export function NotionSettingsModal() {
  const open = useUiStore((state) => state.notionModalOpen);
  const setOpen = useUiStore((state) => state.setNotionModalOpen);
  const toast = useUiStore((state) => state.toast);
  const [status, setStatus] = useState<NotionConfigStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [pages, setPages] = useState<NotionPageOption[] | null>(null);
  const [loadingPages, setLoadingPages] = useState(false);
  const [selectingId, setSelectingId] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    try {
      const next = await getNotionStatus();
      setStatus(next);
    } catch (error) {
      toast((error as Error).message, 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  const loadPages = useCallback(async () => {
    setLoadingPages(true);
    try {
      const response = await listNotionPages();
      setPages(response.pages);
      if (response.pages.length === 0) {
        toast('La integración no tiene acceso a ninguna página todavía.', 'warning');
      }
    } catch (error) {
      toast((error as Error).message, 'error');
    } finally {
      setLoadingPages(false);
    }
  }, [toast]);

  useEffect(() => {
    if (!open) return;
    setPages(null);
    void loadStatus();
  }, [open, loadStatus]);

  // Tras autorizar, el servidor ya tiene token pero todavía no hay página
  // padre: se listan las páginas automáticamente para poder elegir una sin
  // volver a pasar por el flujo de autorización.
  useEffect(() => {
    if (!open || pages !== null) return;
    if (!status?.hasToken || status.parentPageId) return;
    void loadPages();
  }, [open, pages, status?.hasToken, status?.parentPageId, loadPages]);

  const pickPage = async (pageId: string) => {
    setSelectingId(pageId);
    try {
      const result = await selectNotionPage(pageId);
      const next = await getNotionStatus();
      setStatus(next);
      toast(
        `Proyectos se leerán de «${result.parentPageTitle || 'la página elegida'}».`,
        'success',
      );
      setOpen(false);
    } catch (error) {
      toast((error as Error).message, 'error');
    } finally {
      setSelectingId(null);
    }
  };

  const disconnect = async () => {
    setLoading(true);
    try {
      await clearNotionConfig();
      setStatus({ configured: false, hasToken: false, parentPageId: '' });
      setPages(null);
      toast('Notion desconectado.', 'success');
    } catch (error) {
      toast((error as Error).message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const hasToken = Boolean(status?.hasToken);
  const connected = Boolean(status?.configured);
  const needsPage = hasToken && !connected;
  const oauthAvailable = status?.oauthAvailable ?? true;

  return (
    <Modal
      open={open}
      onClose={() => setOpen(false)}
      title="Notion"
      subtitle="Elige con qué página de Notion trabajan tus proyectos y fichas."
      size="lg"
      footer={
        <>
          {hasToken ? (
            <Button variant="ghost" onClick={disconnect} icon={<Trash2 size={15} />} disabled={loading}>
              Desconectar
            </Button>
          ) : null}
          <Button variant="ghost" onClick={() => setOpen(false)}>Cerrar</Button>
          {oauthAvailable ? (
            <Button
              variant={hasToken ? 'outline' : 'primary'}
              onClick={startNotionOAuth}
              icon={<LogIn size={16} />}
            >
              {hasToken ? 'Autorizar otra vez' : 'Conectar con Notion'}
            </Button>
          ) : null}
        </>
      }
    >
      {loading ? (
        <div className="settings-status"><Loader2 size={16} className="spin" /> Comprobando conexión…</div>
      ) : connected ? (
        <div className="settings-status is-ok">
          <ShieldCheck size={16} />
          <span>
            Conectado{status?.workspaceName ? ` a ${status.workspaceName}` : ''} · página{' '}
            <strong>{status?.parentPageTitle || status?.parentPageId}</strong>
          </span>
        </div>
      ) : needsPage ? (
        <div className="settings-status is-ok">
          <ShieldCheck size={16} />
          <span>
            Notion autorizado{status?.workspaceName ? ` en ${status.workspaceName}` : ''}. Ahora elige
            la página que será la raíz de tus proyectos.
          </span>
        </div>
      ) : (
        <div className="settings-status">
          <LogIn size={16} />
          <span>Todavía no hay una cuenta de Notion conectada.</span>
        </div>
      )}

      {status?.error ? <div className="settings-status is-error">{status.error}</div> : null}

      {!oauthAvailable ? (
        <div className="settings-status is-error">
          El servidor no tiene configurados <span className="code">NOTION_CLIENT_ID</span> y{' '}
          <span className="code">NOTION_CLIENT_SECRET</span>. Añádelos como variables de entorno
          (locales en <span className="code">.env</span>, en producción en Cloudflare Pages).
        </div>
      ) : null}

      {hasToken ? (
        <>
          <div className="row-between">
            <span className="panel-note">Página padre de proyectos</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={loadPages}
              loading={loadingPages}
              icon={<RefreshCcw size={14} />}
            >
              {pages ? 'Actualizar' : needsPage ? 'Ver páginas' : 'Elegir otra página'}
            </Button>
          </div>

          {pages ? (
            pages.length === 0 ? (
              <div className="hint-box">
                La integración no ve ninguna página. En Notion, abre la página que quieras usar →
                <strong> ··· → Conexiones →</strong> tu integración, y vuelve a pulsar «Actualizar».
              </div>
            ) : (
              <div className="notion-page-list">
                {pages.map((page) => (
                  <button
                    key={page.id}
                    type="button"
                    className={`notion-page-item${page.id === status?.parentPageId ? ' is-active' : ''}`}
                    onClick={() => pickPage(page.id)}
                    disabled={Boolean(selectingId)}
                  >
                    <span className="notion-page-title">{page.title}</span>
                    {selectingId === page.id ? (
                      <Loader2 size={14} className="spin" />
                    ) : page.id === status?.parentPageId ? (
                      <span className="notion-page-badge">En uso</span>
                    ) : null}
                  </button>
                ))}
              </div>
            )
          ) : loadingPages ? (
            <div style={{ padding: 20 }}><Spinner label="Leyendo páginas de Notion…" /></div>
          ) : (
            <div className="hint-box">
              La página que elijas será la raíz: cada <strong>toggle</strong> o página hija dentro de
              ella se mostrará como un proyecto de Modulab.
            </div>
          )}
        </>
      ) : (
        <ol className="settings-steps">
          <li>Pulsa <strong>Conectar con Notion</strong> y autoriza la integración en Notion.</li>
          <li>Vuelve aquí: Modulab habrá recibido el permiso sin pedirte ningún token.</li>
          <li>
            Pulsa <strong>Elegir otra página</strong> y selecciona la página que será la raíz de tus
            proyectos.
          </li>
        </ol>
      )}

      <div className="hint-box">
        <strong>Para las personas:</strong> dentro de un proyecto puedes crear un toggle llamado
        <strong> «Personas»</strong> y, dentro, un toggle por expositor. Modulab leerá el título, la
        descripción, las imágenes y líneas como <span className="code">Stand: A-01</span> o
        <span className="code"> Proyecto: …</span>. La sincronización se hace desde el panel de
        expositores.
      </div>

      <div className="hint-box">
        El permiso se guarda en el servidor. Si algún día quieres revocarlo, hazlo también desde{' '}
        <a href="https://www.notion.so/my-integrations" target="_blank" rel="noreferrer" className="code">
          notion.so/my-integrations <ExternalLink size={10} />
        </a>
        .
      </div>
    </Modal>
  );
}
