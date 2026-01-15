/**
 * Integration type definitions for AgentOS
 */

/** Authentication methods */
export type AuthMethod = 'browser-session' | 'api-token' | 'oauth';

/** SSO provider types */
export type SsoProvider = 'okta' | 'azure-ad' | 'ping' | 'onelogin' | 'google' | 'saml-generic';

/** Integration source identifiers */
export type IntegrationSource = 'jira' | 'github' | 'jenkins' | 'slack' | 'confluence';

/** Base configuration for all integrations */
export interface IntegrationConfig {
  /** Unique identifier */
  id: string;
  /** Human-readable name */
  name: string;
  /** Base URL for the service */
  baseUrl: string;
  /** Authentication method */
  authMethod: AuthMethod;
  /** Whether to use mock data */
  mockMode: boolean;
  /** Operation timeout in ms */
  timeout: number;
  /** SSO provider if applicable */
  ssoProvider?: SsoProvider;
}

/** Authentication state */
export interface AuthState {
  /** Whether currently authenticated */
  authenticated: boolean;
  /** Last verification timestamp */
  lastVerified: number;
  /** User information if available */
  user?: {
    id: string;
    email: string;
    displayName: string;
  };
  /** Token expiry timestamp */
  expiresAt?: number;
  /** Whether SSO flow is in progress */
  ssoInProgress: boolean;
  /** Detected SSO provider */
  ssoProviderDetected?: string;
}

/** Integration operation result */
export interface IntegrationResult<T> {
  /** Whether operation succeeded */
  success: boolean;
  /** Result data if successful */
  data?: T;
  /** Error information if failed */
  error?: {
    code: string;
    message: string;
    requiresAuth?: boolean;
    ssoRequired?: boolean;
  };
  /** Operation duration in ms */
  duration: number;
  /** Data source */
  source: 'live' | 'cache' | 'mock';
}

// =============================================================================
// JIRA TYPES
// =============================================================================

/** Jira-specific configuration */
export interface JiraConfig extends IntegrationConfig {
  /** Deployment type */
  deployment: 'cloud' | 'server' | 'datacenter';
  /** Default project key */
  defaultProject?: string;
  /** Custom field mappings */
  customFields?: Record<string, string>;
}

/** Jira issue status */
export interface JiraStatus {
  name: string;
  id: string;
  category: 'new' | 'indeterminate' | 'done';
}

/** Jira user */
export interface JiraUser {
  accountId: string;
  displayName: string;
  email: string;
}

/** Jira issue */
export interface JiraIssue {
  key: string;
  id: string;
  summary: string;
  description: string;
  status: JiraStatus;
  assignee?: JiraUser;
  reporter: JiraUser;
  priority: { name: string; id: string };
  issuetype: { name: string; id: string };
  labels: string[];
  components: Array<{ name: string; id: string }>;
  fixVersions: Array<{ name: string; id: string }>;
  created: string;
  updated: string;
  customFields: Record<string, unknown>;
}

/** Jira transition */
export interface JiraTransition {
  id: string;
  name: string;
  to: { name: string; id: string };
  hasScreen: boolean;
  fields?: Record<string, unknown>;
}

/** Jira comment */
export interface JiraComment {
  id: string;
  body: string;
  author: { accountId: string; displayName: string };
  created: string;
  updated: string;
}

// =============================================================================
// GITHUB TYPES
// =============================================================================

/** GitHub-specific configuration */
export interface GitHubConfig extends IntegrationConfig {
  /** Deployment type */
  deployment: 'cloud' | 'enterprise';
  /** Repository owner */
  owner: string;
  /** Repository name */
  repo: string;
  /** Personal access token */
  token?: string;
}

/** GitHub review */
export interface GitHubReview {
  id: number;
  user: { login: string };
  state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'PENDING' | 'DISMISSED';
  body: string;
  submitted_at: string;
}

/** GitHub pull request */
export interface GitHubPullRequest {
  number: number;
  title: string;
  body: string;
  state: 'open' | 'closed' | 'merged';
  draft: boolean;
  head: { ref: string; sha: string };
  base: { ref: string };
  author: { login: string; avatarUrl: string };
  mergeable: boolean | null;
  mergeable_state: 'clean' | 'dirty' | 'unstable' | 'blocked' | 'unknown';
  reviews: GitHubReview[];
  checkStatus: 'pending' | 'success' | 'failure' | null;
  created_at: string;
  updated_at: string;
  html_url: string;
}

/** GitHub issue */
export interface GitHubIssue {
  number: number;
  title: string;
  body: string;
  state: 'open' | 'closed';
  labels: Array<{ name: string; color: string }>;
  assignees: Array<{ login: string }>;
  created_at: string;
  updated_at: string;
  html_url: string;
}

// =============================================================================
// JENKINS TYPES
// =============================================================================

/** Jenkins-specific configuration */
export interface JenkinsConfig extends IntegrationConfig {
  /** Jenkins version */
  version?: string;
  /** Default job name */
  defaultJob?: string;
}

/** Jenkins build */
export interface JenkinsBuild {
  number: number;
  url: string;
  result: 'SUCCESS' | 'FAILURE' | 'UNSTABLE' | 'ABORTED' | null;
  building: boolean;
  duration: number;
  estimatedDuration: number;
  timestamp: number;
  displayName: string;
  parameters?: Record<string, string>;
  artifacts?: Array<{ fileName: string; relativePath: string }>;
  changeSet?: {
    items: Array<{
      commitId: string;
      author: string;
      message: string;
    }>;
  };
}

/** Jenkins job */
export interface JenkinsJob {
  name: string;
  url: string;
  color: 'blue' | 'red' | 'yellow' | 'grey' | 'disabled' | 'blue_anime' | 'red_anime' | 'yellow_anime';
  lastBuild: JenkinsBuild | null;
  lastSuccessfulBuild: JenkinsBuild | null;
  lastFailedBuild: JenkinsBuild | null;
  buildable: boolean;
  inQueue: boolean;
}

/** Jenkins queue item */
export interface JenkinsQueueItem {
  id: number;
  task: { name: string; url: string };
  why: string;
  buildableStartMilliseconds: number;
}

// =============================================================================
// SLACK TYPES
// =============================================================================

/** Slack-specific configuration */
export interface SlackConfig extends IntegrationConfig {
  /** Webhook URL */
  webhookUrl?: string;
  /** Default channel */
  defaultChannel?: string;
  /** Bot token */
  botToken?: string;
}

/** Slack block */
export interface SlackBlock {
  type: 'section' | 'divider' | 'header' | 'context' | 'actions';
  text?: { type: 'mrkdwn' | 'plain_text'; text: string };
  fields?: Array<{ type: 'mrkdwn' | 'plain_text'; text: string }>;
  elements?: unknown[];
}

/** Slack attachment */
export interface SlackAttachment {
  color?: string;
  title?: string;
  text?: string;
  fields?: Array<{ title: string; value: string; short?: boolean }>;
}

/** Slack message */
export interface SlackMessage {
  channel: string;
  text: string;
  blocks?: SlackBlock[];
  attachments?: SlackAttachment[];
  thread_ts?: string;
  unfurl_links?: boolean;
}

/** Slack API response */
export interface SlackResponse {
  ok: boolean;
  channel?: string;
  ts?: string;
  error?: string;
}

// =============================================================================
// CONFLUENCE TYPES
// =============================================================================

/** Confluence-specific configuration */
export interface ConfluenceConfig extends IntegrationConfig {
  /** Deployment type */
  deployment: 'cloud' | 'server' | 'datacenter';
  /** Default space key */
  defaultSpace?: string;
}

/** Confluence page */
export interface ConfluencePage {
  id: string;
  title: string;
  spaceKey: string;
  body: {
    storage: { value: string; representation: 'storage' };
    view?: { value: string; representation: 'view' };
  };
  version: { number: number };
  ancestors?: Array<{ id: string; title: string }>;
  _links: {
    webui: string;
    edit: string;
  };
}

/** Confluence search result */
export interface ConfluenceSearchResult {
  id: string;
  title: string;
  type: 'page' | 'blogpost' | 'attachment';
  space: { key: string; name: string };
  url: string;
  excerpt: string;
  lastModified: string;
}

// =============================================================================
// SSO TYPES
// =============================================================================

/** SSO provider definition */
export interface SsoProviderDefinition {
  name: SsoProvider;
  displayName: string;
  /** DOM selectors that indicate login page */
  loginPageSelectors: string[];
  /** DOM selectors for username input */
  usernameSelectors: string[];
  /** DOM selectors for password input */
  passwordSelectors: string[];
  /** DOM selectors for submit button */
  submitSelectors: string[];
  /** URL patterns for this provider */
  urlPatterns: RegExp[];
  /** DOM selectors for successful auth */
  successSelectors: string[];
  /** DOM selectors for MFA challenge */
  mfaSelectors: string[];
}

/** SSO detection result */
export interface SsoDetectionResult {
  detected: boolean;
  provider: SsoProvider | null;
  confidence: number;
  currentStep: 'login' | 'password' | 'mfa' | 'complete' | 'error' | null;
  error?: string;
}

/** SSO flow state */
export interface SsoFlowState {
  active: boolean;
  integration: string;
  provider: SsoProvider | null;
  startedAt: number;
  currentStep: SsoDetectionResult['currentStep'];
  awaitingHuman: boolean;
  humanPrompt?: string;
}

// =============================================================================
// POLLING TYPES
// =============================================================================

/** Poll task configuration */
export interface PollTaskConfig {
  /** Poll type identifier */
  type: string;
  /** Polling interval in ms */
  interval: number;
  /** Maximum poll duration */
  timeout?: number;
  /** Workflow ID if applicable */
  workflowId?: string;
  /** Additional parameters */
  params?: Record<string, unknown>;
}

/** Poll task state */
export interface PollTask {
  id: string;
  config: PollTaskConfig;
  startTime: number;
  pollCount: number;
  lastResult: unknown;
  intervalId: ReturnType<typeof setInterval> | null;
}

/** Poll result event */
export interface PollResultEvent {
  pollId: string;
  source: string;
  data: unknown;
  changed: boolean;
  workflowId?: string;
  pollCount: number;
}

// =============================================================================
// MOCK TYPES
// =============================================================================

/** Mock configuration */
export interface MockConfig {
  /** Simulated latency range */
  latency: { min: number; max: number };
  /** Failure rate (0-1) */
  failureRate: number;
  /** Test scenario */
  scenario: 'happy-path' | 'approval-delay' | 'build-failure' | 'sso-challenge';
}
