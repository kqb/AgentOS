/**
 * Agent type definitions for AgentOS
 */

/** Agent status values */
export type AgentStatus =
  | 'initializing'
  | 'ready'
  | 'bound'
  | 'working'
  | 'idle'
  | 'error'
  | 'terminated';

/** Agent specialization types */
export type AgentType =
  | 'general'
  | 'orchestrator'
  | 'team-lead'
  | 'code-generator'
  | 'test-writer'
  | 'code-reviewer'
  | 'debugger'
  | 'doc-writer'
  | 'qa-engineer'
  | 'swe'
  | 'swe-pool';

/** Task status values */
export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

/** Configuration for creating a new agent */
export interface AgentConfig {
  /** Agent type/specialization */
  type: AgentType;
  /** Human-readable name */
  name: string;
  /** Whether to auto-start and bind to Cascade */
  autoStart?: boolean;
  /** Additional specialization details */
  specialization?: string | null;
  /** Initial context data */
  context?: Record<string, unknown>;
  /** Skills this agent can execute */
  skills?: string[];
  /** Maximum concurrent tasks */
  maxConcurrentTasks?: number;
}

/** A task in the agent's queue */
export interface AgentTask {
  /** Unique task identifier */
  id: string;
  /** Task type */
  type: string;
  /** Task instructions or description */
  instructions?: string;
  description?: string;
  /** When the task was added */
  addedAt: number;
  /** Current task status */
  status: TaskStatus;
  /** Task priority (higher = more urgent) */
  priority?: number;
  /** Workflow context if part of a workflow */
  workflowId?: string;
  workflowState?: string;
  /** Additional task data */
  data?: Record<string, unknown>;
}

/** Result of a completed task */
export interface TaskResult {
  /** The completed task */
  task: AgentTask;
  /** Task output/response */
  output: string;
  /** When the task was completed */
  completedAt: number;
  /** Whether the task succeeded */
  success: boolean;
  /** Error information if failed */
  error?: string;
}

/** Agent context - persistent data across tasks */
export interface AgentContext {
  /** Workflow ID if operating within a workflow */
  workflowId?: string;
  /** Current workflow state */
  workflowState?: string;
  /** Handoff source if this agent was created via handoff */
  handoffFrom?: string;
  /** Handoff context description */
  handoffContext?: string;
  /** Custom context values saved via [CONTEXT_SAVE] */
  [key: string]: unknown;
}

/** Full agent state representation */
export interface Agent {
  /** Unique agent identifier */
  id: string;
  /** Agent configuration */
  config: AgentConfig;
  /** Current status */
  status: AgentStatus;
  /** Reference to bound Cascade instance */
  cascadeInstance: HTMLElement | null;
  /** Queue of pending tasks */
  taskQueue: AgentTask[];
  /** Persistent context data */
  context: AgentContext;
  /** Completed task results */
  results: TaskResult[];
  /** When the agent was created */
  createdAt: number;
  /** Last activity timestamp */
  lastActivity: number;
  /** DOM node for inspection */
  domNode: HTMLElement | null;
  /** MutationObserver for output watching */
  outputObserver?: MutationObserver;
}

/** Serialized agent state for persistence */
export interface SerializedAgent {
  id: string;
  config: AgentConfig;
  status: AgentStatus;
  taskQueue: AgentTask[];
  context: AgentContext;
  resultsCount: number;
  createdAt: number;
  lastActivity: number;
}

/** Agent state map entry */
export interface AgentStateEntry {
  agent: Agent;
  cascadeTab: HTMLElement | null;
  boundAt: number | null;
}

/** Agent spawn options */
export interface SpawnOptions extends Partial<AgentConfig> {
  /** Skip Cascade binding */
  skipBinding?: boolean;
  /** Inherit context from another agent */
  inheritFrom?: string;
}

/** Handoff request */
export interface HandoffRequest {
  /** Source agent ID */
  fromAgent: string;
  /** Target agent type */
  toType: AgentType;
  /** Context for the handoff */
  context: string;
  /** Workflow ID if applicable */
  workflowId?: string;
}

/** Agent pool configuration */
export interface AgentPoolConfig {
  /** Pool type identifier */
  type: AgentType;
  /** Minimum agents to maintain */
  minAgents: number;
  /** Maximum agents allowed */
  maxAgents: number;
  /** Whether to auto-scale */
  autoScale: boolean;
}
