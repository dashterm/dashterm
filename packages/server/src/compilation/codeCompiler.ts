import * as esbuild from 'esbuild';
import { reactNativeShims } from './reactNativeShims';
import { CompileResponse } from './types';

/**
 * Compiles TypeScript/JSX code to executable JavaScript using esbuild.
 * Wraps the code with React Native web shims for browser execution.
 */
export async function compileTypeScriptCode(
  code: string,
  appName: string = 'CustomApp'
): Promise<CompileResponse> {
  try {
    if (!code) {
      return {
        success: false,
        error: 'Code is required'
      };
    }

    console.log(`🔧 Compiling app: ${appName}`);

    // Extract component name from code
    const componentMatch = code.match(/export default function\s+(\w+)/) ||
      code.match(/function\s+(\w+).*{/);
    const componentName = componentMatch ? componentMatch[1] : appName.replace(/[^a-zA-Z0-9]/g, '');

    // Strip every ES import — single-line, multi-line `import { ... } from`,
    // bare side-effect `import 'foo'`, and `import x = require(...)`. The
    // shim already provides View/Text/StyleSheet/etc., so any leftover
    // destructured import names collide with the shim's `const View = ...`.
    const userCode = code
      // import (default | { ... } | * as X) from 'mod'  — across lines
      .replace(/import\s+[\s\S]*?from\s+['"`][^'"`]+['"`]\s*;?\s*/g, '')
      // bare side-effect import 'mod'
      .replace(/import\s+['"`][^'"`]+['"`]\s*;?\s*/g, '')
      // TS-style import x = require(...)
      .replace(/import\s+\w+\s*=\s*require\s*\(['"`][^'"`]+['"`]\)\s*;?\s*/g, '')
      .replace(/export\s+default\s+/g, '');

    // Wrap user code in an IIFE so any leftover `const View = ...` (e.g. from
    // a CommonJS-style `const { View } = require('react-native')`, or an import
    // that slipped past the strip-regex above) shadows the shim's binding
    // inside its own scope instead of crashing esbuild with a duplicate
    // declaration error.
    const wrappedCode = `
${reactNativeShims}

;(function () {
${userCode}

if (typeof window !== 'undefined') {
  window.CustomAppComponent = ${componentName};
}
})();
`;

    // Compile with esbuild
    const result = await esbuild.build({
      stdin: {
        contents: wrappedCode,
        loader: 'tsx',
        resolveDir: process.cwd(),
      },
      bundle: false, // Don't bundle to avoid React Native conflicts
      format: 'iife',
      globalName: 'CustomAppModule',
      target: 'es2018',
      platform: 'browser',
      write: false,
      define: {
        'process.env.NODE_ENV': '"development"',
        'global': 'window',
        'React': 'window.React', // Use React from window
      },
      jsxFactory: 'React.createElement',
      jsxFragment: 'React.Fragment',
    });

    if (result.errors.length > 0) {
      return {
        success: false,
        error: 'Compilation failed',
        details: result.errors.map(err => err.text)
      };
    }

    const compiledCode = result.outputFiles[0].text;

    console.log(`✅ Successfully compiled ${componentName}`);

    return {
      success: true,
      compiledCode,
      appName: componentName
    };

  } catch (error) {
    console.error('❌ Compilation error:', error);
    return {
      success: false,
      error: 'Internal compilation error',
      details: [(error as Error).message]
    };
  }
}
