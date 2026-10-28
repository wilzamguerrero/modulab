import { apiPost } from '@/services/api';

export type SplatFormat = 'ply' | 'splat' | 'ksplat';

export function detectSplatFormat(nameOrUrl: string): SplatFormat | undefined {
  const clean = (nameOrUrl.split('?')[0] || '').toLowerCase();
  if (clean.endsWith('.ply')) return 'ply';
  if (clean.endsWith('.splat')) return 'splat';
  if (clean.endsWith('.ksplat')) return 'ksplat';
  return undefined;
}

interface InitResponse {
  uploadId: string;
  mode: 'single_part' | 'multi_part';
  numberOfParts: number;
  chunkSize: number;
}

export interface UploadSplatResult {
  blockId: string;
  url: string;
}

/**
 * Sube un Gaussian splat a Notion troceándolo en partes de 10 MB. Cada parte se
 * reenvía tal cual desde la Function (sin parsear) para no exceder el límite de
 * CPU del plan gratuito de Cloudflare.
 */
export async function uploadSplatToNotion(
  file: File,
  options: { parentBlockId?: string; onProgress?: (ratio: number) => void } = {},
): Promise<UploadSplatResult> {
  const init = await apiPost<InitResponse>('/api/splat/init', {
    filename: file.name,
    contentType: file.type || 'application/octet-stream',
    sizeBytes: file.size,
  });

  for (let part = 1; part <= init.numberOfParts; part++) {
    const start = (part - 1) * init.chunkSize;
    const end = Math.min(start + init.chunkSize, file.size);
    const form = new FormData();
    if (init.mode === 'multi_part') form.append('part_number', String(part));
    form.append('file', file.slice(start, end), file.name);

    const response = await fetch(`/api/splat/part?upload_id=${encodeURIComponent(init.uploadId)}`, {
      method: 'POST',
      body: form,
    });
    if (!response.ok) {
      let message = `Error subiendo la parte ${part}/${init.numberOfParts}`;
      try {
        const data = (await response.json()) as { error?: string };
        if (data?.error) message = data.error;
      } catch {
        // Sin cuerpo JSON
      }
      throw new Error(message);
    }
    options.onProgress?.(part / init.numberOfParts);
  }

  return apiPost<UploadSplatResult>('/api/splat/complete', {
    uploadId: init.uploadId,
    mode: init.mode,
    parentBlockId: options.parentBlockId,
  });
}
