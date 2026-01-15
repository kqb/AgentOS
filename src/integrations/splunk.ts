/**
 * Splunk Adapter - Splunk integration for log analysis
 *
 * Provides access to:
 * - Search queries
 * - Real-time data
 * - Saved searches
 * - Alerts
 */

import { EventBus } from '../core/event-bus.js';

/** Splunk configuration */
export interface SplunkConfig {
  baseUrl: string;
  username?: string;
  password?: string;
  token?: string;
  app?: string;
}

/** Search result */
export interface SplunkSearchResult {
  results: SplunkEvent[];
  fields: SplunkField[];
  stats: {
    totalEvents: number;
    scanCount: number;
    duration: number;
  };
}

/** Splunk event */
export interface SplunkEvent {
  _raw: string;
  _time: string;
  _index: string;
  _sourcetype: string;
  host: string;
  source: string;
  [key: string]: unknown;
}

/** Splunk field */
export interface SplunkField {
  name: string;
  type: string;
  count: number;
}

/** Search job */
export interface SplunkSearchJob {
  sid: string;
  status: 'queued' | 'parsing' | 'running' | 'finalizing' | 'done' | 'failed';
  eventCount: number;
  scanCount: number;
  doneProgress: number;
}

/** Saved search */
export interface SplunkSavedSearch {
  name: string;
  search: string;
  description?: string;
  schedule?: string;
  isScheduled: boolean;
}

/** Alert */
export interface SplunkAlert {
  name: string;
  severity: 'info' | 'low' | 'medium' | 'high' | 'critical';
  count: number;
  triggeredAt: string;
  search: string;
}

/** Splunk adapter singleton */
class SplunkAdapterClass {
  private config: SplunkConfig | null = null;
  private mockMode = false;
  private mockData: SplunkEvent[] = [];

  /**
   * Configure the adapter
   */
  configure(config: SplunkConfig): void {
    this.config = config;
    console.log('[Splunk] Configured for:', config.baseUrl);
  }

  /**
   * Enable mock mode
   */
  enableMockMode(): void {
    this.mockMode = true;
    this.generateMockData();
    console.log('[Splunk] Mock mode enabled');
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
    if (!this.config) return '';

    if (this.config.token) {
      return `Bearer ${this.config.token}`;
    }

    if (this.config.username && this.config.password) {
      const credentials = btoa(`${this.config.username}:${this.config.password}`);
      return `Basic ${credentials}`;
    }

    return '';
  }

  /**
   * Make API request
   */
  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    if (!this.config) {
      throw new Error('Splunk not configured');
    }

    const url = `${this.config.baseUrl}/services${endpoint}`;
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
      throw new Error(`Splunk API error: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Execute a search query
   */
  async search(
    query: string,
    options?: {
      earliest?: string;
      latest?: string;
      maxResults?: number;
    }
  ): Promise<SplunkSearchResult> {
    if (this.mockMode) {
      return this.mockSearch(query, options?.maxResults || 100);
    }

    // Create search job
    const job = await this.createSearchJob(query, options);

    // Wait for job to complete
    let status = await this.getJobStatus(job.sid);
    while (status.status !== 'done' && status.status !== 'failed') {
      await new Promise(resolve => setTimeout(resolve, 1000));
      status = await this.getJobStatus(job.sid);
    }

    if (status.status === 'failed') {
      throw new Error('Search job failed');
    }

    // Get results
    return this.getJobResults(job.sid);
  }

  /**
   * Create search job
   */
  async createSearchJob(
    query: string,
    options?: {
      earliest?: string;
      latest?: string;
    }
  ): Promise<SplunkSearchJob> {
    if (this.mockMode) {
      return {
        sid: `mock-${Date.now()}`,
        status: 'done',
        eventCount: this.mockData.length,
        scanCount: this.mockData.length,
        doneProgress: 1.0
      };
    }

    const params = new URLSearchParams({
      search: query,
      earliest_time: options?.earliest || '-1h',
      latest_time: options?.latest || 'now',
      output_mode: 'json'
    });

    const response = await this.request<{
      sid: string;
    }>('/search/jobs', {
      method: 'POST',
      body: params.toString(),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });

    EventBus.emit('splunk:search:started', { sid: response.sid, query });

    return {
      sid: response.sid,
      status: 'queued',
      eventCount: 0,
      scanCount: 0,
      doneProgress: 0
    };
  }

  /**
   * Get search job status
   */
  async getJobStatus(sid: string): Promise<SplunkSearchJob> {
    if (this.mockMode) {
      return {
        sid,
        status: 'done',
        eventCount: this.mockData.length,
        scanCount: this.mockData.length,
        doneProgress: 1.0
      };
    }

    const response = await this.request<{
      entry: Array<{
        content: {
          dispatchState: string;
          eventCount: number;
          scanCount: number;
          doneProgress: number;
        };
      }>;
    }>(`/search/jobs/${sid}?output_mode=json`);

    const content = response.entry[0].content;

    return {
      sid,
      status: this.mapJobStatus(content.dispatchState),
      eventCount: content.eventCount,
      scanCount: content.scanCount,
      doneProgress: content.doneProgress
    };
  }

  /**
   * Get search job results
   */
  async getJobResults(sid: string, offset = 0, count = 100): Promise<SplunkSearchResult> {
    if (this.mockMode) {
      return this.mockSearch('', count);
    }

    const params = new URLSearchParams({
      output_mode: 'json',
      offset: String(offset),
      count: String(count)
    });

    const response = await this.request<{
      results: SplunkEvent[];
      fields: Array<{ name: string; type: string }>;
    }>(`/search/jobs/${sid}/results?${params}`);

    return {
      results: response.results,
      fields: response.fields.map(f => ({ ...f, count: 0 })),
      stats: {
        totalEvents: response.results.length,
        scanCount: response.results.length,
        duration: 0
      }
    };
  }

  /**
   * Get saved searches
   */
  async getSavedSearches(): Promise<SplunkSavedSearch[]> {
    if (this.mockMode) {
      return [{
        name: 'Mock Error Search',
        search: 'index=* level=error',
        description: 'Find all errors',
        isScheduled: true,
        schedule: '*/15 * * * *'
      }];
    }

    const response = await this.request<{
      entry: Array<{
        name: string;
        content: {
          search: string;
          description: string;
          is_scheduled: string;
          cron_schedule?: string;
        };
      }>;
    }>('/saved/searches?output_mode=json');

    return response.entry.map(e => ({
      name: e.name,
      search: e.content.search,
      description: e.content.description,
      isScheduled: e.content.is_scheduled === '1',
      schedule: e.content.cron_schedule
    }));
  }

  /**
   * Run saved search
   */
  async runSavedSearch(name: string): Promise<SplunkSearchResult> {
    if (this.mockMode) {
      return this.mockSearch('', 100);
    }

    const response = await this.request<{
      sid: string;
    }>(`/saved/searches/${encodeURIComponent(name)}/dispatch`, {
      method: 'POST'
    });

    // Wait for job to complete
    let status = await this.getJobStatus(response.sid);
    while (status.status !== 'done' && status.status !== 'failed') {
      await new Promise(resolve => setTimeout(resolve, 1000));
      status = await this.getJobStatus(response.sid);
    }

    return this.getJobResults(response.sid);
  }

  /**
   * Get alerts
   */
  async getAlerts(): Promise<SplunkAlert[]> {
    if (this.mockMode) {
      return [{
        name: 'High Error Rate',
        severity: 'high',
        count: 42,
        triggeredAt: new Date().toISOString(),
        search: 'index=* level=error | stats count'
      }];
    }

    const response = await this.request<{
      entry: Array<{
        name: string;
        content: {
          'alert.severity': string;
          triggered_alert_count: number;
          updated: string;
          search: string;
        };
      }>;
    }>('/alerts/fired_alerts?output_mode=json');

    return response.entry.map(e => ({
      name: e.name,
      severity: this.mapSeverity(e.content['alert.severity']),
      count: e.content.triggered_alert_count,
      triggeredAt: e.content.updated,
      search: e.content.search
    }));
  }

  /**
   * Map job status
   */
  private mapJobStatus(state: string): SplunkSearchJob['status'] {
    const statusMap: Record<string, SplunkSearchJob['status']> = {
      'QUEUED': 'queued',
      'PARSING': 'parsing',
      'RUNNING': 'running',
      'FINALIZING': 'finalizing',
      'DONE': 'done',
      'FAILED': 'failed'
    };
    return statusMap[state] || 'queued';
  }

  /**
   * Map severity
   */
  private mapSeverity(severity: string): SplunkAlert['severity'] {
    const severityMap: Record<string, SplunkAlert['severity']> = {
      '1': 'info',
      '2': 'low',
      '3': 'medium',
      '4': 'high',
      '5': 'critical'
    };
    return severityMap[severity] || 'info';
  }

  /**
   * Generate mock data
   */
  private generateMockData(): void {
    const levels = ['DEBUG', 'INFO', 'WARN', 'ERROR'];
    const hosts = ['web-1', 'web-2', 'api-1', 'db-1'];
    const now = Date.now();

    this.mockData = [];

    for (let i = 0; i < 100; i++) {
      const level = levels[Math.floor(Math.random() * levels.length)];
      const host = hosts[Math.floor(Math.random() * hosts.length)];
      const time = new Date(now - i * 60000).toISOString();

      this.mockData.push({
        _raw: `${time} ${level} [${host}] Sample log message ${i}`,
        _time: time,
        _index: 'main',
        _sourcetype: 'syslog',
        host,
        source: `/var/log/${host}.log`,
        level
      });
    }
  }

  /**
   * Mock search
   */
  private mockSearch(query: string, maxResults: number): SplunkSearchResult {
    let results = this.mockData;

    // Simple filter
    if (query) {
      const lower = query.toLowerCase();
      results = results.filter(e =>
        e._raw.toLowerCase().includes(lower)
      );
    }

    results = results.slice(0, maxResults);

    return {
      results,
      fields: [
        { name: '_raw', type: 'string', count: results.length },
        { name: '_time', type: 'timestamp', count: results.length },
        { name: 'host', type: 'string', count: results.length },
        { name: 'level', type: 'string', count: results.length }
      ],
      stats: {
        totalEvents: results.length,
        scanCount: this.mockData.length,
        duration: 0.5
      }
    };
  }
}

// Export singleton
export const SplunkAdapter = new SplunkAdapterClass();

// Export class for testing
export { SplunkAdapterClass };
