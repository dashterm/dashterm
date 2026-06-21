/**
 * GET /connect — an unauthenticated "connect a phone" page.
 *
 * Shows the gateway's reachable URL (reachableUrl(config), driven by
 * DASHTERM_PUBLIC_URL) as large text plus a QR code, so the native DashTerm
 * app can scan it instead of typing the URL. Server-rendered with an inline
 * SVG QR — no client JS, no CDN, works before login. The headless equivalent
 * is `dashterm qr`.
 */

import type { FastifyInstance } from 'fastify';
import QRCode from 'qrcode';
import { type GatewayConfig, reachableUrl } from '../config';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function page(url: string, svg: string): string {
  const safeUrl = escapeHtml(url);
  const local = /^https?:\/\/(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(
    url,
  );
  const note = local
    ? `<p class="note warn">⚠ This is a local-network address. It only works when your phone is on
       the same network. Set <code>DASHTERM_PUBLIC_URL</code> to a URL reachable from anywhere
       (e.g. a Tailscale <code>serve</code>/<code>funnel</code> <code>*.ts.net</code> address) and reload.</p>`
    : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Connect to DashTerm</title>
<style>
  :root { color-scheme: dark; }
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
    background:#0a0a0a; color:#00ffff; font-family:'Courier New', monospace; }
  .card { text-align:center; padding:32px; border:1px solid #00ffff; max-width:420px; }
  h1 { color:#00ff00; letter-spacing:4px; margin:0 0 4px; font-size:28px; }
  .sub { color:#00ffff; font-size:13px; margin:0 0 24px; }
  .qr { background:#fff; padding:14px; display:inline-block; border-radius:6px; }
  .qr svg { display:block; width:280px; height:280px; }
  .url { margin:22px 0 6px; font-size:15px; color:#00ff00; word-break:break-all; }
  .hint { font-size:12px; color:#557777; line-height:1.5; }
  .note { font-size:12px; line-height:1.5; margin-top:18px; }
  .warn { color:#ffff00; }
  code { color:#aaffff; }
</style>
</head>
<body>
  <div class="card">
    <h1>DASHTERM</h1>
    <p class="sub">+-- CONNECT A PHONE --+</p>
    <div class="qr">${svg || '<p style="color:#a00">QR unavailable</p>'}</div>
    <p class="url">${safeUrl}</p>
    <p class="hint">Open the DashTerm app → Scan QR code, or type the URL above.</p>
    ${note}
  </div>
</body>
</html>`;
}

export async function registerConnectRoutes(app: FastifyInstance, config: GatewayConfig) {
  app.get('/connect', async (_req, reply) => {
    const url = reachableUrl(config);
    let svg = '';
    try {
      svg = await QRCode.toString(url, { type: 'svg', margin: 1, color: { dark: '#000', light: '#fff' } });
    } catch {
      svg = '';
    }
    return reply.type('text/html').send(page(url, svg));
  });
}
