/**
 * Skill type definitions for AgentOS
 */

/** Skill input parameter types */
export type SkillParamType = 'string' | 'number' | 'boolean' | 'string[]' | 'object';

/** Skill input parameter definition */
export interface SkillInput {
  /** Parameter name */
  name: string;
  /** Parameter type */
  type: SkillParamType;
  /** Whether this parameter is required */
  required: boolean;
  /** Default value if not provided */
  default?: unknown;
  /** Parameter description */
  description?: string;
  /** Validation pattern (regex for strings) */
  pattern?: string;
  /** Allowed values (enum) */
  enum?: string[];
}

/** Skill output definition */
export interface SkillOutput {
  /** Output name */
  name: string;
  /** Output type */
  type: SkillParamType;
  /** Output description */
  description?: string;
}

/** Skill prompt templates */
export interface SkillPrompts {
  /** System prompt for the skill */
  system: string;
  /** User prompt template (with {{variable}} placeholders) */
  user?: string;
  /** Expected completion signal */
  completion_signal: string;
  /** Error handling instructions */
  error_handling?: string;
}

/** Skill configuration schema */
export interface SkillConfig {
  /** Unique skill name */
  name: string;
  /** Skill version (semver) */
  version: string;
  /** Human-readable description */
  description: string;
  /** Skill category */
  category?: 'code' | 'test' | 'docs' | 'review' | 'automation' | 'custom';
  /** Input parameters */
  inputs: SkillInput[];
  /** Output definitions */
  outputs: SkillOutput[];
  /** Prompt templates */
  prompts: SkillPrompts;
  /** Agent types that can execute this skill */
  allowedAgents?: string[];
  /** Estimated execution time in ms */
  estimatedDuration?: number;
  /** Required context keys */
  requiredContext?: string[];
  /** Tags for search/filtering */
  tags?: string[];
}

/** Runtime skill instance */
export interface Skill {
  /** Skill configuration */
  config: SkillConfig;
  /** Load timestamp */
  loadedAt: number;
  /** Source path */
  sourcePath: string;
  /** Whether skill is valid */
  valid: boolean;
  /** Validation errors if any */
  validationErrors?: string[];
}

/** Skill execution context */
export interface SkillExecutionContext {
  /** Agent executing the skill */
  agentId: string;
  /** Workflow ID if applicable */
  workflowId?: string;
  /** Input values */
  inputs: Record<string, unknown>;
  /** Additional context */
  context: Record<string, unknown>;
}

/** Skill execution result */
export interface SkillExecutionResult {
  /** Whether execution succeeded */
  success: boolean;
  /** Output values */
  outputs: Record<string, unknown>;
  /** Execution duration in ms */
  duration: number;
  /** Error message if failed */
  error?: string;
  /** Signals emitted during execution */
  signals: string[];
}

/** Skill registry entry */
export interface SkillRegistryEntry {
  /** Skill definition */
  skill: Skill;
  /** Usage count */
  usageCount: number;
  /** Last used timestamp */
  lastUsed: number | null;
  /** Average execution duration */
  avgDuration: number;
}

/** Built-in skill names */
export type BuiltinSkillName =
  | 'implement-feature'
  | 'refactor'
  | 'add-types'
  | 'unit-test'
  | 'integration-test'
  | 'e2e-test'
  | 'review-pr'
  | 'security-scan'
  | 'analyze-error'
  | 'fix-bug'
  | 'add-logging'
  | 'write-readme'
  | 'api-docs'
  | 'jsdoc'
  | 'breakdown-task'
  | 'assign-work'
  | 'review-plan'
  | 'run-e2e'
  | 'generate-evidence'
  | 'api-scaffold';

/** Skill search query */
export interface SkillSearchQuery {
  /** Name pattern (supports wildcards) */
  name?: string;
  /** Category filter */
  category?: SkillConfig['category'];
  /** Tags to match (any) */
  tags?: string[];
  /** Agent type filter */
  agentType?: string;
}

/** Skill validation result */
export interface SkillValidationResult {
  /** Whether the skill is valid */
  valid: boolean;
  /** Validation errors */
  errors: Array<{
    field: string;
    message: string;
    severity: 'error' | 'warning';
  }>;
}
