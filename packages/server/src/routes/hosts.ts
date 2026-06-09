/**
 * /api/hosts — read-only host info for browser (vibe-coded) apps, run over the
 * per-user SSH keys managed in agent/sshHosts.ts. The probe command is FIXED
 * and the only user-controlled value (alias) is validated against the user's
 * own hosts before use, so this can't become an arbitrary-exec endpoint.
 *
 * Auth is the same cookie + JWT path as the rest of the API, so the probe runs
 * over *that* user's keys.
 */
import { execFile } from 'child_process';
import path from 'path';
import type { FastifyInstance } from 'fastify';
import { requireUser } from './auth';
import type { GatewayConfig } from '../config';
import { ensureSshScaffold, listHosts, sshBinDir } from '../agent/sshHosts';

// One line: now_epoch uptime_secs load1 load5 load15 hostname. Linux-only
// (/proc), which is what these hosts are. No user input reaches the shell.
const UPTIME_PROBE =
  "echo \"$(date +%s) $(cut -d' ' -f1 /proc/uptime) $(cut -d' ' -f1-3 /proc/loadavg) $(uname -n)\"";

interface UptimeResult {
  ok: boolean;
  bootEpoch?: number;
  uptimeSeconds?: number;
  load?: number[];
  hostname?: string | null;
  error?: string;
}

function sshUptime(config: GatewayConfig, uid: string, alias: string): Promise<UptimeResult> {
  return new Promise((resolve) => {
    const ssh = path.join(sshBinDir(config, uid), 'ssh'); // wrapper: ssh -F <managed config>
    execFile(ssh, [alias, UPTIME_PROBE], { timeout: 12000 }, (err, stdout, stderr) => {
      if (err) {
        return resolve({ ok: false, error: (stderr || err.message || 'ssh failed').trim().slice(0, 300) });
      }
      const parts = String(stdout).trim().split(/\s+/);
      const nowEpoch = Number(parts[0]);
      const uptimeSeconds = Number(parts[1]);
      if (!nowEpoch || Number.isNaN(uptimeSeconds)) {
        return resolve({ ok: false, error: 'unparseable: ' + String(stdout).slice(0, 120) });
      }
      resolve({
        ok: true,
        bootEpoch: Math.floor(nowEpoch - uptimeSeconds),
        uptimeSeconds,
        load: [parts[2], parts[3], parts[4]].map(Number),
        hostname: parts[5] || null,
      });
    });
  });
}

export async function registerHostsRoutes(app: FastifyInstance, config: GatewayConfig) {
  // GET /api/hosts → aliases the user has configured (no secrets).
  app.get('/api/hosts', async (req, reply) => {
    const user = requireUser(req, reply, config);
    if (!user) return;
    ensureSshScaffold(config, user.id);
    return {
      hosts: listHosts(config, user.id).map((h) => ({
        alias: h.alias,
        host: h.host,
        user: h.user,
        hasKey: h.hasKey,
      })),
    };
  });

  // GET /api/hosts/:alias/uptime → fixed uptime probe over the stored key.
  app.get<{ Params: { alias: string } }>('/api/hosts/:alias/uptime', async (req, reply) => {
    const user = requireUser(req, reply, config);
    if (!user) return;
    const { alias } = req.params;
    ensureSshScaffold(config, user.id);
    const known = listHosts(config, user.id).find((h) => h.alias === alias);
    if (!known) return reply.code(404).send({ ok: false, error: 'unknown host' });
    return { alias, host: known.host, ...(await sshUptime(config, user.id, alias)) };
  });
}
