/**
 * /api/compile — TSX → IIFE JS via esbuild + reactNativeShims.
 *
 * Previously this file also hosted /api/create-app, /api/fix-app,
 * /api/test-app, /api/edit-app-agent, /api/create-app-agent,
 * /api/type-check, /api/agent-status — all Gemini-driven helpers used
 * by the old AI vibe-coding flow. Code creation moved to the
 * AgenticCoder app (claude -p sessions), and those endpoints + their
 * compilation/{codeFixer,codeGenerator,editAgent,...} modules were
 * deleted. esbuild compile is the only piece custom apps still need.
 *
 * Auth: intentionally NOT cookie-gated. The gateway binds 127.0.0.1
 * by default; --bind 0.0.0.0 exposes it to the LAN, which is the
 * user's call.
 */

import type { FastifyInstance } from 'fastify';
import { type CompileRequest, compileTypeScriptCode } from '../compilation';

export async function registerCompileRoutes(app: FastifyInstance) {
  app.post('/api/compile', async (req, reply) => {
    const { code, appName = 'CustomApp' } = (req.body ?? {}) as CompileRequest;
    const result = await compileTypeScriptCode(code, appName);
    if (result.success) return result;
    return reply.code(result.error === 'Code is required' ? 400 : 500).send(result);
  });
}
