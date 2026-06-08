/**
 * Provider registry — CRUD + lookup. Lives on top of the sqlite layer
 * from db.ts. The CLI talks to these functions directly (it opens the
 * db file in-process); the gateway's /api/ai/* routes do too.
 *
 * Conventions:
 *   - One provider may have is_default=1; partial-unique-indexed in the
 *     migration. setDefault() flips the bit in a transaction so we never
 *     wedge with two defaults.
 *   - bindings.app_id is the registry id of the app ('ai', 'usermgmt',
 *     or a vibe-coded share-code). resolveProvider(appId) consults
 *     bindings → falls back to the default → throws if neither exists.
 */

import { randomUUID } from 'node:crypto';
import { getDb } from '../db';
import { anthropicAdapter } from './anthropic';
import { geminiAdapter } from './gemini';
import { ollamaAdapter } from './ollama';
import { openaiAdapter } from './openai';
import type { ProviderAdapter, ProviderRow, ProviderSummary } from './types';

const ADAPTERS: Record<ProviderRow['kind'], ProviderAdapter> = {
  anthropic: anthropicAdapter,
  openai: openaiAdapter,
  gemini: geminiAdapter,
  ollama: ollamaAdapter,
};

export function listProviders(): ProviderRow[] {
  return getDb()
    .prepare<[], ProviderRow>('select * from providers order by created_at asc')
    .all();
}

export function getProviderById(id: string): ProviderRow | undefined {
  return getDb()
    .prepare<[string], ProviderRow>('select * from providers where id = ?')
    .get(id);
}

export function getProviderByName(name: string): ProviderRow | undefined {
  return getDb()
    .prepare<[string], ProviderRow>('select * from providers where name = ?')
    .get(name);
}

export function getDefaultProvider(): ProviderRow | undefined {
  return getDb()
    .prepare<[], ProviderRow>('select * from providers where is_default = 1 limit 1')
    .get();
}

export interface AddProviderInput {
  name: string;
  kind: ProviderRow['kind'];
  defaultModel: string;
  apiKey?: string | null;
  baseUrl?: string | null;
  asDefault?: boolean;
}

export function addProvider(input: AddProviderInput): ProviderRow {
  const id = randomUUID();
  const now = Date.now();
  const db = getDb();
  db.transaction(() => {
    if (input.asDefault) {
      db.prepare('update providers set is_default = 0 where is_default = 1').run();
    }
    db.prepare(
      `insert into providers (id, name, kind, default_model, api_key, base_url, is_default, created_at)
         values (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.name,
      input.kind,
      input.defaultModel,
      input.apiKey ?? null,
      input.baseUrl ?? null,
      input.asDefault ? 1 : 0,
      now,
    );
  })();
  const row = getProviderById(id);
  if (!row) throw new Error('add-provider: row missing after insert');
  return row;
}

export interface UpdateProviderInput {
  name?: string;
  kind?: ProviderRow['kind'];
  defaultModel?: string;
  // Only overwrites the stored key when a non-empty string is supplied. An
  // omitted / empty apiKey means "leave the existing key as-is" — the dashboard
  // never receives the key back (toSummary strips it), so a blank field on an
  // edit form must not wipe it.
  apiKey?: string | null;
  baseUrl?: string | null;
}

export function updateProvider(id: string, patch: UpdateProviderInput): ProviderRow | undefined {
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (patch.name !== undefined) {
    sets.push('name = ?');
    vals.push(patch.name);
  }
  if (patch.kind !== undefined) {
    sets.push('kind = ?');
    vals.push(patch.kind);
  }
  if (patch.defaultModel !== undefined) {
    sets.push('default_model = ?');
    vals.push(patch.defaultModel);
  }
  if (patch.baseUrl !== undefined) {
    sets.push('base_url = ?');
    vals.push(patch.baseUrl || null);
  }
  if (typeof patch.apiKey === 'string' && patch.apiKey.length > 0) {
    sets.push('api_key = ?');
    vals.push(patch.apiKey);
  }
  if (sets.length === 0) return getProviderById(id);
  vals.push(id);
  const r = getDb()
    .prepare(`update providers set ${sets.join(', ')} where id = ?`)
    .run(...vals);
  if (r.changes === 0) return undefined;
  return getProviderById(id);
}

export function removeProvider(id: string): boolean {
  const r = getDb().prepare('delete from providers where id = ?').run(id);
  return r.changes > 0;
}

export function setDefaultProvider(id: string): boolean {
  const db = getDb();
  let ok = false;
  db.transaction(() => {
    db.prepare('update providers set is_default = 0 where is_default = 1').run();
    const r = db.prepare('update providers set is_default = 1 where id = ?').run(id);
    ok = r.changes > 0;
  })();
  return ok;
}

export function bindApp(appId: string, providerId: string): void {
  getDb()
    .prepare(
      `insert into app_provider_bindings (app_id, provider_id)
         values (?, ?)
         on conflict(app_id) do update set provider_id = excluded.provider_id`,
    )
    .run(appId, providerId);
}

export function unbindApp(appId: string): boolean {
  return getDb().prepare('delete from app_provider_bindings where app_id = ?').run(appId).changes > 0;
}

export function getBinding(appId: string): { providerId: string } | undefined {
  const row = getDb()
    .prepare<[string], { provider_id: string }>(
      'select provider_id from app_provider_bindings where app_id = ?',
    )
    .get(appId);
  return row ? { providerId: row.provider_id } : undefined;
}

export function listBindings(): { appId: string; providerId: string }[] {
  return getDb()
    .prepare<[], { app_id: string; provider_id: string }>(
      'select app_id, provider_id from app_provider_bindings',
    )
    .all()
    .map((r) => ({ appId: r.app_id, providerId: r.provider_id }));
}

/**
 * Pick the provider for a given appId. Per-app binding wins, falls
 * back to the default, throws when neither exists so /api/ai/chat
 * returns a clear error instead of dispatching to nothing.
 */
export function resolveProvider(appId: string | undefined): ProviderRow {
  if (appId) {
    const binding = getBinding(appId);
    if (binding) {
      const p = getProviderById(binding.providerId);
      if (p) return p;
    }
  }
  const def = getDefaultProvider();
  if (def) return def;
  throw new Error(
    'No AI provider configured. Run `dashterm provider add` to add one and `dashterm provider set-default` to mark it as the fallback.',
  );
}

export function adapterFor(row: ProviderRow): ProviderAdapter {
  const adapter = ADAPTERS[row.kind];
  if (!adapter) throw new Error(`unknown provider kind: ${row.kind}`);
  return adapter;
}

export function toSummary(row: ProviderRow): ProviderSummary {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    defaultModel: row.default_model,
    baseUrl: row.base_url,
    isDefault: row.is_default === 1,
    hasApiKey: !!row.api_key,
    createdAt: row.created_at,
  };
}
