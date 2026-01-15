/**
 * Integration Registry
 *
 * Singleton registry for managing all external integrations.
 * Provides centralized access to adapters and configuration.
 */

import { EventBus } from '../core/event-bus.js';
import { StateManager } from '../core/state-manager.js';
import type { IntegrationAdapter } from './base.js';
import type { IntegrationType, IntegrationConfig } from '../types/integration.js';

/** Registry entry */
interface RegistryEntry {
  adapter: IntegrationAdapter;
  config: IntegrationConfig | null;
  initialized: boolean;
}

/**
 * Integration Registry singleton
 */
class IntegrationRegistryClass {
  private adapters: Map<IntegrationType, RegistryEntry> = new Map();
  private globalMockMode = false;

  /**
   * Register an integration adapter
   */
  register(adapter: IntegrationAdapter): void {
    if (this.adapters.has(adapter.type)) {
      console.warn(`[IntegrationRegistry] Adapter ${adapter.type} already registered, replacing`);
    }

    this.adapters.set(adapter.type, {
      adapter,
      config: null,
      initialized: false
    });

    if (this.globalMockMode) {
      adapter.enableMockMode();
    }

    EventBus.emit('integration:registered', { type: adapter.type, name: adapter.name });
  }

  /**
   * Unregister an integration adapter
   */
  unregister(type: IntegrationType): void {
    const entry = this.adapters.get(type);
    if (entry) {
      entry.adapter.clearAuth();
      this.adapters.delete(type);
      EventBus.emit('integration:unregistered', { type });
    }
  }

  /**
   * Get an adapter by type
   */
  get<T extends IntegrationAdapter>(type: IntegrationType): T | null {
    const entry = this.adapters.get(type);
    return entry ? (entry.adapter as T) : null;
  }

  /**
   * Initialize an adapter with configuration
   */
  async init(type: IntegrationType, config: IntegrationConfig): Promise<boolean> {
    const entry = this.adapters.get(type);
    if (!entry) {
      console.error(`[IntegrationRegistry] Adapter ${type} not registered`);
      return false;
    }

    try {
      await entry.adapter.init(config);
      entry.config = config;
      entry.initialized = true;

      // Save config to state
      StateManager.set('integrations', type, config);

      EventBus.emit('integration:initialized', { type });
      return true;
    } catch (error) {
      console.error(`[IntegrationRegistry] Failed to initialize ${type}:`, error);
      return false;
    }
  }

  /**
   * Initialize all adapters from saved configuration
   */
  async initFromSaved(): Promise<void> {
    const savedConfigs = StateManager.getAll<IntegrationConfig>('integrations');

    for (const [type, config] of Object.entries(savedConfigs)) {
      if (this.adapters.has(type as IntegrationType)) {
        await this.init(type as IntegrationType, config);
      }
    }
  }

  /**
   * Check if an adapter is registered
   */
  has(type: IntegrationType): boolean {
    return this.adapters.has(type);
  }

  /**
   * Check if an adapter is initialized
   */
  isInitialized(type: IntegrationType): boolean {
    const entry = this.adapters.get(type);
    return entry?.initialized ?? false;
  }

  /**
   * Check if an adapter is authenticated
   */
  isAuthenticated(type: IntegrationType): boolean {
    const entry = this.adapters.get(type);
    return entry?.adapter.isAuthenticated() ?? false;
  }

  /**
   * List all registered adapters
   */
  list(): Array<{
    type: IntegrationType;
    name: string;
    initialized: boolean;
    authenticated: boolean;
  }> {
    const result: Array<{
      type: IntegrationType;
      name: string;
      initialized: boolean;
      authenticated: boolean;
    }> = [];

    for (const [type, entry] of this.adapters) {
      result.push({
        type,
        name: entry.adapter.name,
        initialized: entry.initialized,
        authenticated: entry.adapter.isAuthenticated()
      });
    }

    return result;
  }

  /**
   * Enable mock mode for all adapters
   */
  enableMockMode(): void {
    this.globalMockMode = true;
    for (const entry of this.adapters.values()) {
      entry.adapter.enableMockMode();
    }
    console.log('[IntegrationRegistry] Global mock mode enabled');
    EventBus.emit('integration:mock:enabled', {});
  }

  /**
   * Disable mock mode for all adapters
   */
  disableMockMode(): void {
    this.globalMockMode = false;
    for (const entry of this.adapters.values()) {
      entry.adapter.disableMockMode();
    }
    EventBus.emit('integration:mock:disabled', {});
  }

  /**
   * Test connection for an adapter
   */
  async testConnection(type: IntegrationType): Promise<boolean> {
    const entry = this.adapters.get(type);
    if (!entry) {
      return false;
    }

    try {
      return await entry.adapter.testConnection();
    } catch {
      return false;
    }
  }

  /**
   * Test all connections
   */
  async testAllConnections(): Promise<Record<IntegrationType, boolean>> {
    const results: Record<string, boolean> = {};

    for (const type of this.adapters.keys()) {
      results[type] = await this.testConnection(type);
    }

    return results as Record<IntegrationType, boolean>;
  }

  /**
   * Clear all authentications
   */
  clearAllAuth(): void {
    for (const entry of this.adapters.values()) {
      entry.adapter.clearAuth();
    }
    EventBus.emit('integration:auth:cleared:all', {});
  }

  /**
   * Clear all registrations
   */
  clear(): void {
    this.clearAllAuth();
    this.adapters.clear();
    EventBus.emit('integration:cleared', {});
  }

  /**
   * Get statistics
   */
  stats(): {
    total: number;
    initialized: number;
    authenticated: number;
    mockMode: boolean;
  } {
    let initialized = 0;
    let authenticated = 0;

    for (const entry of this.adapters.values()) {
      if (entry.initialized) initialized++;
      if (entry.adapter.isAuthenticated()) authenticated++;
    }

    return {
      total: this.adapters.size,
      initialized,
      authenticated,
      mockMode: this.globalMockMode
    };
  }
}

// Export singleton instance
export const IntegrationRegistry = new IntegrationRegistryClass();

// Also export the class for testing
export { IntegrationRegistryClass };
