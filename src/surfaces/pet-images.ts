import { Resvg } from '@resvg/resvg-js';
import { Hono } from 'hono';
import { drawPet } from '../pet/draw.js';

/** Public, deterministic artwork only. No user identifiers, memory, or credentials. */
export function petImageRoutes() {
  const routes = new Hono();
  const cache = new Map<number, ArrayBuffer>();
  routes.get('/:file', (c) => {
    const match = /^level-(\d{2})-sleepy\.png$/.exec(c.req.param('file'));
    if (!match || Number(match[1]) > 66) return c.notFound();
    const level = Number(match[1]);
    let png = cache.get(level);
    if (!png) {
      png = new Uint8Array(new Resvg(drawPet(level, 'sleepy')).render().asPng()).buffer;
      cache.set(level, png);
    }
    return c.body(png, 200, { 'content-type': 'image/png', 'cache-control': 'public, max-age=86400', 'x-content-type-options': 'nosniff' });
  });
  return routes;
}
