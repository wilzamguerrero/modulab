import type { Env } from './_shared/env';

/**
 * Fallback SPA: sirve index.html para rutas de cliente (/editor/:id, /e/:id, /).
 * Deja pasar a Functions y assets estáticos (/api/*, /uploads/*, /catalog/*,
 * /assets/*, /draco/*, etc.).
 */
export const onRequest: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url);
  const { pathname } = url;

  if (pathname.startsWith('/api/') || pathname.startsWith('/uploads/')) {
    return context.next();
  }
  if (context.request.method !== 'GET' && context.request.method !== 'HEAD') {
    return context.next();
  }
  // Archivos con extensión: assets estáticos que debe resolver Pages.
  if (/\.[a-z0-9]+$/i.test(pathname)) {
    return context.next();
  }

  if (!context.env.ASSETS) return context.next();
  const asset = await context.env.ASSETS.fetch(new URL('/index.html', url).toString());
  if (!asset.ok) return context.next();
  return new Response(asset.body, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' },
  });
};
