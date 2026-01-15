/**
 * Generic Adapter - Template for custom integrations
 *
 * Base class and utilities for creating custom adapters
 * for services not covered by built-in adapters.
 */

import { EventBus } from '../core/event-bus.js';

/** Endpoint configuration */
export interface EndpointConfig {
  name: string;
  path: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  params?: Record<string, 'required' | 'optional'>;
  description?: string;
}

/** Request configuration */
export interface RequestConfig {
  url: string;
  method: string;
  headers?: Record<string, string>;
  body?: unknown;
  params?: Record<string, string>;
}

/** Response wrapper */
export interface AdapterResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  statusCode: number;
  headers: Record<string, string>;
  duration: number;
}

/** Base adapter configuration */
export interface BaseAdapterConfig {
  baseUrl: string;
  timeout?: number;
  retries?: number;
  auth?: {
    type: 'basic' | 'bearer' | 'apikey' | 'custom';
    credentials: Record<string, string>;
  };
  defaultHeaders?: Record<string, string>;
}

/** Generic adapter base class */
export abstract class GenericAdapter<TConfig extends BaseAdapterConfig> {
  protected config: TConfig | null = null;
  protected mockMode = false;

  /**
   * Define available endpoints - override in subclass
   */
  abstract get endpoints(): EndpointConfig[];

  /**
   * Map API response to typed result - override in subclass
   */
  abstract mapResponse<R>(endpoint: string, response: unknown): R;

  /**
   * Build request from endpoint and data - override in subclass
   */
  abstract buildRequest(endpoint: string, data?: unknown): RequestConfig;

  /**
   * Configure the adapter
   */
  configure(config: TConfig): void {
    this.config = config;
    console.log(`[GenericAdapter] Configured for: ${config.baseUrl}`);
  }

  /**
   * Enable mock mode
   */
  enableMockMode(): void {
    this.mockMode = true;
  }

  /**
   * Disable mock mode
   */
  disableMockMode(): void {
    this.mockMode = false;
  }

  /**
   * Get endpoint by name
   */
  getEndpoint(name: string): EndpointConfig | undefined {
    return this.endpoints.find(e => e.name === name);
  }

  /**
   * List available endpoints
   */
  listEndpoints(): EndpointConfig[] {
    return [...this.endpoints];
  }

  /**
   * Get auth header based on config
   */
  protected getAuthHeader(): Record<string, string> {
    if (!this.config?.auth) return {};

    const { type, credentials } = this.config.auth;

    switch (type) {
      case 'basic': {
        const encoded = btoa(`${credentials.username}:${credentials.password}`);
        return { 'Authorization': `Basic ${encoded}` };
      }

      case 'bearer':
        return { 'Authorization': `Bearer ${credentials.token}` };

      case 'apikey':
        return { [credentials.headerName || 'X-API-Key']: credentials.apiKey };

      case 'custom':
        return credentials;

      default:
        return {};
    }
  }

  /**
   * Make HTTP request
   */
  protected async request<T>(
    requestConfig: RequestConfig
  ): Promise<AdapterResponse<T>> {
    if (!this.config) {
      return {
        success: false,
        error: 'Adapter not configured',
        statusCode: 0,
        headers: {},
        duration: 0
      };
    }

    const startTime = Date.now();

    try {
      // Build URL with params
      let url = requestConfig.url;
      if (requestConfig.params) {
        const params = new URLSearchParams(requestConfig.params);
        url += `?${params}`;
      }

      // Build headers
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...this.config.defaultHeaders,
        ...this.getAuthHeader(),
        ...requestConfig.headers
      };

      // Make request
      const response = await fetch(url, {
        method: requestConfig.method,
        headers,
        body: requestConfig.body ? JSON.stringify(requestConfig.body) : undefined,
        signal: this.config.timeout
          ? AbortSignal.timeout(this.config.timeout)
          : undefined
      });

      const duration = Date.now() - startTime;

      // Parse response headers
      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });

      if (!response.ok) {
        return {
          success: false,
          error: `HTTP ${response.status}: ${response.statusText}`,
          statusCode: response.status,
          headers: responseHeaders,
          duration
        };
      }

      const data = await response.json() as T;

      return {
        success: true,
        data,
        statusCode: response.status,
        headers: responseHeaders,
        duration
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        statusCode: 0,
        headers: {},
        duration: Date.now() - startTime
      };
    }
  }

  /**
   * Execute endpoint
   */
  async execute<T>(endpointName: string, data?: unknown): Promise<AdapterResponse<T>> {
    const endpoint = this.getEndpoint(endpointName);
    if (!endpoint) {
      return {
        success: false,
        error: `Unknown endpoint: ${endpointName}`,
        statusCode: 0,
        headers: {},
        duration: 0
      };
    }

    // Validate required params
    if (endpoint.params) {
      const requiredParams = Object.entries(endpoint.params)
        .filter(([_, required]) => required === 'required')
        .map(([name]) => name);

      for (const param of requiredParams) {
        if (!data || !(data as Record<string, unknown>)[param]) {
          return {
            success: false,
            error: `Missing required parameter: ${param}`,
            statusCode: 0,
            headers: {},
            duration: 0
          };
        }
      }
    }

    const requestConfig = this.buildRequest(endpointName, data);

    EventBus.emit('adapter:request:start', {
      endpoint: endpointName,
      url: requestConfig.url
    });

    const response = await this.request<unknown>(requestConfig);

    EventBus.emit('adapter:request:complete', {
      endpoint: endpointName,
      success: response.success,
      duration: response.duration
    });

    if (response.success && response.data) {
      const mapped = this.mapResponse<T>(endpointName, response.data);
      return { ...response, data: mapped };
    }

    return response as AdapterResponse<T>;
  }
}

/**
 * Simple REST adapter implementation
 */
export class SimpleRESTAdapter extends GenericAdapter<BaseAdapterConfig> {
  private _endpoints: EndpointConfig[] = [];

  get endpoints(): EndpointConfig[] {
    return this._endpoints;
  }

  /**
   * Add endpoint
   */
  addEndpoint(endpoint: EndpointConfig): void {
    this._endpoints.push(endpoint);
  }

  /**
   * Remove endpoint
   */
  removeEndpoint(name: string): void {
    this._endpoints = this._endpoints.filter(e => e.name !== name);
  }

  /**
   * Build request
   */
  buildRequest(endpoint: string, data?: unknown): RequestConfig {
    const ep = this.getEndpoint(endpoint);
    if (!ep || !this.config) {
      throw new Error('Invalid endpoint or config');
    }

    return {
      url: `${this.config.baseUrl}${ep.path}`,
      method: ep.method,
      body: ep.method !== 'GET' ? data : undefined,
      params: ep.method === 'GET' ? data as Record<string, string> : undefined
    };
  }

  /**
   * Map response (pass through by default)
   */
  mapResponse<R>(endpoint: string, response: unknown): R {
    return response as R;
  }
}

// Export factory function
export function createSimpleAdapter(config: BaseAdapterConfig): SimpleRESTAdapter {
  const adapter = new SimpleRESTAdapter();
  adapter.configure(config);
  return adapter;
}
