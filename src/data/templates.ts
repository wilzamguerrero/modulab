import type { Vec2 } from '@/types/project';

export type TemplateId = 'rectangle' | 'l-shape' | 't-shape' | 'u-shape' | 'empty';

export interface TemplateDefinition {
  id: TemplateId;
  name: string;
  description: string;
  vertices: Vec2[];
}

export const TEMPLATES: TemplateDefinition[] = [
  {
    id: 'rectangle',
    name: 'Rectángulo',
    description: 'Un salón rectangular de 10 × 8 m.',
    vertices: [
      { x: -5, z: -4 },
      { x: 5, z: -4 },
      { x: 5, z: 4 },
      { x: -5, z: 4 },
    ],
  },
  {
    id: 'l-shape',
    name: 'Forma en L',
    description: 'Dos alas de 10 m y 8 m.',
    vertices: [
      { x: -5, z: -4 },
      { x: 5, z: -4 },
      { x: 5, z: 0 },
      { x: 0, z: 0 },
      { x: 0, z: 4 },
      { x: -5, z: 4 },
    ],
  },
  {
    id: 't-shape',
    name: 'Forma en T',
    description: 'Prueba de geometría cóncava de 12 × 9 m.',
    vertices: [
      { x: -6, z: -4 },
      { x: 6, z: -4 },
      { x: 6, z: 0 },
      { x: 2, z: 0 },
      { x: 2, z: 5 },
      { x: -2, z: 5 },
      { x: -2, z: 0 },
      { x: -6, z: 0 },
    ],
  },
  {
    id: 'u-shape',
    name: 'Forma en U',
    description: 'Recinto con patio central abierto.',
    vertices: [
      { x: -6, z: -4 },
      { x: 6, z: -4 },
      { x: 6, z: 4 },
      { x: 3, z: 4 },
      { x: 3, z: -1 },
      { x: -3, z: -1 },
      { x: -3, z: 4 },
      { x: -6, z: 4 },
    ],
  },
  {
    id: 'empty',
    name: 'Empezar de cero',
    description: 'Dibuja el contorno vértice por vértice.',
    vertices: [],
  },
];

export function getTemplate(id: TemplateId): TemplateDefinition {
  return TEMPLATES.find((template) => template.id === id) ?? TEMPLATES[0];
}
