/**
 * Gateway boot. Importable as a library (createServer) or runnable via
 * the CLI (./cli.ts).
 */

import fastifyCookie from '@fastify/cookie';
import fastifyCors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import websocketPlugin from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';
import fs from 'fs';
import path from 'path';
import { type GatewayConfig, loadConfig } from './config';
import { openDb, seedDefaultAdminIfEmpty } from './db';
import { registerAuthRoutes } from './routes/auth';
import { registerStateRoutes } from './routes/state';
import { registerUserRoutes } from './routes/users';
import { registerAppsRoutes } from './routes/apps';
import { registerCompileRoutes } from './routes/compile';
import { registerAiRoutes } from './routes/ai';
import { registerSecretsRoutes } from './routes/secrets';
import { registerVarsRoutes } from './routes/vars';
import { registerWsRoutes } from './routes/ws';
import { registerAgentRoutes } from './routes/agent';
import { registerHostsRoutes } from './routes/hosts';
import { registerAppBackendRoutes } from './routes/appBackends';
import { registerUpdateRoutes } from './routes/update';
import { registerConnectRoutes } from './routes/connect';
import { registerDevicesRoutes } from './routes/devices';
import { reloadAllFromDb } from './agent/backendRegistry';
import { broadcastAll } from './realtime';
import { startUpdateChecker } from './infra/update';

export interface StartedGateway {
  app: FastifyInstance;
  config: GatewayConfig;
  stop: () => Promise<void>;
}

export async function createServer(
  overrides: Partial<GatewayConfig> = {},
): Promise<StartedGateway> {
  const config = loadConfig(overrides);
  const db = openDb(config.dataDir);
  await seedDefaultAdminIfEmpty(db);

  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
      // Single-line logs without pino-pretty so the dev terminal stays readable
      // and we don't ship a pretty-print dependency in prod.
      transport: undefined,
    },
    disableRequestLogging: false,
    // Vibe-coded apps can be large (a chunky single-file React component
    // with inline images / data can easily exceed Fastify's default
    // 1 MiB). The old compile-server allowed 10 MiB; we match that.
    bodyLimit: 10 * 1024 * 1024,
  });

  await app.register(fastifyCookie);
  if (config.devCorsOrigin) {
    await app.register(fastifyCors, {
      origin: config.devCorsOrigin,
      credentials: true,
    });
  }

  // Register @fastify/websocket once at app level so multiple routes can be
  // `{ websocket: true }`. /api/ws speaks tiny JSON envelopes; /api/agent/ws
  // carries base64 image payloads, so the limit is sized for the larger case.
  await app.register(websocketPlugin, {
    options: { maxPayload: 16 * 1024 * 1024 },
  });

  await registerWsRoutes(app, config);
  await registerAuthRoutes(app, config);
  await registerStateRoutes(app, config);
  await registerUserRoutes(app, config);
  await registerAppsRoutes(app, config);
  await registerCompileRoutes(app);
  await registerAiRoutes(app, config);
  await registerSecretsRoutes(app, config);
  await registerVarsRoutes(app, config);
  await registerAgentRoutes(app, config);
  await registerHostsRoutes(app, config);
  await registerAppBackendRoutes(app, config);
  await registerUpdateRoutes(app, config);
  await registerConnectRoutes(app, config);
  await registerDevicesRoutes(app, config);

  // Rehydrate every agent-authored backend that survived a restart.
  const reloaded = reloadAllFromDb();
  if (reloaded.loaded || reloaded.failed) {
    app.log.info(`  backends : ${reloaded.loaded} loaded, ${reloaded.failed} failed`);
  }

  app.get('/api/health', async () => ({ ok: true }));

  // Web bundle. In prod, the CLI sets webBundleDir to the built Expo
  // export and we serve it as the SPA fallback. In dev, this is null —
  // the web app is served by `expo start --web` on a different port.
  if (config.webBundleDir && fs.existsSync(config.webBundleDir)) {
    await app.register(fastifyStatic, {
      root: path.resolve(config.webBundleDir),
      prefix: '/',
      wildcard: false,
    });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) {
        return reply.code(404).send({ error: 'not found' });
      }
      return reply.sendFile('index.html');
    });
  }

  return {
    app,
    config,
    stop: async () => {
      await app.close();
    },
  };
}

export async function startServer(
  overrides: Partial<GatewayConfig> = {},
): Promise<StartedGateway> {
  const started = await createServer(overrides);
  await started.app.listen({ port: started.config.port, host: started.config.bind });
  started.app.log.info(
    `DashTerm gateway listening on http://${started.config.bind}:${started.config.port}`,
  );
  started.app.log.info(`  data dir : ${started.config.dataDir}`);
  if (started.config.webBundleDir) {
    started.app.log.info(`  web      : ${started.config.webBundleDir}`);
  } else {
    started.app.log.info(`  web      : (none — run Expo dev server alongside)`);
  }

  // Boot + 6-hourly update check. Broadcasts to every connected tab when a
  // newer release tag appears. No-ops (supported:false) in dev / non-git
  // installs. Timers are unref'd so they never hold the process open.
  startUpdateChecker(started.config, (status) => {
    started.app.log.info(`update available: ${status.currentVersion} → ${status.latestVersion}`);
    broadcastAll({ type: 'update:available', status });
  });

  return started;
}
