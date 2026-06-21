/**
 * dashterm qr [--url URL]
 *
 * Prints an ASCII QR code of the gateway's reachable URL so you can scan it
 * from the DashTerm app on your phone — handy on a headless homelab box. The
 * URL comes from reachableUrl(config) (DASHTERM_PUBLIC_URL, else the bind host);
 * pass --url to override. The web equivalent is the gateway's /connect page.
 */
import qrcode from 'qrcode-terminal';
import { box, c, info, warn } from '../lib/log';
import { parseFlags } from '../lib/flags';
import { loadGatewayConfig } from '../lib/server';

const LOCAL_RE = /^https?:\/\/(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i;

export function qrCommand(args: string[]): Promise<number> {
  const { flags } = parseFlags(args);
  const override = typeof flags.url === 'string' ? flags.url : undefined;

  let url: string;
  try {
    url = (override ?? loadGatewayConfig().reachableUrl).replace(/\/+$/, '');
  } catch (e) {
    warn((e as Error).message);
    return Promise.resolve(1);
  }

  return new Promise((resolve) => {
    qrcode.generate(url, { small: true }, (q: string) => {
      info('');
      info(q);
      box(['Scan with the DashTerm app to connect', c.green(url)]);
      if (LOCAL_RE.test(url)) {
        info('');
        warn('This is a local-network address — it only works on the same network.');
        info(
          c.gray(
            'Set DASHTERM_PUBLIC_URL to a URL reachable from anywhere (e.g. a Tailscale serve/funnel *.ts.net address), then re-run.',
          ),
        );
      }
      resolve(0);
    });
  });
}
