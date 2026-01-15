/**
 * Skill Registry for AgentOS
 *
 * Manages skill discovery, loading, and execution.
 * Skills are loaded from /skills/ directory.
 */

import { EventBus } from '../../../src/core/event-bus.js';
import type { SkillConfig, SkillExecutionContext, SkillResult } from '../../../src/types/skill.js';

/** Registered skill entry */
interface SkillEntry {
  config: SkillConfig;
  loaded: boolean;
  executionCount: number;
  lastExecuted: number | null;
  averageExecutionTime: number;
}

/**
 * Skill Registry class
 */
class SkillRegistryClass {
  private skills: Map<string, SkillEntry> = new Map();
  private initialized = false;

  /**
   * Initialize the registry
   */
  async init(): Promise<void> {
    if (this.initialized) return;

    // In browser environment, skills would be loaded from a bundled manifest
    // For now, register built-in skills
    this.registerBuiltinSkills();

    this.initialized = true;
    EventBus.emit('skills:initialized', { count: this.skills.size });
  }

  /**
   * Register built-in skills
   */
  private registerBuiltinSkills(): void {
    const builtinSkills: SkillConfig[] = [
      {
        name: 'implement-feature',
        version: '1.0.0',
        description: 'Implement a new feature based on requirements',
        category: 'development',
        inputs: [
          { name: 'requirements', type: 'string', required: true, description: 'Feature requirements' },
          { name: 'files', type: 'string[]', required: false, description: 'Target files' }
        ],
        outputs: [
          { name: 'files_modified', type: 'string[]', description: 'List of modified files' },
          { name: 'summary', type: 'string', description: 'Implementation summary' }
        ],
        prompts: {
          system: 'You are implementing a feature based on the provided requirements.',
          completionSignal: '[TASK_COMPLETE]'
        },
        requiredCapabilities: ['code-generation', 'file-editing'],
        estimatedDuration: 300000
      },
      {
        name: 'refactor',
        version: '1.0.0',
        description: 'Refactor code while preserving behavior',
        category: 'development',
        inputs: [
          { name: 'target', type: 'string', required: true, description: 'Code to refactor' },
          { name: 'goal', type: 'string', required: true, description: 'Refactoring goal' }
        ],
        outputs: [
          { name: 'refactored_code', type: 'string', description: 'Refactored code' },
          { name: 'changes', type: 'string[]', description: 'List of changes made' }
        ],
        prompts: {
          system: 'You are refactoring code to improve quality while preserving behavior.',
          completionSignal: '[TASK_COMPLETE]'
        },
        requiredCapabilities: ['code-generation', 'code-analysis'],
        estimatedDuration: 180000
      },
      {
        name: 'unit-test',
        version: '1.0.0',
        description: 'Generate unit tests for code',
        category: 'testing',
        inputs: [
          { name: 'code', type: 'string', required: true, description: 'Code to test' },
          { name: 'framework', type: 'string', required: false, description: 'Test framework' }
        ],
        outputs: [
          { name: 'test_code', type: 'string', description: 'Generated test code' },
          { name: 'coverage', type: 'number', description: 'Estimated coverage' }
        ],
        prompts: {
          system: 'You are writing comprehensive unit tests.',
          completionSignal: '[TASK_COMPLETE]'
        },
        requiredCapabilities: ['test-generation'],
        estimatedDuration: 180000
      },
      {
        name: 'review-pr',
        version: '1.0.0',
        description: 'Review pull request for quality and security',
        category: 'review',
        inputs: [
          { name: 'diff', type: 'string', required: true, description: 'PR diff' },
          { name: 'context', type: 'string', required: false, description: 'PR context' }
        ],
        outputs: [
          { name: 'issues', type: 'object[]', description: 'Found issues' },
          { name: 'recommendation', type: 'string', description: 'Review recommendation' }
        ],
        prompts: {
          system: 'You are reviewing code for quality, security, and best practices.',
          completionSignal: '[TASK_COMPLETE]'
        },
        requiredCapabilities: ['code-analysis', 'security-analysis'],
        estimatedDuration: 120000
      },
      {
        name: 'analyze-error',
        version: '1.0.0',
        description: 'Analyze and diagnose errors',
        category: 'debugging',
        inputs: [
          { name: 'error', type: 'string', required: true, description: 'Error message' },
          { name: 'stackTrace', type: 'string', required: false, description: 'Stack trace' }
        ],
        outputs: [
          { name: 'rootCause', type: 'string', description: 'Root cause analysis' },
          { name: 'fix', type: 'string', description: 'Suggested fix' }
        ],
        prompts: {
          system: 'You are diagnosing errors and identifying root causes.',
          completionSignal: '[TASK_COMPLETE]'
        },
        requiredCapabilities: ['code-analysis', 'debugging'],
        estimatedDuration: 240000
      }
    ];

    for (const skill of builtinSkills) {
      this.register(skill);
    }
  }

  /**
   * Register a skill
   */
  register(config: SkillConfig): void {
    const entry: SkillEntry = {
      config,
      loaded: true,
      executionCount: 0,
      lastExecuted: null,
      averageExecutionTime: config.estimatedDuration || 60000
    };

    this.skills.set(config.name, entry);
    EventBus.emit('skill:registered', { name: config.name });
  }

  /**
   * Get a skill by name
   */
  get(name: string): SkillConfig | null {
    const entry = this.skills.get(name);
    return entry?.config || null;
  }

  /**
   * Check if skill exists
   */
  has(name: string): boolean {
    return this.skills.has(name);
  }

  /**
   * List all skills
   */
  list(): SkillConfig[] {
    return Array.from(this.skills.values()).map(e => e.config);
  }

  /**
   * List skills by category
   */
  listByCategory(category: string): SkillConfig[] {
    return this.list().filter(s => s.category === category);
  }

  /**
   * Find skills by capability
   */
  findByCapability(capability: string): SkillConfig[] {
    return this.list().filter(s =>
      s.requiredCapabilities?.includes(capability)
    );
  }

  /**
   * Execute a skill
   */
  async execute(
    name: string,
    inputs: Record<string, unknown>,
    context: Partial<SkillExecutionContext> = {}
  ): Promise<SkillResult> {
    const entry = this.skills.get(name);
    if (!entry) {
      return {
        success: false,
        error: `Skill not found: ${name}`
      };
    }

    const skill = entry.config;
    const startTime = Date.now();

    // Validate required inputs
    for (const input of skill.inputs) {
      if (input.required && !(input.name in inputs)) {
        return {
          success: false,
          error: `Missing required input: ${input.name}`
        };
      }
    }

    EventBus.emit('skill:executing', { name, inputs });

    try {
      // In real implementation, this would execute the skill logic
      // For now, return a placeholder result
      const outputs: Record<string, unknown> = {};

      for (const output of skill.outputs) {
        outputs[output.name] = null; // Placeholder
      }

      const executionTime = Date.now() - startTime;

      // Update stats
      entry.executionCount++;
      entry.lastExecuted = Date.now();
      entry.averageExecutionTime =
        (entry.averageExecutionTime * (entry.executionCount - 1) + executionTime) /
        entry.executionCount;

      const result: SkillResult = {
        success: true,
        outputs,
        executionTime,
        signal: skill.prompts.completionSignal
      };

      EventBus.emit('skill:completed', { name, result });
      return result;

    } catch (error) {
      const result: SkillResult = {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        executionTime: Date.now() - startTime
      };

      EventBus.emit('skill:failed', { name, error: result.error });
      return result;
    }
  }

  /**
   * Get skill statistics
   */
  getStats(name: string): {
    executionCount: number;
    lastExecuted: number | null;
    averageExecutionTime: number;
  } | null {
    const entry = this.skills.get(name);
    if (!entry) return null;

    return {
      executionCount: entry.executionCount,
      lastExecuted: entry.lastExecuted,
      averageExecutionTime: entry.averageExecutionTime
    };
  }

  /**
   * Clear the registry
   */
  clear(): void {
    this.skills.clear();
    this.initialized = false;
  }
}

// Export singleton instance
export const SkillRegistry = new SkillRegistryClass();

// Also export the class for testing
export { SkillRegistryClass };
