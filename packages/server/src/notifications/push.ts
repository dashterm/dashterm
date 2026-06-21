/**
 * Outbound push delivery via the Expo Push API.
 *
 * sendPushToUser() is the single chokepoint every notification path goes
 * through (ctx.notify today; a server-side scheduler could reuse it later). It
 * looks up the user's registered device tokens, posts them to Expo, and prunes
 * any token Expo reports as DeviceNotRegistered so dead rows don't accumulate.
 *
 * Kept deliberately thin: swapping in APNs/FCM-direct delivery later only means
 * replacing sendExpoPush — sendPushToUser's signature stays the same. A push
 * failure is logged and swallowed; it must never break the caller's handler.
 */
import { deleteTokenEverywhere, getDeviceTokens } from './registry';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const EXPO_BATCH = 100; // Expo accepts up to 100 messages per request.

export interface NotifyPayload {
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

interface ExpoTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function sendExpoBatch(tokens: string[], payload: NotifyPayload): Promise<number> {
  const messages = tokens.map((to) => ({
    to,
    title: payload.title,
    body: payload.body,
    data: payload.data ?? {},
    sound: 'default',
  }));
  const res = await fetch(EXPO_PUSH_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(messages),
  });
  if (!res.ok) {
    console.warn(`[push] Expo push failed: ${res.status} ${res.statusText}`);
    return 0;
  }
  const json = (await res.json()) as { data?: ExpoTicket[] };
  const tickets = json.data ?? [];
  let sent = 0;
  tickets.forEach((ticket, i) => {
    if (ticket.status === 'ok') {
      sent++;
    } else if (ticket.details?.error === 'DeviceNotRegistered') {
      deleteTokenEverywhere(tokens[i]);
    }
  });
  return sent;
}

async function sendExpoPush(tokens: string[], payload: NotifyPayload): Promise<{ sent: number }> {
  let sent = 0;
  for (const batch of chunk(tokens, EXPO_BATCH)) {
    try {
      sent += await sendExpoBatch(batch, payload);
    } catch (e) {
      console.warn(`[push] Expo push error: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { sent };
}

/** Deliver a notification to every device the given user has registered. */
export async function sendPushToUser(
  userId: string,
  payload: NotifyPayload,
): Promise<{ sent: number }> {
  const tokens = getDeviceTokens(userId);
  if (tokens.length === 0) return { sent: 0 };
  return sendExpoPush(tokens, payload);
}
