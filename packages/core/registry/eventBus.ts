import { AppEvent, AppEventHandler, AppContext } from './types';

type InternalHandler = (event: AppEvent) => void | Promise<void>;

class AppEventBus {
  private listeners = new Map<string, Set<InternalHandler>>();
  private eventLog: AppEvent[] = [];
  private maxLogSize = 100;

  /**
   * Emit an event to all matching listeners
   * Supports exact match and wildcard patterns (e.g., 'workout:*' matches 'workout:set-logged')
   */
  emit(event: AppEvent): void {
    // Add to event log
    this.eventLog.push(event);
    if (this.eventLog.length > this.maxLogSize) {
      this.eventLog.shift();
    }

    console.log(`[EventBus] Emitting: ${event.type}`, event.data);

    // Notify exact match listeners
    this.notify(event.type, event);

    // Notify namespace wildcard listeners (e.g., 'workout:*')
    const [namespace] = event.type.split(':');
    if (namespace && event.type.includes(':')) {
      this.notify(`${namespace}:*`, event);
    }

    // Notify global wildcard listeners
    this.notify('*', event);
  }

  /**
   * Helper to create and emit an event
   */
  emitFromApp(sourceApp: string, eventName: string, data: any, instanceId?: string): void {
    const event: AppEvent = {
      type: `${sourceApp}:${eventName}`,
      sourceApp,
      instanceId,
      data,
      timestamp: Date.now(),
    };
    this.emit(event);
  }

  /**
   * Subscribe to events matching a pattern
   * @param pattern - Event pattern (e.g., 'workout:set-logged', 'workout:*', '*')
   * @param handler - Function to call when event matches
   * @returns Unsubscribe function
   */
  on(pattern: string, handler: InternalHandler): () => void {
    if (!this.listeners.has(pattern)) {
      this.listeners.set(pattern, new Set());
    }
    this.listeners.get(pattern)!.add(handler);

    console.log(`[EventBus] Subscribed to: ${pattern}`);

    // Return unsubscribe function
    return () => {
      this.listeners.get(pattern)?.delete(handler);
      console.log(`[EventBus] Unsubscribed from: ${pattern}`);
    };
  }

  /**
   * Subscribe with AppContext (used by app plugins)
   */
  subscribe(
    pattern: string,
    handler: AppEventHandler,
    getContext: () => AppContext
  ): () => void {
    return this.on(pattern, (event) => {
      const context = getContext();
      return handler(event, context);
    });
  }

  private notify(pattern: string, event: AppEvent): void {
    const handlers = this.listeners.get(pattern);
    if (!handlers || handlers.size === 0) return;

    handlers.forEach(async (handler) => {
      try {
        await handler(event);
      } catch (err) {
        console.error(`[EventBus] Handler error for ${event.type}:`, err);
      }
    });
  }

  /**
   * Get recent events (useful for debugging)
   */
  getRecentEvents(limit = 50): AppEvent[] {
    return this.eventLog.slice(-limit);
  }

  /**
   * Get all registered patterns (useful for debugging)
   */
  getRegisteredPatterns(): string[] {
    return Array.from(this.listeners.keys());
  }

  /**
   * Clear all listeners (useful for testing)
   */
  clear(): void {
    this.listeners.clear();
    this.eventLog = [];
  }
}

// Singleton instance
export const appEventBus = new AppEventBus();
