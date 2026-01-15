/**
 * CDP Injector
 *
 * Handles injection of AgentOS bundle via CDP.
 * Provides persistent injection across page reloads.
 */

import { CdpClient } from './client.js';
import { EventBus } from '../core/event-bus.js';

/** Injection status */
export interface InjectionStatus {
  injected: boolean;
  persistent: boolean;
  scriptId?: string;
  timestamp?: number;
  error?: string;
}

/**
 * CDP Injector class
 */
class CdpInjectorClass {
  private status: InjectionStatus = {
    injected: false,
    persistent: false
  };
  private bundleScript: string | null = null;
  private persistentScriptId: string | null = null;

  /**
   * Load the AgentOS bundle
   */
  async loadBundle(bundlePath?: string): Promise<void> {
    if (bundlePath) {
      // In browser context, fetch the bundle
      try {
        const response = await fetch(bundlePath);
        this.bundleScript = await response.text();
      } catch (error) {
        throw new Error(`Failed to load bundle from ${bundlePath}`);
      }
    } else {
      // Use embedded bundle (would be set during build)
      this.bundleScript = this.getEmbeddedBundle();
    }

    EventBus.emit('injector:bundle:loaded', { size: this.bundleScript?.length || 0 });
  }

  /**
   * Get embedded bundle (placeholder - would be replaced during build)
   */
  private getEmbeddedBundle(): string {
    // This would be replaced by the actual bundle during build
    return `
      console.log('[AgentOS] Bundle not embedded. Load from file.');
    `;
  }

  /**
   * Inject AgentOS into the current page
   */
  async inject(): Promise<InjectionStatus> {
    if (!CdpClient.isConnected()) {
      return {
        injected: false,
        persistent: false,
        error: 'Not connected to CDP'
      };
    }

    if (!this.bundleScript) {
      await this.loadBundle();
    }

    try {
      // Enable required domains
      await CdpClient.enableDomains();

      // Inject the bundle
      await CdpClient.injectScript(this.bundleScript!);

      this.status = {
        injected: true,
        persistent: false,
        timestamp: Date.now()
      };

      EventBus.emit('injector:injected', this.status);

      return this.status;

    } catch (error) {
      this.status = {
        injected: false,
        persistent: false,
        error: error instanceof Error ? error.message : String(error)
      };

      EventBus.emit('injector:error', this.status);

      return this.status;
    }
  }

  /**
   * Inject AgentOS persistently (survives page reloads)
   */
  async injectPersistent(): Promise<InjectionStatus> {
    if (!CdpClient.isConnected()) {
      return {
        injected: false,
        persistent: false,
        error: 'Not connected to CDP'
      };
    }

    if (!this.bundleScript) {
      await this.loadBundle();
    }

    try {
      // Enable required domains
      await CdpClient.enableDomains();

      // Add script to run on every page load
      this.persistentScriptId = await CdpClient.addScriptOnLoad(this.bundleScript!);

      // Also inject immediately
      await CdpClient.injectScript(this.bundleScript!);

      this.status = {
        injected: true,
        persistent: true,
        scriptId: this.persistentScriptId,
        timestamp: Date.now()
      };

      EventBus.emit('injector:injected:persistent', this.status);

      return this.status;

    } catch (error) {
      this.status = {
        injected: false,
        persistent: false,
        error: error instanceof Error ? error.message : String(error)
      };

      EventBus.emit('injector:error', this.status);

      return this.status;
    }
  }

  /**
   * Remove persistent injection
   */
  async removePersistent(): Promise<void> {
    if (this.persistentScriptId) {
      await CdpClient.removeScriptOnLoad(this.persistentScriptId);
      this.persistentScriptId = null;
      this.status.persistent = false;

      EventBus.emit('injector:persistent:removed', {});
    }
  }

  /**
   * Check if AgentOS is loaded in page
   */
  async isLoaded(): Promise<boolean> {
    if (!CdpClient.isConnected()) {
      return false;
    }

    try {
      const result = await CdpClient.evaluate(
        'typeof window.AgentOS !== "undefined"'
      );
      return result === true;
    } catch {
      return false;
    }
  }

  /**
   * Get AgentOS version from page
   */
  async getVersion(): Promise<string | null> {
    if (!CdpClient.isConnected()) {
      return null;
    }

    try {
      const result = await CdpClient.evaluate(
        'window.AgentOS?.VERSION || null'
      );
      return result as string | null;
    } catch {
      return null;
    }
  }

  /**
   * Execute command in AgentOS context
   */
  async execute(command: string): Promise<unknown> {
    if (!CdpClient.isConnected()) {
      throw new Error('Not connected to CDP');
    }

    const isLoaded = await this.isLoaded();
    if (!isLoaded) {
      throw new Error('AgentOS not loaded in page');
    }

    return CdpClient.evaluate(command);
  }

  /**
   * Get injection status
   */
  getStatus(): InjectionStatus {
    return { ...this.status };
  }

  /**
   * Set bundle script directly
   */
  setBundle(script: string): void {
    this.bundleScript = script;
  }
}

// Export singleton instance
export const CdpInjector = new CdpInjectorClass();

// Also export the class for testing
export { CdpInjectorClass };
