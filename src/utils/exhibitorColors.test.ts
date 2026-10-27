import { describe, expect, it } from 'vitest';
import { createProject } from '@/data/defaults';
import {
  DEFAULT_EXHIBITOR_COLOR,
  exhibitorColor,
  exhibitorPaintAmount,
  hexToRgba,
  mixHexColors,
  paintedExhibitorColor,
} from './exhibitorColors';

function projectWithExhibitor() {
  const project = createProject({ name: 'Colores' });
  project.exhibitors = [
    {
      id: 'exp_1',
      name: 'Expositor',
      standCode: '',
      description: '',
      color: '#ff0000',
      position: { x: 0, z: 0 },
      rotation: 0,
      cameraPosition: [4, 2, 4],
      cameraTarget: [0, 1, 0],
      relatedObjectIds: [],
      visible: true,
      metadata: {},
      notionMissing: false,
    },
  ];
  return project;
}

describe('colores de expositores', () => {
  it('usa un color por defecto cuando la ficha no lo define', () => {
    expect(exhibitorColor({ color: undefined })).toBe(DEFAULT_EXHIBITOR_COLOR);
    expect(exhibitorColor({ color: '#123456' })).toBe('#123456');
  });

  it('mezcla colores y devuelve rgba', () => {
    expect(mixHexColors('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(mixHexColors('#ff0000', '#0000ff', 0)).toBe('#ff0000');
    expect(hexToRgba('#ff0000', 0.5)).toBe('rgba(255, 0, 0, 0.5)');
  });

  it('solo pinta en los modos de pintura, pero resalta la selección', () => {
    const project = projectWithExhibitor();
    project.settings.exhibitorColorOpacity = 0.4;
    project.settings.exhibitorColorMode = 'rings';
    expect(exhibitorPaintAmount(project, 'exp_1')).toBe(0);
    expect(exhibitorPaintAmount(project, 'exp_1', 'exp_1')).toBe(0.55);
    project.settings.exhibitorColorMode = 'paint';
    expect(exhibitorPaintAmount(project, 'exp_1')).toBe(0.4);
    expect(exhibitorPaintAmount(project, 'exp_inexistente')).toBe(0);
  });

  it('tiñe un color base con el color del expositor', () => {
    const project = projectWithExhibitor();
    project.settings.exhibitorColorMode = 'paint';
    project.settings.exhibitorColorOpacity = 0.5;
    expect(paintedExhibitorColor(project, 'exp_1', '#000000')).toBe('#800000');
    expect(paintedExhibitorColor(project, null, '#abcdef')).toBe('#abcdef');
  });
});
