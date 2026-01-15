/**
 * GitHub Integration Adapter
 *
 * REST API client for GitHub operations:
 * - Issues and pull requests
 * - Reviews and comments
 * - Repository management
 * - Actions/Workflows
 */

import { IntegrationAdapter, RequestOptions } from './base.js';
import type {
  IntegrationResult,
  GitHubIssue,
  GitHubPullRequest,
  GitHubReview,
  GitHubComment
} from '../types/integration.js';

/** GitHub user */
interface GitHubUser {
  login: string;
  id: number;
  avatar_url: string;
  type: string;
}

/** Create issue payload */
interface CreateIssuePayload {
  owner: string;
  repo: string;
  title: string;
  body?: string;
  assignees?: string[];
  labels?: string[];
  milestone?: number;
}

/** Create PR payload */
interface CreatePullRequestPayload {
  owner: string;
  repo: string;
  title: string;
  body?: string;
  head: string;
  base: string;
  draft?: boolean;
}

/**
 * GitHub Integration Adapter
 */
export class GitHubAdapter extends IntegrationAdapter<'github'> {
  readonly type = 'github' as const;
  readonly name = 'GitHub';
  readonly baseUrl = 'https://api.github.com';

  /**
   * Authenticate with GitHub using personal access token
   */
  protected async doAuthenticate(): Promise<boolean> {
    if (!this.config?.credentials) {
      throw new Error('GitHub credentials not configured');
    }

    const { token } = this.config.credentials as { token: string };
    this.authState.token = token;

    const result = await this.request<GitHubUser>('user');
    return result.success;
  }

  /**
   * Get an issue
   */
  async getIssue(owner: string, repo: string, issueNumber: number): Promise<IntegrationResult<GitHubIssue>> {
    return this.request<GitHubIssue>(`repos/${owner}/${repo}/issues/${issueNumber}`);
  }

  /**
   * List issues for a repository
   */
  async listIssues(
    owner: string,
    repo: string,
    options: { state?: 'open' | 'closed' | 'all'; labels?: string; assignee?: string } = {}
  ): Promise<IntegrationResult<GitHubIssue[]>> {
    const params = new URLSearchParams();
    if (options.state) params.set('state', options.state);
    if (options.labels) params.set('labels', options.labels);
    if (options.assignee) params.set('assignee', options.assignee);

    const query = params.toString();
    return this.request<GitHubIssue[]>(
      `repos/${owner}/${repo}/issues${query ? `?${query}` : ''}`
    );
  }

  /**
   * Create an issue
   */
  async createIssue(payload: CreateIssuePayload): Promise<IntegrationResult<GitHubIssue>> {
    const { owner, repo, ...body } = payload;
    return this.request<GitHubIssue>(`repos/${owner}/${repo}/issues`, {
      method: 'POST',
      body
    });
  }

  /**
   * Update an issue
   */
  async updateIssue(
    owner: string,
    repo: string,
    issueNumber: number,
    updates: Partial<Omit<CreateIssuePayload, 'owner' | 'repo'>>
  ): Promise<IntegrationResult<GitHubIssue>> {
    return this.request<GitHubIssue>(`repos/${owner}/${repo}/issues/${issueNumber}`, {
      method: 'PATCH',
      body: updates
    });
  }

  /**
   * Close an issue
   */
  async closeIssue(owner: string, repo: string, issueNumber: number): Promise<IntegrationResult<GitHubIssue>> {
    return this.updateIssue(owner, repo, issueNumber, { state: 'closed' } as unknown as Partial<Omit<CreateIssuePayload, 'owner' | 'repo'>>);
  }

  /**
   * Get a pull request
   */
  async getPullRequest(owner: string, repo: string, prNumber: number): Promise<IntegrationResult<GitHubPullRequest>> {
    return this.request<GitHubPullRequest>(`repos/${owner}/${repo}/pulls/${prNumber}`);
  }

  /**
   * List pull requests
   */
  async listPullRequests(
    owner: string,
    repo: string,
    options: { state?: 'open' | 'closed' | 'all'; base?: string; head?: string } = {}
  ): Promise<IntegrationResult<GitHubPullRequest[]>> {
    const params = new URLSearchParams();
    if (options.state) params.set('state', options.state);
    if (options.base) params.set('base', options.base);
    if (options.head) params.set('head', options.head);

    const query = params.toString();
    return this.request<GitHubPullRequest[]>(
      `repos/${owner}/${repo}/pulls${query ? `?${query}` : ''}`
    );
  }

  /**
   * Create a pull request
   */
  async createPullRequest(payload: CreatePullRequestPayload): Promise<IntegrationResult<GitHubPullRequest>> {
    const { owner, repo, ...body } = payload;
    return this.request<GitHubPullRequest>(`repos/${owner}/${repo}/pulls`, {
      method: 'POST',
      body
    });
  }

  /**
   * Merge a pull request
   */
  async mergePullRequest(
    owner: string,
    repo: string,
    prNumber: number,
    options: { commit_title?: string; merge_method?: 'merge' | 'squash' | 'rebase' } = {}
  ): Promise<IntegrationResult<{ merged: boolean; sha: string }>> {
    return this.request<{ merged: boolean; sha: string }>(
      `repos/${owner}/${repo}/pulls/${prNumber}/merge`,
      {
        method: 'PUT',
        body: options
      }
    );
  }

  /**
   * Get reviews for a pull request
   */
  async getReviews(owner: string, repo: string, prNumber: number): Promise<IntegrationResult<GitHubReview[]>> {
    return this.request<GitHubReview[]>(`repos/${owner}/${repo}/pulls/${prNumber}/reviews`);
  }

  /**
   * Create a review
   */
  async createReview(
    owner: string,
    repo: string,
    prNumber: number,
    review: { body?: string; event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT'; comments?: Array<{ path: string; position: number; body: string }> }
  ): Promise<IntegrationResult<GitHubReview>> {
    return this.request<GitHubReview>(`repos/${owner}/${repo}/pulls/${prNumber}/reviews`, {
      method: 'POST',
      body: review
    });
  }

  /**
   * Add a comment to an issue/PR
   */
  async addComment(
    owner: string,
    repo: string,
    issueNumber: number,
    body: string
  ): Promise<IntegrationResult<GitHubComment>> {
    return this.request<GitHubComment>(`repos/${owner}/${repo}/issues/${issueNumber}/comments`, {
      method: 'POST',
      body: { body }
    });
  }

  /**
   * Get comments for an issue/PR
   */
  async getComments(owner: string, repo: string, issueNumber: number): Promise<IntegrationResult<GitHubComment[]>> {
    return this.request<GitHubComment[]>(`repos/${owner}/${repo}/issues/${issueNumber}/comments`);
  }

  /**
   * Trigger a workflow dispatch
   */
  async triggerWorkflow(
    owner: string,
    repo: string,
    workflowId: string | number,
    ref: string,
    inputs?: Record<string, string>
  ): Promise<IntegrationResult<void>> {
    return this.request<void>(`repos/${owner}/${repo}/actions/workflows/${workflowId}/dispatches`, {
      method: 'POST',
      body: { ref, inputs }
    });
  }

  /**
   * Get workflow runs
   */
  async getWorkflowRuns(
    owner: string,
    repo: string,
    options: { workflow_id?: string | number; branch?: string; status?: string } = {}
  ): Promise<IntegrationResult<{ workflow_runs: Array<{ id: number; status: string; conclusion: string | null }> }>> {
    const params = new URLSearchParams();
    if (options.branch) params.set('branch', options.branch);
    if (options.status) params.set('status', options.status);

    let path = `repos/${owner}/${repo}/actions/runs`;
    if (options.workflow_id) {
      path = `repos/${owner}/${repo}/actions/workflows/${options.workflow_id}/runs`;
    }

    const query = params.toString();
    return this.request<{ workflow_runs: Array<{ id: number; status: string; conclusion: string | null }> }>(
      `${path}${query ? `?${query}` : ''}`
    );
  }

  /**
   * Test connection
   */
  async testConnection(): Promise<boolean> {
    const result = await this.request<GitHubUser>('user');
    return result.success;
  }

  /**
   * Mock request handler
   */
  protected async mockRequest<R>(path: string, options: RequestOptions): Promise<IntegrationResult<R>> {
    console.log(`[GitHub Mock] ${options.method || 'GET'} ${path}`);

    if (path === 'user') {
      return {
        success: true,
        data: {
          login: 'mock-user',
          id: 12345,
          avatar_url: 'https://github.com/mock-user.png',
          type: 'User'
        } as R
      };
    }

    if (path.includes('/issues/') && !path.includes('/comments')) {
      const parts = path.split('/');
      const issueNumber = parts[parts.length - 1];
      return {
        success: true,
        data: {
          number: parseInt(issueNumber),
          title: `Mock Issue #${issueNumber}`,
          state: 'open',
          body: 'This is a mock issue',
          user: { login: 'mock-user' },
          labels: [],
          assignees: [],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        } as R
      };
    }

    if (path.includes('/pulls/') && !path.includes('/reviews') && !path.includes('/merge')) {
      const parts = path.split('/');
      const prNumber = parts[parts.length - 1];
      return {
        success: true,
        data: {
          number: parseInt(prNumber),
          title: `Mock PR #${prNumber}`,
          state: 'open',
          body: 'This is a mock pull request',
          head: { ref: 'feature-branch' },
          base: { ref: 'main' },
          mergeable: true,
          user: { login: 'mock-user' },
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        } as R
      };
    }

    return { success: true, data: {} as R };
  }
}

// Export singleton instance
export const githubAdapter = new GitHubAdapter();
