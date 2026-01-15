/**
 * Confluence Adapter - Atlassian Confluence integration
 *
 * Provides access to:
 * - Page content
 * - Space navigation
 * - Search functionality
 * - Page creation/updates
 */

import { EventBus } from '../core/event-bus.js';

/** Confluence page */
export interface ConfluencePage {
  id: string;
  title: string;
  spaceKey: string;
  type: 'page' | 'blogpost';
  status: 'current' | 'draft' | 'trashed';
  content: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  url: string;
}

/** Confluence space */
export interface ConfluenceSpace {
  key: string;
  name: string;
  type: 'global' | 'personal';
  description?: string;
  homepageId?: string;
}

/** Search result */
export interface ConfluenceSearchResult {
  page: ConfluencePage;
  excerpt: string;
  score: number;
}

/** Adapter configuration */
export interface ConfluenceConfig {
  baseUrl: string;
  username?: string;
  apiToken?: string;
  spaceKey?: string;
}

/** Confluence adapter singleton */
class ConfluenceAdapterClass {
  private config: ConfluenceConfig | null = null;
  private mockMode = false;
  private mockData: Map<string, ConfluencePage> = new Map();

  /**
   * Configure the adapter
   */
  configure(config: ConfluenceConfig): void {
    this.config = config;
    console.log('[Confluence] Configured for:', config.baseUrl);
  }

  /**
   * Enable mock mode for testing
   */
  enableMockMode(): void {
    this.mockMode = true;
    console.log('[Confluence] Mock mode enabled');
  }

  /**
   * Disable mock mode
   */
  disableMockMode(): void {
    this.mockMode = false;
  }

  /**
   * Get authorization header
   */
  private getAuthHeader(): string {
    if (!this.config?.username || !this.config?.apiToken) {
      return '';
    }
    const credentials = btoa(`${this.config.username}:${this.config.apiToken}`);
    return `Basic ${credentials}`;
  }

  /**
   * Make API request
   */
  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    if (!this.config) {
      throw new Error('Confluence not configured');
    }

    const url = `${this.config.baseUrl}/wiki/rest/api${endpoint}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    };

    const auth = this.getAuthHeader();
    if (auth) {
      headers['Authorization'] = auth;
    }

    const response = await fetch(url, {
      ...options,
      headers: { ...headers, ...options.headers }
    });

    if (!response.ok) {
      throw new Error(`Confluence API error: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Search content
   */
  async searchContent(query: string, limit = 20): Promise<ConfluenceSearchResult[]> {
    if (this.mockMode) {
      return this.mockSearch(query, limit);
    }

    const params = new URLSearchParams({
      cql: `text ~ "${query}"`,
      limit: String(limit),
      expand: 'content.body.storage'
    });

    const response = await this.request<{
      results: Array<{
        content: {
          id: string;
          title: string;
          type: string;
          status: string;
          space: { key: string };
          body?: { storage?: { value: string } };
          version: { number: number };
          history: {
            createdDate: string;
            createdBy: { displayName: string };
            lastUpdated: { when: string };
          };
          _links: { webui: string };
        };
        excerpt: string;
      }>;
    }>(`/search?${params}`);

    return response.results.map(r => ({
      page: this.mapPage(r.content),
      excerpt: r.excerpt,
      score: 1.0
    }));
  }

  /**
   * Get page by ID
   */
  async getPage(pageId: string): Promise<ConfluencePage> {
    if (this.mockMode) {
      const page = this.mockData.get(pageId);
      if (!page) throw new Error('Page not found');
      return page;
    }

    const params = new URLSearchParams({
      expand: 'body.storage,version,history,space'
    });

    const response = await this.request<{
      id: string;
      title: string;
      type: string;
      status: string;
      space: { key: string };
      body: { storage: { value: string } };
      version: { number: number };
      history: {
        createdDate: string;
        createdBy: { displayName: string };
        lastUpdated: { when: string };
      };
      _links: { webui: string };
    }>(`/content/${pageId}?${params}`);

    return this.mapPage(response);
  }

  /**
   * Get page children
   */
  async getPageChildren(pageId: string): Promise<ConfluencePage[]> {
    if (this.mockMode) {
      return [];
    }

    const params = new URLSearchParams({
      expand: 'body.storage,version,history,space'
    });

    const response = await this.request<{
      results: Array<{
        id: string;
        title: string;
        type: string;
        status: string;
        space: { key: string };
        body?: { storage?: { value: string } };
        version: { number: number };
        history: {
          createdDate: string;
          createdBy: { displayName: string };
          lastUpdated: { when: string };
        };
        _links: { webui: string };
      }>;
    }>(`/content/${pageId}/child/page?${params}`);

    return response.results.map(this.mapPage.bind(this));
  }

  /**
   * Create page
   */
  async createPage(
    spaceKey: string,
    title: string,
    content: string,
    parentId?: string
  ): Promise<ConfluencePage> {
    if (this.mockMode) {
      const page: ConfluencePage = {
        id: `mock-${Date.now()}`,
        title,
        spaceKey,
        type: 'page',
        status: 'current',
        content,
        version: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        createdBy: 'mock-user',
        url: '#'
      };
      this.mockData.set(page.id, page);
      return page;
    }

    const body: Record<string, unknown> = {
      type: 'page',
      title,
      space: { key: spaceKey },
      body: {
        storage: {
          value: content,
          representation: 'storage'
        }
      }
    };

    if (parentId) {
      body.ancestors = [{ id: parentId }];
    }

    const response = await this.request<{
      id: string;
      title: string;
      type: string;
      status: string;
      space: { key: string };
      body: { storage: { value: string } };
      version: { number: number };
      history: {
        createdDate: string;
        createdBy: { displayName: string };
        lastUpdated: { when: string };
      };
      _links: { webui: string };
    }>('/content', {
      method: 'POST',
      body: JSON.stringify(body)
    });

    EventBus.emit('confluence:page:created', { pageId: response.id });

    return this.mapPage(response);
  }

  /**
   * Update page
   */
  async updatePage(pageId: string, content: string): Promise<ConfluencePage> {
    if (this.mockMode) {
      const page = this.mockData.get(pageId);
      if (!page) throw new Error('Page not found');
      page.content = content;
      page.version++;
      page.updatedAt = new Date().toISOString();
      return page;
    }

    // Get current version
    const current = await this.getPage(pageId);

    const body = {
      type: 'page',
      title: current.title,
      version: { number: current.version + 1 },
      body: {
        storage: {
          value: content,
          representation: 'storage'
        }
      }
    };

    const response = await this.request<{
      id: string;
      title: string;
      type: string;
      status: string;
      space: { key: string };
      body: { storage: { value: string } };
      version: { number: number };
      history: {
        createdDate: string;
        createdBy: { displayName: string };
        lastUpdated: { when: string };
      };
      _links: { webui: string };
    }>(`/content/${pageId}`, {
      method: 'PUT',
      body: JSON.stringify(body)
    });

    EventBus.emit('confluence:page:updated', { pageId });

    return this.mapPage(response);
  }

  /**
   * Get spaces
   */
  async getSpaces(): Promise<ConfluenceSpace[]> {
    if (this.mockMode) {
      return [{
        key: 'MOCK',
        name: 'Mock Space',
        type: 'global'
      }];
    }

    const response = await this.request<{
      results: Array<{
        key: string;
        name: string;
        type: string;
        description?: { plain?: { value: string } };
        homepage?: { id: string };
      }>;
    }>('/space');

    return response.results.map(s => ({
      key: s.key,
      name: s.name,
      type: s.type as 'global' | 'personal',
      description: s.description?.plain?.value,
      homepageId: s.homepage?.id
    }));
  }

  /**
   * Map API response to page
   */
  private mapPage(data: {
    id: string;
    title: string;
    type: string;
    status: string;
    space: { key: string };
    body?: { storage?: { value: string } };
    version: { number: number };
    history: {
      createdDate: string;
      createdBy: { displayName: string };
      lastUpdated: { when: string };
    };
    _links: { webui: string };
  }): ConfluencePage {
    return {
      id: data.id,
      title: data.title,
      spaceKey: data.space.key,
      type: data.type as 'page' | 'blogpost',
      status: data.status as 'current' | 'draft' | 'trashed',
      content: data.body?.storage?.value || '',
      version: data.version.number,
      createdAt: data.history.createdDate,
      updatedAt: data.history.lastUpdated.when,
      createdBy: data.history.createdBy.displayName,
      url: this.config ? `${this.config.baseUrl}/wiki${data._links.webui}` : data._links.webui
    };
  }

  /**
   * Mock search
   */
  private mockSearch(query: string, limit: number): ConfluenceSearchResult[] {
    const results: ConfluenceSearchResult[] = [];
    const lower = query.toLowerCase();

    for (const page of this.mockData.values()) {
      if (page.title.toLowerCase().includes(lower) ||
          page.content.toLowerCase().includes(lower)) {
        results.push({
          page,
          excerpt: page.content.slice(0, 200),
          score: 1.0
        });
      }
    }

    return results.slice(0, limit);
  }

  /**
   * Add mock page
   */
  addMockPage(page: ConfluencePage): void {
    this.mockData.set(page.id, page);
  }
}

// Export singleton
export const ConfluenceAdapter = new ConfluenceAdapterClass();

// Export class for testing
export { ConfluenceAdapterClass };
