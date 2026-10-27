import type { Env } from '../_shared/env';
import { jsonError } from '../_shared/env';
import { photoKey } from '../_shared/uploads';

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const filename = String(context.params.filename || '');
  if (!context.env.MODULAB_KV) {
    return jsonError(404, 'Almacenamiento de fotografías no disponible.');
  }
  const result = await context.env.MODULAB_KV.getWithMetadata<{ contentType?: string }>(
    photoKey(filename),
    'arrayBuffer',
  );
  if (!result.value) {
    return jsonError(404, 'Fotografía no encontrada.');
  }
  return new Response(result.value, {
    status: 200,
    headers: {
      'Content-Type': result.metadata?.contentType || 'image/jpeg',
      'Cache-Control': 'public, max-age=3600',
    },
  });
};
