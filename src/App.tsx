import { Component, lazy, Suspense, type ErrorInfo, type ReactNode } from 'react';
import { BrowserRouter, Link, Route, Routes } from 'react-router-dom';
import { AlertTriangle, Home } from 'lucide-react';
import { Toaster, Button, Spinner } from '@/components/ui';
import { NotionSettingsModal } from '@/components/settings/NotionSettingsModal';
import { ShortcutsModal } from '@/components/settings/ShortcutsModal';

const HomePage = lazy(() =>
  import('@/pages/HomePage').then((module) => ({ default: module.HomePage })),
);
const EditorPage = lazy(() =>
  import('@/pages/EditorPage').then((module) => ({ default: module.EditorPage })),
);
const PublicViewerPage = lazy(() =>
  import('@/pages/PublicViewerPage').then((module) => ({ default: module.PublicViewerPage })),
);

function RouteFallback() {
  return (
    <div className="viewer-loading">
      <Spinner label="Cargando Modulab…" />
    </div>
  );
}

class AppErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[modulab] Error de interfaz:', error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="viewer-loading">
          <div className="viewer-error">
            <div className="empty-icon"><AlertTriangle size={20} /></div>
            <h1>Algo se rompió en la interfaz</h1>
            <p>{this.state.error.message}</p>
            <div className="inline-actions">
              <Button variant="primary" onClick={() => window.location.reload()}>Recargar</Button>
              <Button variant="outline" onClick={() => { window.location.href = '/'; }} icon={<Home size={15} />}>
                Ir al inicio
              </Button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function NotFoundPage() {
  return (
    <div className="viewer-loading">
      <div className="viewer-error">
        <div className="empty-icon"><AlertTriangle size={20} /></div>
        <h1>Página no encontrada</h1>
        <p>La dirección no corresponde a ningún proyecto o publicación de Modulab.</p>
        <Link to="/"><Button variant="primary">Volver al inicio</Button></Link>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <AppErrorBoundary>
      <BrowserRouter>
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/editor/:projectId" element={<EditorPage />} />
            <Route path="/e/:publicId" element={<PublicViewerPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </Suspense>
        <NotionSettingsModal />
        <ShortcutsModal />
        <Toaster />
      </BrowserRouter>
    </AppErrorBoundary>
  );
}
