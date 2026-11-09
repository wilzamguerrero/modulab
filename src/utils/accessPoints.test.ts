import { describe, expect, it } from 'vitest';
import {
  ACCESS_KIND_COLORS,
  accessColor,
  accessKindLabel,
  accessShowsKindLabel,
  accessTitle,
} from './accessPoints';

describe('banderas de acceso', () => {
  it('usa el color y la etiqueta sugeridos por el tipo', () => {
    expect(accessColor({ kind: 'entrance' })).toBe(ACCESS_KIND_COLORS.entrance);
    expect(accessColor({ kind: 'exit' })).toBe(ACCESS_KIND_COLORS.exit);
    expect(accessColor({ kind: 'both' })).toBe(ACCESS_KIND_COLORS.both);
    expect(accessKindLabel('exit')).toBe('Salida');
  });

  it('respeta el color propio y usa el nombre del tipo como etiqueta', () => {
    expect(accessColor({ kind: 'exit', color: '#123456' })).toBe('#123456');
    expect(accessTitle({ kind: 'both', name: '  ' })).toBe('Entrada y salida');
    expect(accessShowsKindLabel({ kind: 'both', name: 'Entrada y salida' })).toBe(false);
    expect(accessShowsKindLabel({ kind: 'entrance', name: 'Puerta norte' })).toBe(true);
  });
});
