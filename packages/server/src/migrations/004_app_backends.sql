-- Agent-authored backends: an app may carry an optional server module
-- (apps/<slug>.server.ts) alongside its frontend. We store its source +
-- compiled CJS here, keyed by the same share code, so the backend registry
-- can mount it under /api/x/<shareCode>/* and reload everything on boot.
alter table apps add column backend_code text;
alter table apps add column backend_compiled text;
