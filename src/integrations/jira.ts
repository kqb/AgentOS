/**
 * Jira Integration Adapter
 *
 * REST API client for Jira operations:
 * - Issue CRUD operations
 * - Status transitions
 * - Comments and attachments
 * - Sprint management
 */

import { IntegrationAdapter, RequestOptions } from './base.js';
import type {
  IntegrationResult,
  JiraIssue,
  JiraTransition,
  JiraComment
} from '../types/integration.js';

/** Jira search result */
interface JiraSearchResult {
  issues: JiraIssue[];
  total: number;
  maxResults: number;
  startAt: number;
}

/** Jira create issue payload */
interface CreateIssuePayload {
  projectKey: string;
  summary: string;
  description?: string;
  issueType: string;
  priority?: string;
  assignee?: string;
  labels?: string[];
  components?: string[];
}

/**
 * Jira Integration Adapter
 */
export class JiraAdapter extends IntegrationAdapter<'jira'> {
  readonly type = 'jira' as const;
  readonly name = 'Jira';
  readonly baseUrl = 'https://your-domain.atlassian.net/rest/api/3';

  /**
   * Authenticate with Jira using API token
   */
  protected async doAuthenticate(): Promise<boolean> {
    if (!this.config?.credentials) {
      throw new Error('Jira credentials not configured');
    }

    // Test authentication by fetching current user
    const { apiToken, email } = this.config.credentials as { apiToken: string; email: string };

    this.authState.token = Buffer.from(`${email}:${apiToken}`).toString('base64');

    const result = await this.request<{ accountId: string }>('myself');
    return result.success;
  }

  /**
   * Build Jira-specific headers
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
   * Get an issue by key
   */
  async getIssue(issueKey: string): Promise<IntegrationResult<JiraIssue>> {
    return this.request<JiraIssue>(`issue/${issueKey}`);
  }

  /**
   * Search issues using JQL
   */
  async searchIssues(
    jql: string,
    options: { startAt?: number; maxResults?: number } = {}
  ): Promise<IntegrationResult<JiraSearchResult>> {
    const params = new URLSearchParams({
      jql,
      startAt: String(options.startAt || 0),
      maxResults: String(options.maxResults || 50)
    });

    return this.request<JiraSearchResult>(`search?${params}`);
  }

  /**
   * Create a new issue
   */
  async createIssue(payload: CreateIssuePayload): Promise<IntegrationResult<JiraIssue>> {
    const body = {
      fields: {
        project: { key: payload.projectKey },
        summary: payload.summary,
        description: payload.description ? {
          type: 'doc',
          version: 1,
          content: [{
            type: 'paragraph',
            content: [{ type: 'text', text: payload.description }]
          }]
        } : undefined,
        issuetype: { name: payload.issueType },
        priority: payload.priority ? { name: payload.priority } : undefined,
        assignee: payload.assignee ? { accountId: payload.assignee } : undefined,
        labels: payload.labels,
        components: payload.components?.map(c => ({ name: c }))
      }
    };

    return this.request<JiraIssue>('issue', {
      method: 'POST',
      body
    });
  }

  /**
   * Update an issue
   */
  async updateIssue(
    issueKey: string,
    fields: Record<string, unknown>
  ): Promise<IntegrationResult<void>> {
    return this.request<void>(`issue/${issueKey}`, {
      method: 'PUT',
      body: { fields }
    });
  }

  /**
   * Get available transitions for an issue
   */
  async getTransitions(issueKey: string): Promise<IntegrationResult<{ transitions: JiraTransition[] }>> {
    return this.request<{ transitions: JiraTransition[] }>(`issue/${issueKey}/transitions`);
  }

  /**
   * Transition an issue to a new status
   */
  async transitionIssue(
    issueKey: string,
    transitionId: string,
    comment?: string
  ): Promise<IntegrationResult<void>> {
    const body: { transition: { id: string }; update?: unknown } = {
      transition: { id: transitionId }
    };

    if (comment) {
      body.update = {
        comment: [{
          add: {
            body: {
              type: 'doc',
              version: 1,
              content: [{
                type: 'paragraph',
                content: [{ type: 'text', text: comment }]
              }]
            }
          }
        }]
      };
    }

    return this.request<void>(`issue/${issueKey}/transitions`, {
      method: 'POST',
      body
    });
  }

  /**
   * Add a comment to an issue
   */
  async addComment(issueKey: string, comment: string): Promise<IntegrationResult<JiraComment>> {
    return this.request<JiraComment>(`issue/${issueKey}/comment`, {
      method: 'POST',
      body: {
        body: {
          type: 'doc',
          version: 1,
          content: [{
            type: 'paragraph',
            content: [{ type: 'text', text: comment }]
          }]
        }
      }
    });
  }

  /**
   * Get comments for an issue
   */
  async getComments(issueKey: string): Promise<IntegrationResult<{ comments: JiraComment[] }>> {
    return this.request<{ comments: JiraComment[] }>(`issue/${issueKey}/comment`);
  }

  /**
   * Assign issue to a user
   */
  async assignIssue(issueKey: string, accountId: string | null): Promise<IntegrationResult<void>> {
    return this.request<void>(`issue/${issueKey}/assignee`, {
      method: 'PUT',
      body: { accountId }
    });
  }

  /**
   * Test connection to Jira
   */
  async testConnection(): Promise<boolean> {
    const result = await this.request<unknown>('myself');
    return result.success;
  }

  /**
   * Mock request handler
   */
  protected async mockRequest<R>(path: string, options: RequestOptions): Promise<IntegrationResult<R>> {
    console.log(`[Jira Mock] ${options.method || 'GET'} ${path}`);

    // Mock responses
    if (path.startsWith('issue/') && !path.includes('/')) {
      const issueKey = path.replace('issue/', '');
      return {
        success: true,
        data: {
          key: issueKey,
          id: '10001',
          fields: {
            summary: `Mock issue: ${issueKey}`,
            status: { name: 'To Do' },
            assignee: null,
            priority: { name: 'Medium' },
            created: new Date().toISOString(),
            updated: new Date().toISOString()
          }
        } as R
      };
    }

    if (path === 'myself') {
      return {
        success: true,
        data: { accountId: 'mock-user-123' } as R
      };
    }

    if (path.includes('/transitions')) {
      return {
        success: true,
        data: {
          transitions: [
            { id: '11', name: 'To Do' },
            { id: '21', name: 'In Progress' },
            { id: '31', name: 'Done' }
          ]
        } as R
      };
    }

    return { success: true, data: {} as R };
  }
}

// Export singleton instance
export const jiraAdapter = new JiraAdapter();
