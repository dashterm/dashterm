/**
 * /api/ai/* — AI proxy + provider management.
 *
 *   POST /api/ai/chat        OpenAI-shaped completion routed to the
 *                            provider bound to body.appId (or the default).
 *   GET  /api/ai/providers   list configured providers + bindings (no
 *                            api_key fields).
 *   POST   /api/ai/providers                create a provider (admin)
 *   PATCH  /api/ai/providers/{id}           edit a provider (admin)
 *   DELETE /api/ai/providers/{id}           remove a provider (admin)
 *   POST   /api/ai/providers/{id}/set-default  mark the fallback (admin)
 *   POST /api/ai/providers/{id}/bind   admin-only — bind appId → provider
 *   POST /api/ai/providers/unbind      admin-only — drop the binding
 *
 * Auth: every route requires a signed-in user (cookie). The list +
 * chat routes are open to any user; the mutating routes are gated on
 * users.is_admin = 1. The intent is that a family member can use the
 * dashboard's AI without being able to swap whose key is paying for it.
 *
 * The CRUD routes accept api_key in the request body. That's acceptable
 * because the gateway is same-origin / localhost-bound and admin-gated;
 * the key is stored server-side and never read back (toSummary exposes
 * only hasApiKey). The `dashterm provider` CLI manipulates the same
 * sqlite directly and stays available as an alternative.
 */

import type { FastifyInstance } from 'fastify';
import {
  adapterFor,
  addProvider,
  getBinding,
  getProviderById,
  getProviderByName,
  listBindings,
  listProviders,
  removeProvider,
  resolveProvider,
  setDefaultProvider,
  toSummary,
  updateProvider,
  bindApp,
  unbindApp,
} from '../ai/registry';
import type { ChatRequest, ProviderRow } from '../ai/types';
import { requireUser } from './auth';
import type { GatewayConfig } from '../config';

export async function registerAiRoutes(app: FastifyInstance, config: GatewayConfig) {
  app.post('/api/ai/chat', async (req, reply) => {
    const me = requireUser(req, reply, config);
    if (!me) return;
    const body = (req.body ?? {}) as ChatRequest;
    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      return reply.code(400).send({ error: 'messages[] is required' });
    }
    let providerRow;
    try {
      providerRow = resolveProvider(body.appId);
    } catch (e) {
      return reply.code(503).send({ error: e instanceof Error ? e.message : String(e) });
    }
    const adapter = adapterFor(providerRow);
    try {
      const result = await adapter.chat(body, {
        model: body.model || providerRow.default_model,
        apiKey: providerRow.api_key,
        baseUrl: providerRow.base_url,
        providerName: providerRow.name,
      });
      return result;
    } catch (e) {
      req.log.error({ err: e }, 'ai chat failed');
      return reply.code(502).send({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.get('/api/ai/providers', async (req, reply) => {
    const me = requireUser(req, reply, config);
    if (!me) return;
    return {
      providers: listProviders().map(toSummary),
      bindings: listBindings(),
    };
  });

  // --- Provider CRUD (admin only) -----------------------------------------
  // These accept api_key over the wire. That's tolerable because the gateway
  // is same-origin / localhost-bound and the routes are admin-gated; the key
  // is stored server-side and never read back (toSummary exposes only
  // hasApiKey). Non-admins can list + use providers but not edit whose key
  // pays. Mirrors the `dashterm provider add/remove/set-default` CLI.
  const PROVIDER_KINDS: ProviderRow['kind'][] = ['anthropic', 'openai', 'gemini', 'ollama'];

  app.post<{
    Body: {
      name?: string;
      kind?: string;
      defaultModel?: string;
      apiKey?: string | null;
      baseUrl?: string | null;
      asDefault?: boolean;
    };
  }>('/api/ai/providers', async (req, reply) => {
    const me = requireUser(req, reply, config);
    if (!me) return;
    if (me.is_admin !== 1) return reply.code(403).send({ error: 'admin only' });
    const b = req.body ?? {};
    const name = (b.name || '').trim();
    const defaultModel = (b.defaultModel || '').trim();
    if (!name) return reply.code(400).send({ error: 'name is required' });
    if (!b.kind || !PROVIDER_KINDS.includes(b.kind as ProviderRow['kind'])) {
      return reply.code(400).send({ error: `kind must be one of ${PROVIDER_KINDS.join(', ')}` });
    }
    if (!defaultModel) return reply.code(400).send({ error: 'defaultModel is required' });
    if (getProviderByName(name)) {
      return reply.code(409).send({ error: `a provider named "${name}" already exists` });
    }
    try {
      const row = addProvider({
        name,
        kind: b.kind as ProviderRow['kind'],
        defaultModel,
        apiKey: b.apiKey ?? null,
        baseUrl: b.baseUrl ?? null,
        asDefault: !!b.asDefault,
      });
      return reply.code(201).send({ provider: toSummary(row) });
    } catch (e) {
      return reply.code(400).send({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.patch<{
    Params: { id: string };
    Body: {
      name?: string;
      kind?: string;
      defaultModel?: string;
      apiKey?: string | null;
      baseUrl?: string | null;
    };
  }>('/api/ai/providers/:id', async (req, reply) => {
    const me = requireUser(req, reply, config);
    if (!me) return;
    if (me.is_admin !== 1) return reply.code(403).send({ error: 'admin only' });
    if (!getProviderById(req.params.id)) {
      return reply.code(404).send({ error: 'provider not found' });
    }
    const b = req.body ?? {};
    if (b.kind !== undefined && !PROVIDER_KINDS.includes(b.kind as ProviderRow['kind'])) {
      return reply.code(400).send({ error: `kind must be one of ${PROVIDER_KINDS.join(', ')}` });
    }
    if (b.name !== undefined) {
      const clash = getProviderByName(b.name.trim());
      if (clash && clash.id !== req.params.id) {
        return reply.code(409).send({ error: `a provider named "${b.name.trim()}" already exists` });
      }
    }
    try {
      const row = updateProvider(req.params.id, {
        name: b.name?.trim(),
        kind: b.kind as ProviderRow['kind'] | undefined,
        defaultModel: b.defaultModel?.trim(),
        apiKey: b.apiKey ?? undefined,
        baseUrl: b.baseUrl,
      });
      if (!row) return reply.code(404).send({ error: 'provider not found' });
      return { provider: toSummary(row) };
    } catch (e) {
      return reply.code(400).send({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.delete<{ Params: { id: string } }>('/api/ai/providers/:id', async (req, reply) => {
    const me = requireUser(req, reply, config);
    if (!me) return;
    if (me.is_admin !== 1) return reply.code(403).send({ error: 'admin only' });
    const removed = removeProvider(req.params.id);
    if (!removed) return reply.code(404).send({ error: 'provider not found' });
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>(
    '/api/ai/providers/:id/set-default',
    async (req, reply) => {
      const me = requireUser(req, reply, config);
      if (!me) return;
      if (me.is_admin !== 1) return reply.code(403).send({ error: 'admin only' });
      const ok = setDefaultProvider(req.params.id);
      if (!ok) return reply.code(404).send({ error: 'provider not found' });
      return { ok: true };
    },
  );

  app.post<{ Params: { id: string }; Body: { appId?: string } }>(
    '/api/ai/providers/:id/bind',
    async (req, reply) => {
      const me = requireUser(req, reply, config);
      if (!me) return;
      if (me.is_admin !== 1) return reply.code(403).send({ error: 'admin only' });
      const provider = getProviderById(req.params.id);
      if (!provider) return reply.code(404).send({ error: 'provider not found' });
      const appId = req.body?.appId;
      if (!appId) return reply.code(400).send({ error: 'appId is required' });
      bindApp(appId, provider.id);
      return { ok: true, binding: { appId, providerId: provider.id } };
    },
  );

  app.post<{ Body: { appId?: string } }>('/api/ai/providers/unbind', async (req, reply) => {
    const me = requireUser(req, reply, config);
    if (!me) return;
    if (me.is_admin !== 1) return reply.code(403).send({ error: 'admin only' });
    const appId = req.body?.appId;
    if (!appId) return reply.code(400).send({ error: 'appId is required' });
    const removed = unbindApp(appId);
    return { ok: removed };
  });

  app.get<{ Params: { appId: string } }>(
    '/api/ai/providers/binding/:appId',
    async (req, reply) => {
      const me = requireUser(req, reply, config);
      if (!me) return;
      const binding = getBinding(req.params.appId);
      return { binding };
    },
  );
}
