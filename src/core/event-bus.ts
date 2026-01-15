/**
 * EventBus - Central event dispatcher for AgentOS
 *
 * Provides pub/sub messaging with:
 * - Priority-based listeners
 * - One-time listeners
 * - Filtered listeners
 * - Async processing queue
 */

/** Event listener options */
export interface ListenerOptions {
  /** Remove after first invocation */
  once?: boolean;
  /** Filter function - only call if returns true */
  filter?: (payload: unknown) => boolean;
  /** Priority (higher = called first) */
  priority?: number;
}

/** Internal listener representation */
interface Listener {
  callback: (payload: unknown) => void | Promise<void>;
  once: boolean;
  filter: ((payload: unknown) => boolean) | null;
  priority: number;
}

/** Queued event */
interface QueuedEvent {
  event: string;
  payload: unknown;
  timestamp: number;
}

/** Event bus singleton */
class EventBusClass {
  private listeners: Map<string, Listener[]> = new Map();
  private queue: QueuedEvent[] = [];
  private processing = false;
  private debugMode = false;

  /**
   * Register an event listener
   * @param event Event name to listen for
   * @param callback Function to call when event fires
   * @param options Listener options
   * @returns Unsubscribe function
   */
  on(
    event: string,
    callback: (payload: unknown) => void | Promise<void>,
    options: ListenerOptions = {}
  ): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }

    const listener: Listener = {
      callback,
      once: options.once ?? false,
      filter: options.filter ?? null,
      priority: options.priority ?? 0
    };

    const listeners = this.listeners.get(event)!;
    listeners.push(listener);

    // Sort by priority (descending)
    listeners.sort((a, b) => b.priority - a.priority);

    if (this.debugMode) {
      console.log(`[EventBus] Registered listener for "${event}" (priority: ${listener.priority})`);
    }

    // Return unsubscribe function
    return () => {
      const idx = listeners.indexOf(listener);
      if (idx > -1) {
        listeners.splice(idx, 1);
        if (this.debugMode) {
          console.log(`[EventBus] Unregistered listener for "${event}"`);
        }
      }
    };
  }

  /**
   * Register a one-time event listener
   */
  once(
    event: string,
    callback: (payload: unknown) => void | Promise<void>,
    options: Omit<ListenerOptions, 'once'> = {}
  ): () => void {
    return this.on(event, callback, { ...options, once: true });
  }

  /**
   * Emit an event
   * @param event Event name
   * @param payload Event data
   */
  emit(event: string, payload?: unknown): void {
    this.queue.push({
      event,
      payload,
      timestamp: Date.now()
    });

    if (this.debugMode) {
      console.log(`[EventBus] Queued event "${event}"`, payload);
    }

    // Process queue if not already processing
    if (!this.processing) {
      this.processQueue();
    }
  }

  /**
   * Process the event queue
   */
  private async processQueue(): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    while (this.queue.length > 0) {
      const { event, payload } = this.queue.shift()!;
      const listeners = this.listeners.get(event) || [];

      // Create a copy to safely iterate while potentially removing items
      for (const listener of [...listeners]) {
        // Apply filter if present
        if (listener.filter && !listener.filter(payload)) {
          continue;
        }

        try {
          await listener.callback(payload);
        } catch (error) {
          console.error(`[EventBus] Error in "${event}" listener:`, error);
        }

        // Remove one-time listeners after invocation
        if (listener.once) {
          const idx = listeners.indexOf(listener);
          if (idx > -1) {
            listeners.splice(idx, 1);
          }
        }
      }
    }

    this.processing = false;
  }

  /**
   * Remove all listeners for an event
   */
  off(event: string): void {
    this.listeners.delete(event);
    if (this.debugMode) {
      console.log(`[EventBus] Removed all listeners for "${event}"`);
    }
  }

  /**
   * Remove all listeners
   */
  clear(): void {
    this.listeners.clear();
    this.queue = [];
    if (this.debugMode) {
      console.log('[EventBus] Cleared all listeners');
    }
  }

  /**
   * Get listener count for an event
   */
  listenerCount(event: string): number {
    return this.listeners.get(event)?.length ?? 0;
  }

  /**
   * Get all registered event names
   */
  eventNames(): string[] {
    return Array.from(this.listeners.keys());
  }

  /**
   * Enable debug logging
   */
  enableDebug(): void {
    this.debugMode = true;
    console.log('[EventBus] Debug mode enabled');
  }

  /**
   * Disable debug logging
   */
  disableDebug(): void {
    this.debugMode = false;
  }

  /**
   * Wait for a specific event to occur
   * @param event Event name to wait for
   * @param timeout Timeout in ms (0 = no timeout)
   * @returns Promise that resolves with the event payload
   */
  waitFor<T = unknown>(event: string, timeout = 0): Promise<T> {
    return new Promise((resolve, reject) => {
      let timeoutId: ReturnType<typeof setTimeout> | null = null;

      const unsubscribe = this.once(event, (payload) => {
        if (timeoutId) clearTimeout(timeoutId);
        resolve(payload as T);
      });

      if (timeout > 0) {
        timeoutId = setTimeout(() => {
          unsubscribe();
          reject(new Error(`Timeout waiting for event "${event}"`));
        }, timeout);
      }
    });
  }
}

// Export singleton instance
export const EventBus = new EventBusClass();

// Also export the class for testing
export { EventBusClass };
