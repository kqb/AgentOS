/**
 * CDP Client
 *
 * Chrome DevTools Protocol client for script injection.
 * Connects to browser debug port and injects AgentOS.
 */

import { EventBus } from '../core/event-bus.js';

/** CDP connection options */
export interface CdpOptions {
  host?: string;
  port?: number;
  secure?: boolean;
}

/** CDP message */
interface CdpMessage {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code: number; message: string };
}

/** CDP target info */
interface TargetInfo {
  targetId: string;
  type: string;
  title: string;
  url: string;
  attached: boolean;
  webSocketDebuggerUrl?: string;
}

/**
 * CDP Client class
 */
class CdpClientClass {
  private ws: WebSocket | null = null;
  private messageId = 0;
  private pendingMessages: Map<number, {
    resolve: (result: unknown) => void;
    reject: (error: Error) => void;
  }> = new Map();
  private connected = false;
  private options: Required<CdpOptions> = {
    host: 'localhost',
    port: 9222,
    secure: false
  };

  /**
   * Configure CDP connection
   */
  configure(options: CdpOptions): void {
    this.options = { ...this.options, ...options };
  }

  /**
   * Get list of available targets
   */
  async getTargets(): Promise<TargetInfo[]> {
    const protocol = this.options.secure ? 'https' : 'http';
    const url = `${protocol}://${this.options.host}:${this.options.port}/json`;

    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to get targets: ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      throw new Error(`CDP connection failed. Ensure browser is started with --remote-debugging-port=${this.options.port}`);
    }
  }

  /**
   * Connect to a specific target
   */
  async connect(targetId?: string): Promise<void> {
    if (this.connected) {
      await this.disconnect();
    }

    const targets = await this.getTargets();

    // Find target to connect to
    let target: TargetInfo | undefined;

    if (targetId) {
      target = targets.find(t => t.targetId === targetId);
    } else {
      // Find first page target
      target = targets.find(t => t.type === 'page');
    }

    if (!target) {
      throw new Error('No suitable target found');
    }

    if (!target.webSocketDebuggerUrl) {
      throw new Error('Target does not have WebSocket debugger URL');
    }

    // Connect via WebSocket
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(target!.webSocketDebuggerUrl!);

      this.ws.onopen = () => {
        this.connected = true;
        EventBus.emit('cdp:connected', { targetId: target!.targetId });
        resolve();
      };

      this.ws.onerror = (event) => {
        reject(new Error('WebSocket connection failed'));
      };

      this.ws.onclose = () => {
        this.connected = false;
        this.pendingMessages.clear();
        EventBus.emit('cdp:disconnected', {});
      };

      this.ws.onmessage = (event) => {
        this.handleMessage(JSON.parse(event.data));
      };
    });
  }

  /**
   * Disconnect from target
   */
  async disconnect(): Promise<void> {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
    this.pendingMessages.clear();
  }

  /**
   * Send CDP command
   */
  async send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    if (!this.connected || !this.ws) {
      throw new Error('Not connected to CDP');
    }

    const id = ++this.messageId;

    return new Promise((resolve, reject) => {
      this.pendingMessages.set(id, { resolve, reject });

      const message: CdpMessage = { id, method, params };
      this.ws!.send(JSON.stringify(message));

      // Timeout after 30 seconds
      setTimeout(() => {
        if (this.pendingMessages.has(id)) {
          this.pendingMessages.delete(id);
          reject(new Error(`CDP command timeout: ${method}`));
        }
      }, 30000);
    });
  }

  /**
   * Handle incoming CDP message
   */
  private handleMessage(message: CdpMessage): void {
    if (message.id !== undefined) {
      const pending = this.pendingMessages.get(message.id);
      if (pending) {
        this.pendingMessages.delete(message.id);

        if (message.error) {
          pending.reject(new Error(message.error.message));
        } else {
          pending.resolve(message.result);
        }
      }
    } else if (message.method) {
      // Event from browser
      EventBus.emit(`cdp:event:${message.method}`, message.params);
    }
  }

  /**
   * Evaluate JavaScript in the page context
   */
  async evaluate(expression: string): Promise<unknown> {
    const result = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true
    }) as { result: { value: unknown } };

    return result.result?.value;
  }

  /**
   * Inject script into page
   */
  async injectScript(script: string): Promise<void> {
    await this.send('Runtime.evaluate', {
      expression: script,
      returnByValue: false,
      awaitPromise: true
    });

    EventBus.emit('cdp:script:injected', { length: script.length });
  }

  /**
   * Add script to run on every page load
   */
  async addScriptOnLoad(script: string): Promise<string> {
    const result = await this.send('Page.addScriptToEvaluateOnNewDocument', {
      source: script
    }) as { identifier: string };

    return result.identifier;
  }

  /**
   * Remove script from page load
   */
  async removeScriptOnLoad(identifier: string): Promise<void> {
    await this.send('Page.removeScriptToEvaluateOnNewDocument', {
      identifier
    });
  }

  /**
   * Enable necessary CDP domains
   */
  async enableDomains(): Promise<void> {
    await Promise.all([
      this.send('Runtime.enable'),
      this.send('Page.enable'),
      this.send('DOM.enable')
    ]);
  }

  /**
   * Navigate to URL
   */
  async navigate(url: string): Promise<void> {
    await this.send('Page.navigate', { url });
  }

  /**
   * Reload page
   */
  async reload(ignoreCache = false): Promise<void> {
    await this.send('Page.reload', { ignoreCache });
  }

  /**
   * Take screenshot
   */
  async screenshot(): Promise<string> {
    const result = await this.send('Page.captureScreenshot', {
      format: 'png'
    }) as { data: string };

    return result.data;
  }

  /**
   * Get page HTML
   */
  async getPageHtml(): Promise<string> {
    const result = await this.send('Runtime.evaluate', {
      expression: 'document.documentElement.outerHTML',
      returnByValue: true
    }) as { result: { value: string } };

    return result.result?.value || '';
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Get connection info
   */
  getConnectionInfo(): { host: string; port: number; connected: boolean } {
    return {
      host: this.options.host,
      port: this.options.port,
      connected: this.connected
    };
  }
}

// Export singleton instance
export const CdpClient = new CdpClientClass();

// Also export the class for testing
export { CdpClientClass };
