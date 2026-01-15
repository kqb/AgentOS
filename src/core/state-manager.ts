/**
 * StateManager - Persistent state management for AgentOS
 *
 * Provides localStorage abstraction with:
 * - Versioning and migration
 * - Namespaced storage
 * - Automatic serialization
 * - Event emission on changes
 */

import { EventBus } from './event-bus.js';

/** Storage version for migrations */
const STORAGE_VERSION = 1;

/** Storage key prefix */
const STORAGE_PREFIX = 'agentOS:';

/** State change event payload */
export interface StateChangeEvent<T = unknown> {
  namespace: string;
  key: string;
  oldValue: T | null;
  newValue: T | null;
}

/** Stored data wrapper with metadata */
interface StoredData<T> {
  version: number;
  timestamp: number;
  data: T;
}

/** State manager class */
class StateManagerClass {
  private cache: Map<string, unknown> = new Map();
  private initialized = false;

  /**
   * Initialize state manager
   * Performs version check and migration if needed
   */
  init(): void {
    if (this.initialized) return;

    // Check stored version
    const storedVersion = this.getRaw<number>('_version');
    if (storedVersion !== null && storedVersion < STORAGE_VERSION) {
      this.migrate(storedVersion, STORAGE_VERSION);
    }

    // Set current version
    this.setRaw('_version', STORAGE_VERSION);
    this.initialized = true;

    EventBus.emit('state:initialized', { version: STORAGE_VERSION });
  }

  /**
   * Get a value from storage
   * @param namespace Storage namespace
   * @param key Key within namespace
   * @returns Stored value or null
   */
  get<T>(namespace: string, key: string): T | null {
    const fullKey = this.makeKey(namespace, key);

    // Check cache first
    if (this.cache.has(fullKey)) {
      return this.cache.get(fullKey) as T;
    }

    const stored = this.getRaw<StoredData<T>>(fullKey);
    if (stored === null) return null;

    // Cache the value
    this.cache.set(fullKey, stored.data);
    return stored.data;
  }

  /**
   * Set a value in storage
   * @param namespace Storage namespace
   * @param key Key within namespace
   * @param value Value to store
   */
  set<T>(namespace: string, key: string, value: T): void {
    const fullKey = this.makeKey(namespace, key);
    const oldValue = this.get<T>(namespace, key);

    const stored: StoredData<T> = {
      version: STORAGE_VERSION,
      timestamp: Date.now(),
      data: value
    };

    this.setRaw(fullKey, stored);
    this.cache.set(fullKey, value);

    EventBus.emit('state:changed', {
      namespace,
      key,
      oldValue,
      newValue: value
    } as StateChangeEvent<T>);
  }

  /**
   * Remove a value from storage
   * @param namespace Storage namespace
   * @param key Key within namespace
   */
  remove(namespace: string, key: string): void {
    const fullKey = this.makeKey(namespace, key);
    const oldValue = this.get(namespace, key);

    localStorage.removeItem(STORAGE_PREFIX + fullKey);
    this.cache.delete(fullKey);

    EventBus.emit('state:changed', {
      namespace,
      key,
      oldValue,
      newValue: null
    } as StateChangeEvent);
  }

  /**
   * Clear all values in a namespace
   * @param namespace Storage namespace to clear
   */
  clearNamespace(namespace: string): void {
    const prefix = STORAGE_PREFIX + namespace + ':';
    const keysToRemove: string[] = [];

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(prefix)) {
        keysToRemove.push(key);
      }
    }

    keysToRemove.forEach(key => {
      localStorage.removeItem(key);
      const cacheKey = key.slice(STORAGE_PREFIX.length);
      this.cache.delete(cacheKey);
    });

    EventBus.emit('state:namespace:cleared', { namespace });
  }

  /**
   * Get all keys in a namespace
   * @param namespace Storage namespace
   * @returns Array of keys
   */
  keys(namespace: string): string[] {
    const prefix = STORAGE_PREFIX + namespace + ':';
    const result: string[] = [];

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(prefix)) {
        result.push(key.slice(prefix.length));
      }
    }

    return result;
  }

  /**
   * Get all values in a namespace
   * @param namespace Storage namespace
   * @returns Object with key-value pairs
   */
  getAll<T>(namespace: string): Record<string, T> {
    const result: Record<string, T> = {};
    const keys = this.keys(namespace);

    for (const key of keys) {
      const value = this.get<T>(namespace, key);
      if (value !== null) {
        result[key] = value;
      }
    }

    return result;
  }

  /**
   * Check if a key exists
   * @param namespace Storage namespace
   * @param key Key within namespace
   */
  has(namespace: string, key: string): boolean {
    return this.get(namespace, key) !== null;
  }

  /**
   * Get storage statistics
   */
  stats(): { totalKeys: number; namespaces: string[]; sizeBytes: number } {
    const namespaces = new Set<string>();
    let totalKeys = 0;
    let sizeBytes = 0;

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(STORAGE_PREFIX)) {
        totalKeys++;
        const value = localStorage.getItem(key) || '';
        sizeBytes += key.length + value.length;

        // Extract namespace
        const withoutPrefix = key.slice(STORAGE_PREFIX.length);
        const colonIdx = withoutPrefix.indexOf(':');
        if (colonIdx > 0) {
          namespaces.add(withoutPrefix.slice(0, colonIdx));
        }
      }
    }

    return {
      totalKeys,
      namespaces: Array.from(namespaces),
      sizeBytes
    };
  }

  /**
   * Export all data for backup
   */
  export(): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(STORAGE_PREFIX)) {
        const value = localStorage.getItem(key);
        if (value) {
          try {
            result[key] = JSON.parse(value);
          } catch {
            result[key] = value;
          }
        }
      }
    }

    return result;
  }

  /**
   * Import data from backup
   * @param data Data to import
   * @param merge Whether to merge with existing data (default: replace)
   */
  import(data: Record<string, unknown>, merge = false): void {
    if (!merge) {
      // Clear existing AgentOS data
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith(STORAGE_PREFIX)) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach(key => localStorage.removeItem(key));
      this.cache.clear();
    }

    // Import new data
    for (const [key, value] of Object.entries(data)) {
      if (key.startsWith(STORAGE_PREFIX)) {
        localStorage.setItem(key, JSON.stringify(value));
      }
    }

    EventBus.emit('state:imported', { merge, keyCount: Object.keys(data).length });
  }

  /**
   * Clear all AgentOS data
   */
  clearAll(): void {
    const keysToRemove: string[] = [];

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(STORAGE_PREFIX)) {
        keysToRemove.push(key);
      }
    }

    keysToRemove.forEach(key => localStorage.removeItem(key));
    this.cache.clear();

    EventBus.emit('state:cleared', {});
  }

  /**
   * Create namespaced key
   */
  private makeKey(namespace: string, key: string): string {
    return `${namespace}:${key}`;
  }

  /**
   * Get raw value from localStorage
   */
  private getRaw<T>(key: string): T | null {
    try {
      const value = localStorage.getItem(STORAGE_PREFIX + key);
      if (value === null) return null;
      return JSON.parse(value) as T;
    } catch {
      return null;
    }
  }

  /**
   * Set raw value in localStorage
   */
  private setRaw<T>(key: string, value: T): void {
    localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value));
  }

  /**
   * Migrate data between versions
   */
  private migrate(fromVersion: number, toVersion: number): void {
    console.log(`[StateManager] Migrating from v${fromVersion} to v${toVersion}`);

    // Version-specific migrations would go here
    // For now, just log the migration
    EventBus.emit('state:migrated', { fromVersion, toVersion });
  }
}

// Export singleton instance
export const StateManager = new StateManagerClass();

// Also export the class for testing
export { StateManagerClass };
