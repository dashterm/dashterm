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

// Lists running containers from docker-on-host AND from every running Proxmox
// LXC guest (so `pct exec <vmid> -- docker` setups are found without hardcoding
// a VMID). One line per container: "/name|<RFC3339 started>|<status>". The
// command is fixed — no user input reaches the shell.
const DOCKER_PROBE =
  "docker ps -q 2>/dev/null | xargs -r docker inspect " +
  "--format '{{.Name}}|{{.State.StartedAt}}|{{.State.Status}}' 2>/dev/null; " +
  "if command -v pct >/dev/null 2>&1; then " +
  "for v in $(pct list 2>/dev/null | awk 'NR>1 && $2==\"running\"{print $1}'); do " +
  "pct exec \"$v\" -- sh -c 'docker ps -q 2>/dev/null | xargs -r docker inspect " +
  "--format \"{{.Name}}|{{.State.StartedAt}}|{{.State.Status}}\" 2>/dev/null' 2>/dev/null; " +
  "done; fi";

interface DockerContainer {
  name: string;
  startedEpoch: number | null;
  status: string;
}

interface DockerResult {
  ok: boolean;
  containers?: DockerContainer[];
  count?: number;
  error?: string;
}

function sshDocker(config: GatewayConfig, uid: string, alias: string): Promise<DockerResult> {
  return new Promise((resolve) => {
    const ssh = path.join(sshBinDir(config, uid), 'ssh');
    execFile(ssh, [alias, DOCKER_PROBE], { timeout: 15000, maxBuffer: 4 << 20 }, (err, stdout, stderr) => {
      // A non-zero exit with output still carries containers (e.g. one guest
      // failed); only treat a truly empty result as an error.
      if (err && !String(stdout).trim()) {
        return resolve({ ok: false, error: (stderr || err.message || 'ssh failed').trim().slice(0, 300) });
      }
      const containers: DockerContainer[] = String(stdout)
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .map((line) => {
          const [name, started, status] = line.split('|');
          const t = Date.parse(started);
          return {
            name: (name || '').replace(/^\//, ''),
            startedEpoch: Number.isNaN(t) ? null : Math.floor(t / 1000),
            status: status || 'running',
          };
        });
      resolve({ ok: true, containers, count: containers.length });
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

  // GET /api/hosts/:alias/docker → running containers (host + Proxmox LXC guests).
  app.get<{ Params: { alias: string } }>('/api/hosts/:alias/docker', async (req, reply) => {
    const user = requireUser(req, reply, config);
    if (!user) return;
    const { alias } = req.params;
    ensureSshScaffold(config, user.id);
    const known = listHosts(config, user.id).find((h) => h.alias === alias);
    if (!known) return reply.code(404).send({ ok: false, error: 'unknown host' });
    return { alias, host: known.host, ...(await sshDocker(config, user.id, alias)) };
  });
}
