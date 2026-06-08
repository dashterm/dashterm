// Convert AgenticCoder's per-user relay WS URL (e.g. wss://host/ws) into the
// HTTPS API base (e.g. https://host/api) that custom apps hit via
// window.DASHTERM_API_BASE. Returns '' if the input is falsy so callers can
// detect the "no homehub configured yet" state.
export function relayUrlToApiBase(relayUrl: string | undefined | null): string {
  const url = (relayUrl || '').trim();
  if (!url) return '';
  return `${url
    .replace(/^wss:\/\//i, 'https://')
    .replace(/^ws:\/\//i, 'http://')
    .replace(/\/ws\/?$/i, '')
    .replace(/\/+$/, '')}/api`;
}

// Extract the bare origin (scheme://host[:port]) from an apiBase URL — used as
// the WebView's baseUrl on mobile so vibe-coded apps run same-origin with the
// homehub instead of from a null origin (which trips iOS WKWebView's fetch).
export function apiBaseToOrigin(apiBase: string | undefined | null): string {
  const v = (apiBase || '').trim();
  if (!v) return '';
  const m = v.match(/^(https?:\/\/[^/]+)/i);
  return m ? m[1] : '';
}
