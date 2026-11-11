import { describe, expect, it } from 'vitest';
import { mediaDisplayLabel, mediaOrdinals } from './mediaService';

/**
 * El visor de solo lectura numera los archivos por tipo y nunca muestra el
 * nombre técnico del archivo subido. Estas pruebas fijan ese contrato porque de
 * él depende que la ficha no revele `IMG_2026_final.jpg` al visitante.
 */
describe('etiquetas de archivos en el visor', () => {
  it('numera cada tipo por separado y en el orden del proyecto', () => {
    const items = [
      { id: 'a', kind: 'image' as const },
      { id: 'b', kind: 'video' as const },
      { id: 'c', kind: 'image' as const },
      { id: 'd', kind: 'pdf' as const },
      { id: 'e', kind: 'image' as const },
    ];
    const ordinals = mediaOrdinals(items);
    expect(ordinals.get('a')).toBe(1);
    expect(ordinals.get('b')).toBe(1);
    expect(ordinals.get('c')).toBe(2);
    expect(ordinals.get('d')).toBe(1);
    expect(ordinals.get('e')).toBe(3);
  });

  it('sin pie de foto usa «Imagen n» / «Vídeo n»', () => {
    expect(mediaDisplayLabel({ kind: 'image', caption: '' }, 2)).toBe('Imagen 2');
    expect(mediaDisplayLabel({ kind: 'video', caption: '' }, 3)).toBe('Vídeo 3');
    expect(mediaDisplayLabel({ kind: 'pdf', caption: '' }, 1)).toBe('PDF 1');
  });

  it('un pie de foto con espacios no cuenta como nombre', () => {
    expect(mediaDisplayLabel({ kind: 'image', caption: '   ' }, 4)).toBe('Imagen 4');
  });

  it('el pie de foto escrito por el autor manda sobre la numeración', () => {
    expect(mediaDisplayLabel({ kind: 'image', caption: 'Stands del pabellón A' }, 3)).toBe(
      'Stands del pabellón A',
    );
  });
});
