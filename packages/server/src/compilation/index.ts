// Compile pipeline for vibe-coded custom apps. The Gemini-driven code
// generator / editor / fixer that used to live alongside has been ripped
// out — code creation now happens via the AgenticCoder app (claude -p
// sessions). What's left here is just the esbuild TSX → IIFE JS step that
// runs every time a custom app renders.

export * from './types';
export * from './reactNativeShims';
export * from './codeCompiler';
