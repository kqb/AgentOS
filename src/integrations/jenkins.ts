/**
 * Jenkins Integration Adapter
 *
 * REST API client for Jenkins operations:
 * - Build triggering and monitoring
 * - Job management
 * - Build status and logs
 */

import { IntegrationAdapter, RequestOptions } from './base.js';
import type { IntegrationResult, JenkinsBuild, JenkinsJob } from '../types/integration.js';

/** Build parameters */
interface BuildParameter {
  name: string;
  value: string;
}

/** Queue item response */
interface QueueItem {
  id: number;
  executable?: {
    number: number;
    url: string;
  };
  blocked: boolean;
  buildable: boolean;
  why?: string;
}

/**
 * Jenkins Integration Adapter
 */
export class JenkinsAdapter extends IntegrationAdapter<'jenkins'> {
  readonly type = 'jenkins' as const;
  readonly name = 'Jenkins';
  readonly baseUrl = 'https://your-jenkins.com';

  /**
   * Authenticate with Jenkins
   */
  protected async doAuthenticate(): Promise<boolean> {
    if (!this.config?.credentials) {
      throw new Error('Jenkins credentials not configured');
    }

    const { username, apiToken } = this.config.credentials as { username: string; apiToken: string };
    this.authState.token = Buffer.from(`${username}:${apiToken}`).toString('base64');

    const result = await this.request<{ _class: string }>('api/json');
    return result.success;
  }

  /**
   * Build Jenkins-specific headers
   */
  protected buildHeaders(custom?: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...custom
    };

    if (this.authState.token) {
      headers['Authorization'] = `Basic ${this.authState.token}`;
    }

    return headers;
  }

  /**
   * Get job information
   */
  async getJob(jobPath: string): Promise<IntegrationResult<JenkinsJob>> {
    const encodedPath = jobPath.split('/').map(encodeURIComponent).join('/job/');
    return this.request<JenkinsJob>(`job/${encodedPath}/api/json`);
  }

  /**
   * Get build information
   */
  async getBuild(jobPath: string, buildNumber: number | 'lastBuild' | 'lastSuccessfulBuild'): Promise<IntegrationResult<JenkinsBuild>> {
    const encodedPath = jobPath.split('/').map(encodeURIComponent).join('/job/');
    return this.request<JenkinsBuild>(`job/${encodedPath}/${buildNumber}/api/json`);
  }

  /**
   * Trigger a build
   */
  async triggerBuild(jobPath: string, parameters?: BuildParameter[]): Promise<IntegrationResult<{ queueId: number }>> {
    const encodedPath = jobPath.split('/').map(encodeURIComponent).join('/job/');

    let endpoint = `job/${encodedPath}/build`;
    let body: FormData | undefined;

    if (parameters && parameters.length > 0) {
      endpoint = `job/${encodedPath}/buildWithParameters`;
      body = new FormData();
      parameters.forEach(p => body!.append(p.name, p.value));
    }

    // Jenkins returns 201 with Location header containing queue URL
    const result = await this.request<void>(endpoint, {
      method: 'POST',
      body: body as unknown,
      headers: parameters ? { 'Content-Type': 'application/x-www-form-urlencoded' } : undefined
    });

    if (result.success) {
      // In real implementation, parse queue ID from Location header
      return { success: true, data: { queueId: Date.now() } };
    }

    return { success: false, error: result.error };
  }

  /**
   * Get queue item status
   */
  async getQueueItem(queueId: number): Promise<IntegrationResult<QueueItem>> {
    return this.request<QueueItem>(`queue/item/${queueId}/api/json`);
  }

  /**
   * Cancel a queued build
   */
  async cancelQueueItem(queueId: number): Promise<IntegrationResult<void>> {
    return this.request<void>(`queue/cancelItem?id=${queueId}`, {
      method: 'POST'
    });
  }

  /**
   * Stop a running build
   */
  async stopBuild(jobPath: string, buildNumber: number): Promise<IntegrationResult<void>> {
    const encodedPath = jobPath.split('/').map(encodeURIComponent).join('/job/');
    return this.request<void>(`job/${encodedPath}/${buildNumber}/stop`, {
      method: 'POST'
    });
  }

  /**
   * Get build console output
   */
  async getBuildLog(jobPath: string, buildNumber: number, start = 0): Promise<IntegrationResult<{ text: string; hasMore: boolean }>> {
    const encodedPath = jobPath.split('/').map(encodeURIComponent).join('/job/');

    // In real implementation, use /logText/progressiveText endpoint
    const result = await this.request<string>(`job/${encodedPath}/${buildNumber}/logText/progressiveText?start=${start}`);

    if (result.success) {
      return {
        success: true,
        data: {
          text: result.data || '',
          hasMore: false // Check X-More-Data header in real implementation
        }
      };
    }

    return { success: false, error: result.error };
  }

  /**
   * Wait for build to complete
   */
  async waitForBuild(
    jobPath: string,
    buildNumber: number,
    pollInterval = 5000,
    timeout = 600000
  ): Promise<IntegrationResult<JenkinsBuild>> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const result = await this.getBuild(jobPath, buildNumber);

      if (!result.success) {
        return result;
      }

      if (!result.data.building) {
        return result;
      }

      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    return {
      success: false,
      error: `Timeout waiting for build ${jobPath}#${buildNumber}`
    };
  }

  /**
   * Get all jobs (recursive)
   */
  async listJobs(folderPath?: string): Promise<IntegrationResult<JenkinsJob[]>> {
    let endpoint = 'api/json?tree=jobs[name,url,color,lastBuild[number,result]]';

    if (folderPath) {
      const encodedPath = folderPath.split('/').map(encodeURIComponent).join('/job/');
      endpoint = `job/${encodedPath}/api/json?tree=jobs[name,url,color,lastBuild[number,result]]`;
    }

    const result = await this.request<{ jobs: JenkinsJob[] }>(endpoint);

    if (result.success) {
      return { success: true, data: result.data.jobs };
    }

    return { success: false, error: result.error };
  }

  /**
   * Test connection
   */
  async testConnection(): Promise<boolean> {
    const result = await this.request<{ _class: string }>('api/json');
    return result.success;
  }

  /**
   * Mock request handler
   */
  protected async mockRequest<R>(path: string, options: RequestOptions): Promise<IntegrationResult<R>> {
    console.log(`[Jenkins Mock] ${options.method || 'GET'} ${path}`);

    if (path === 'api/json' || path.startsWith('api/json?')) {
      return {
        success: true,
        data: {
          _class: 'hudson.model.Hudson',
          jobs: [
            { name: 'build-job', url: '/job/build-job/', color: 'blue' },
            { name: 'test-job', url: '/job/test-job/', color: 'blue' }
          ]
        } as R
      };
    }

    if (path.includes('/api/json') && path.includes('/job/')) {
      // Job or build info
      if (path.includes('/lastBuild/') || /\/\d+\/api\/json/.test(path)) {
        return {
          success: true,
          data: {
            number: 42,
            url: 'http://jenkins/job/test/42/',
            result: 'SUCCESS',
            building: false,
            duration: 120000,
            timestamp: Date.now() - 120000,
            displayName: '#42'
          } as R
        };
      }

      return {
        success: true,
        data: {
          name: 'mock-job',
          url: 'http://jenkins/job/mock-job/',
          color: 'blue',
          buildable: true,
          lastBuild: { number: 42, result: 'SUCCESS' }
        } as R
      };
    }

    if (path.includes('/build') || path.includes('/buildWithParameters')) {
      return {
        success: true,
        data: { queueId: Date.now() } as R
      };
    }

    return { success: true, data: {} as R };
  }
}

// Export singleton instance
export const jenkinsAdapter = new JenkinsAdapter();
