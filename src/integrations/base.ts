/**
 * Base Integration Adapter
 *
 * Abstract class for all external integrations.
 * Provides common functionality for authentication,
 * error handling, and rate limiting.
 */

import { EventBus } from '../core/event-bus.js';
import { StateManager } from '../core/state-manager.js';
import type {
  IntegrationConfig,
  IntegrationResult,
  AuthState,
  IntegrationType
} from '../types/integration.js';

/** Request options */
export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers?: Record<string, string>;
  body?: unknown;
  timeout?: number;
}

/** Rate limit state */
interface RateLimitState {
  remaining: number;
  resetTime: number;
  limit: number;
}

/**
 * Abstract base class for integration adapters
 */
export abstract class IntegrationAdapter<T extends IntegrationType = IntegrationType> {
  protected config: IntegrationConfig | null = null;
  protected authState: AuthState = { authenticated: false };
  protected rateLimit: RateLimitState = { remaining: -1, resetTime: 0, limit: -1 };
  protected mockMode = false;

  /** Integration type identifier */
  abstract readonly type: T;

  /** Human-readable name */
  abstract readonly name: string;

  /** Base URL for API requests */
  abstract readonly baseUrl: string;

  /**
   * Initialize the adapter with configuration
   */
  async init(config: IntegrationConfig): Promise<void> {
    this.config = config;

    // Load cached auth state
    const cachedAuth = StateManager.get<AuthState>('auth', this.type);
    if (cachedAuth) {
      this.authState = cachedAuth;
    }

    EventBus.emit(`integration:${this.type}:initialized`, { config });
  }

  /**
   * Check if authenticated
   */
  isAuthenticated(): boolean {
    if (!this.authState.authenticated) return false;

    // Check token expiration
    if (this.authState.expiresAt && Date.now() > this.authState.expiresAt) {
      this.authState.authenticated = false;
      return false;
    }

    return true;
  }

  /**
   * Authenticate with the service
   */
  async authenticate(): Promise<boolean> {
    if (!this.config) {
      throw new Error(`${this.name} not initialized. Call init() first.`);
    }

    try {
      const success = await this.doAuthenticate();

      if (success) {
        this.authState.authenticated = true;
        this.authState.lastAuthenticated = Date.now();
        StateManager.set('auth', this.type, this.authState);
        EventBus.emit(`integration:${this.type}:authenticated`, {});
      }

      return success;
    } catch (error) {
      this.authState.authenticated = false;
      this.authState.error = error instanceof Error ? error.message : String(error);
      EventBus.emit(`integration:${this.type}:auth:failed`, { error: this.authState.error });
      return false;
    }
  }

  /**
   * Implementation-specific authentication
   */
  protected abstract doAuthenticate(): Promise<boolean>;

  /**
   * Make an API request
   */
  protected async request<R>(
    path: string,
    options: RequestOptions = {}
  ): Promise<IntegrationResult<R>> {
    if (this.mockMode) {
      return this.mockRequest<R>(path, options);
    }

    if (!this.isAuthenticated()) {
      const authenticated = await this.authenticate();
      if (!authenticated) {
        return {
          success: false,
          error: 'Authentication failed'
        };
      }
    }

    // Check rate limit
    if (this.rateLimit.remaining === 0 && Date.now() < this.rateLimit.resetTime) {
      const waitTime = this.rateLimit.resetTime - Date.now();
      return {
        success: false,
        error: `Rate limited. Retry after ${Math.ceil(waitTime / 1000)}s`
      };
    }

    const url = this.buildUrl(path);
    const headers = this.buildHeaders(options.headers);

    try {
      const controller = new AbortController();
      const timeout = options.timeout || 30000;
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(url, {
        method: options.method || 'GET',
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      // Update rate limit from headers
      this.updateRateLimit(response.headers);

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `HTTP ${response.status}: ${errorText}`
        };
      }

      const data = await response.json() as R;
      return { success: true, data };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      EventBus.emit(`integration:${this.type}:error`, { path, error: message });
      return { success: false, error: message };
    }
  }

  /**
   * Build full URL
   */
  protected buildUrl(path: string): string {
    const base = this.config?.baseUrl || this.baseUrl;
    return `${base.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
  }

  /**
   * Build request headers with authentication
   */
  protected buildHeaders(custom?: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...custom
    };

    if (this.authState.token) {
      headers['Authorization'] = `Bearer ${this.authState.token}`;
    }

    return headers;
  }

  /**
   * Update rate limit state from response headers
   */
  protected updateRateLimit(headers: Headers): void {
    const remaining = headers.get('X-RateLimit-Remaining');
    const reset = headers.get('X-RateLimit-Reset');
    const limit = headers.get('X-RateLimit-Limit');

    if (remaining !== null) {
      this.rateLimit.remaining = parseInt(remaining, 10);
    }
    if (reset !== null) {
      this.rateLimit.resetTime = parseInt(reset, 10) * 1000;
    }
    if (limit !== null) {
      this.rateLimit.limit = parseInt(limit, 10);
    }
  }

  /**
   * Enable mock mode for testing
   */
  enableMockMode(): void {
    this.mockMode = true;
    console.log(`[${this.name}] Mock mode enabled`);
  }

  /**
   * Disable mock mode
   */
  disableMockMode(): void {
    this.mockMode = false;
  }

  /**
   * Mock request handler - override in subclasses
   */
  protected abstract mockRequest<R>(path: string, options: RequestOptions): Promise<IntegrationResult<R>>;

  /**
   * Get rate limit status
   */
  getRateLimitStatus(): RateLimitState {
    return { ...this.rateLimit };
  }

  /**
   * Get authentication state
   */
  getAuthState(): AuthState {
    return { ...this.authState };
  }

  /**
   * Clear authentication
   */
  clearAuth(): void {
    this.authState = { authenticated: false };
    StateManager.remove('auth', this.type);
    EventBus.emit(`integration:${this.type}:auth:cleared`, {});
  }

  /**
   * Test connection to the service
   */
  abstract testConnection(): Promise<boolean>;
}
