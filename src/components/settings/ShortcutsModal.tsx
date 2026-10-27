import { Modal } from '@/components/ui';
import { useUiStore } from '@/store/uiStore';

const SHORTCUTS: Array<[string, string]> = [
  ['V', 'Seleccionar'],
  ['D', 'Dibujar contorno o división'],
  ['M', 'Muro / acceso'],
  ['F', 'Muro libre'],
  ['P', 'Puerta'],
  ['N', 'Ventana'],
  ['E', 'Colocar expositor'],
  ['1', 'Vista de planta'],
  ['2', 'Vista 3D'],
  ['G', 'Mover objeto'],
  ['R', 'Rotar objeto'],
  ['S', 'Escalar objeto'],
  ['Supr', 'Eliminar selección'],
  ['Ctrl + D', 'Duplicar objeto'],
  ['Ctrl + C / V', 'Copiar / pegar objeto'],
  ['Ctrl + Z', 'Deshacer'],
  ['Ctrl + Y', 'Rehacer'],
  ['Ctrl + S', 'Guardar'],
  ['Esc', 'Cancelar herramienta o dibujo'],
];

export function ShortcutsModal() {
  const open = useUiStore((state) => state.shortcutsOpen);
  const setOpen = useUiStore((state) => state.setShortcutsOpen);
  return (
    <Modal
      open={open}
      onClose={() => setOpen(false)}
      title="Atajos del editor"
      subtitle="Todo se puede hacer también con los botones de la interfaz."
      size="md"
    >
      <div className="shortcut-grid">
        {SHORTCUTS.map(([keys, label]) => (
          <div key={keys} className="shortcut-row">
            <span className="shortcut-keys">
              {keys.split(' + ').map((key) => <span key={key} className="kbd">{key}</span>)}
            </span>
            <span>{label}</span>
          </div>
        ))}
      </div>
    </Modal>
  );
}
