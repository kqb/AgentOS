/**
 * Workflow type definitions for AgentOS
 */

import type { AgentType } from './agent.js';

/** Workflow state names */
export type WorkflowStateName =
  | 'INIT'
  | 'JIRA_FETCHED'
  | 'GH_ISSUE_CREATED'
  | 'LINKED'
  | 'TASKS_ASSIGNED'
  | 'IMPLEMENTING'
  | 'IMPLEMENTATION_FAILED'
  | 'TESTS_WRITTEN'
  | 'TESTS_RUNNING'
  | 'TESTS_FAILED'
  | 'TESTS_PASSED'
  | 'IN_REVIEW'
  | 'REVIEW_FEEDBACK'
  | 'REVIEW_APPROVED'
  | 'PR_CREATED'
  | 'PR_FEEDBACK'
  | 'PR_APPROVED'
  | 'MERGED'
  | 'BUILD_FAILED'
  | 'BUILD_SUCCESS'
  | 'IN_QA'
  | 'QA_FAILED'
  | 'QA_PASSED'
  | 'READY_FOR_PM_REVIEW'
  | 'PM_REJECTED'
  | 'PM_APPROVED'
  | 'COMPLETED'
  | 'ERROR';

/** Workflow type identifiers */
export type WorkflowType = 'implement-work-item' | 'bug-fix' | 'code-review' | 'custom';

/** Poll configuration for external system monitoring */
export interface PollConfig {
  /** Polling interval in milliseconds */
  interval: number;
  /** External system source */
  source: 'github' | 'jira' | 'jenkins' | 'terminal' | 'custom';
  /** API endpoint identifier */
  endpoint: string;
  /** Success value to match (optional) */
  successValue?: string;
}

/** Workflow state definition */
export interface WorkflowStateDefinition {
  /** State name */
  name: string;
  /** Human-readable description */
  description?: string;
  /** Allowed next states */
  next: WorkflowStateName[];
  /** Timeout in milliseconds (null = no timeout) */
  timeout?: number | null;
  /** Agent type responsible for this state (null = system action) */
  agent: AgentType | null;
  /** Action to execute in this state */
  action: string;
  /** Whether this is a terminal state */
  terminal?: boolean;
  /** Whether agents run in parallel */
  parallel?: boolean;
  /** Maximum retry attempts */
  maxRetries?: number;
  /** Hooks to trigger in this state */
  hooks?: string[];
  /** Poll configuration for async waiting */
  poll?: PollConfig;
}

/** State transition record */
export interface StateTransition {
  /** Previous state */
  from: WorkflowStateName;
  /** New state */
  to: WorkflowStateName;
  /** Transition timestamp */
  timestamp: number;
  /** Additional transition data */
  data?: Record<string, unknown>;
}

/** Workflow error information */
export interface WorkflowError {
  /** Error message */
  message: string;
  /** State where error occurred */
  state: WorkflowStateName;
  /** Error timestamp */
  timestamp: number;
  /** Stack trace if available */
  stack?: string;
}

/** Workflow instance data */
export interface WorkflowData {
  /** Jira ticket key */
  jiraKey?: string;
  /** Fetched Jira item */
  jiraItem?: Record<string, unknown>;
  /** Summary from Jira */
  summary?: string;
  /** Description from Jira */
  description?: string;
  /** Created GitHub issue */
  ghIssue?: {
    number: number;
    html_url: string;
  };
  /** Task breakdown for parallel execution */
  taskBreakdown?: Array<{
    id: string;
    description: string;
    assignee?: string;
  }>;
  /** Branch name for the implementation */
  branchName?: string;
  /** Summary of changes made */
  changesSummary?: string;
  /** Test run identifier */
  testRunId?: number;
  /** Pull request number */
  prNumber?: number;
  /** Pull request URL */
  prUrl?: string;
  /** Build number */
  buildNumber?: number;
  /** Internal: suggested next state */
  _nextState?: WorkflowStateName;
  /** Internal: awaiting SSO */
  _awaitingSso?: boolean;
  /** Workflow start timestamp */
  startedAt?: number;
  /** Who started the workflow */
  startedBy?: string;
  /** Custom data */
  [key: string]: unknown;
}

/** Workflow instance representation */
export interface WorkflowInstance {
  /** Unique workflow identifier */
  id: string;
  /** Workflow type */
  type: WorkflowType;
  /** Current state */
  state: WorkflowStateName;
  /** Workflow data */
  data: WorkflowData;
  /** State transition history */
  history: StateTransition[];
  /** Assigned agents */
  agents: Map<string, string>;
  /** Retry counts per state */
  retries: Record<string, number>;
  /** When workflow was created */
  createdAt: number;
  /** Last update timestamp */
  updatedAt: number;
  /** Error information if failed */
  error: WorkflowError | null;
  /** Cleanup function */
  _cleanup?: () => void;
  /** State timeout handle */
  _stateTimeout?: ReturnType<typeof setTimeout> | null;
}

/** Serialized workflow for persistence */
export interface SerializedWorkflow {
  id: string;
  type: WorkflowType;
  state: WorkflowStateName;
  data: WorkflowData;
  history: StateTransition[];
  agents: Array<[string, string]>;
  retries: Record<string, number>;
  createdAt: number;
  updatedAt: number;
  error: WorkflowError | null;
}

/** Workflow status summary */
export interface WorkflowStatus {
  id: string;
  type: WorkflowType;
  state: WorkflowStateName;
  agents: number;
  age: string;
  history: string;
}

/** System action result */
export interface SystemActionResult {
  /** Next state to transition to (null = wait for event) */
  nextState: WorkflowStateName | null;
  /** Additional data for the transition */
  data?: Record<string, unknown>;
}

/** Workflow event types */
export type WorkflowEventType =
  | 'workflow:start'
  | 'workflow:transition'
  | 'workflow:complete'
  | 'workflow:error'
  | 'workflow:timeout'
  | 'workflow:state_timeout';

/** Workflow event payload */
export interface WorkflowEvent {
  type: WorkflowEventType;
  workflowId: string;
  from?: WorkflowStateName;
  to?: WorkflowStateName;
  data?: Record<string, unknown>;
  error?: WorkflowError;
  duration?: number;
  summary?: StateTransition[];
  state?: WorkflowStateName;
}
