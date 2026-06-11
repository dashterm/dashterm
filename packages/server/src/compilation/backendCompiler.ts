/**
 * Compiles an agent-authored backend module (apps/<slug>.server.ts) from
 * TypeScript to CommonJS so the backend registry can evaluate it in-process.
 *
 * Unlike the frontend compiler (which strips imports and injects the RN shim),
 * backends are real Node modules: esbuild lowers any `import` to `require(...)`,
 * and the registry's guarded `require` allows a small builtin allowlist while
 * funnelling real capabilities (ssh/exec/fetch/secrets/ai) through the injected
 * `ctx`. The expected shape is a default export:
 *
 *   export default function register(router) {
 *     router.get('/path', async (req, ctx) => ({ ... }))
 *   }
 */
import * as esbuild from 'esbuild';

export interface BackendCompileResult {
  success: boolean;
  compiled?: string;
  error?: string;
  details?: string[];
}

export async function compileBackendCode(
  code: string,
  appName = 'AppBackend',
): Promise<BackendCompileResult> {
  if (!code || !code.trim()) {
    return { success: false, error: 'backend code is empty' };
  }
  try {
    const result = await esbuild.build({
      stdin: {
        contents: code,
        loader: 'ts',
        resolveDir: process.cwd(),
        sourcefile: `${appName}.server.ts`,
      },
      // No bundling: ESM import/export is lowered to CJS require/exports, but
      // npm deps are NOT inlined — a `require('left-pad')` becomes a real
      // require call that the registry's guarded loader will reject.
      bundle: false,
      format: 'cjs',
      platform: 'node',
      target: 'node18',
      write: false,
    });
    if (result.errors.length > 0) {
      return { success: false, error: 'backend compilation failed', details: result.errors.map((e) => e.text) };
    }
    return { success: true, compiled: result.outputFiles[0].text };
  } catch (error) {
    return { success: false, error: 'backend compile error', details: [(error as Error).message] };
  }
}
