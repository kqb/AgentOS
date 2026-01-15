/**
 * Skill Executor
 *
 * Executes skills with context injection and result handling.
 */

import { EventBus } from '../core/event-bus.js';
import { SignalParser } from '../core/signal-parser.js';
import type {
  SkillConfig,
  SkillExecutionContext,
  SkillResult,
  SkillInput
} from '../types/skill.js';

/** Execution options */
export interface ExecutionOptions {
  timeout?: number;
  retryOnError?: boolean;
  captureOutput?: boolean;
}

/** Execution state */
interface ExecutionState {
  skillName: string;
  startTime: number;
  status: 'pending' | 'running' | 'completed' | 'failed';
  attempts: number;
  lastError?: string;
}

/**
 * Skill Executor class
 */
class SkillExecutorClass {
  private activeExecutions: Map<string, ExecutionState> = new Map();
  private executionHistory: Array<{
    skillName: string;
    success: boolean;
    duration: number;
    timestamp: number;
  }> = [];

  /**
   * Execute a skill
   */
  async execute(
    skill: SkillConfig,
    inputs: Record<string, unknown>,
    context: Partial<SkillExecutionContext> = {},
    options: ExecutionOptions = {}
  ): Promise<SkillResult> {
    const executionId = `${skill.name}-${Date.now()}`;
    const startTime = Date.now();

    // Initialize execution state
    const state: ExecutionState = {
      skillName: skill.name,
      startTime,
      status: 'pending',
      attempts: 0
    };
    this.activeExecutions.set(executionId, state);

    // Build full context
    const fullContext: SkillExecutionContext = {
      skillName: skill.name,
      agentId: context.agentId || 'unknown',
      workflowId: context.workflowId,
      startTime,
      timeout: options.timeout || skill.estimatedDuration || 60000,
      inputs,
      ...context
    };

    EventBus.emit('skill:execution:started', {
      executionId,
      skillName: skill.name,
      inputs
    });

    try {
      // Validate inputs
      const validationResult = this.validateInputs(skill.inputs, inputs);
      if (!validationResult.valid) {
        throw new Error(`Input validation failed: ${validationResult.errors.join(', ')}`);
      }

      state.status = 'running';
      state.attempts = 1;

      // Execute with timeout
      const result = await this.executeWithTimeout(
        skill,
        fullContext,
        options.timeout || skill.estimatedDuration || 60000
      );

      state.status = 'completed';

      const executionTime = Date.now() - startTime;

      // Record history
      this.executionHistory.push({
        skillName: skill.name,
        success: true,
        duration: executionTime,
        timestamp: startTime
      });

      EventBus.emit('skill:execution:completed', {
        executionId,
        skillName: skill.name,
        result,
        duration: executionTime
      });

      return {
        success: true,
        outputs: result.outputs,
        executionTime,
        signal: skill.prompts.completionSignal
      };

    } catch (error) {
      state.status = 'failed';
      state.lastError = error instanceof Error ? error.message : String(error);

      const executionTime = Date.now() - startTime;

      // Record history
      this.executionHistory.push({
        skillName: skill.name,
        success: false,
        duration: executionTime,
        timestamp: startTime
      });

      EventBus.emit('skill:execution:failed', {
        executionId,
        skillName: skill.name,
        error: state.lastError,
        duration: executionTime
      });

      return {
        success: false,
        error: state.lastError,
        executionTime,
        signal: skill.prompts.errorSignal
      };

    } finally {
      this.activeExecutions.delete(executionId);
    }
  }

  /**
   * Validate inputs against skill definition
   */
  private validateInputs(
    inputDefs: SkillInput[],
    inputs: Record<string, unknown>
  ): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    for (const def of inputDefs) {
      const value = inputs[def.name];

      // Check required
      if (def.required && (value === undefined || value === null)) {
        errors.push(`Missing required input: ${def.name}`);
        continue;
      }

      // Skip validation if optional and not provided
      if (value === undefined || value === null) continue;

      // Type validation
      if (!this.validateType(value, def.type)) {
        errors.push(`Invalid type for ${def.name}: expected ${def.type}`);
      }

      // Additional validation rules
      if (def.validation) {
        const validationErrors = this.applyValidation(def.name, value, def.validation);
        errors.push(...validationErrors);
      }
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Validate value type
   */
  private validateType(value: unknown, expectedType: string): boolean {
    switch (expectedType) {
      case 'string':
        return typeof value === 'string';
      case 'number':
        return typeof value === 'number';
      case 'boolean':
        return typeof value === 'boolean';
      case 'object':
        return typeof value === 'object' && value !== null && !Array.isArray(value);
      case 'string[]':
        return Array.isArray(value) && value.every(v => typeof v === 'string');
      case 'object[]':
        return Array.isArray(value) && value.every(v => typeof v === 'object');
      default:
        return true;
    }
  }

  /**
   * Apply validation rules
   */
  private applyValidation(
    name: string,
    value: unknown,
    rules: NonNullable<SkillInput['validation']>
  ): string[] {
    const errors: string[] = [];

    if (typeof value === 'string') {
      if (rules.pattern && !new RegExp(rules.pattern).test(value)) {
        errors.push(`${name} does not match pattern: ${rules.pattern}`);
      }
      if (rules.minLength !== undefined && value.length < rules.minLength) {
        errors.push(`${name} must be at least ${rules.minLength} characters`);
      }
      if (rules.maxLength !== undefined && value.length > rules.maxLength) {
        errors.push(`${name} must be at most ${rules.maxLength} characters`);
      }
      if (rules.enum && !rules.enum.includes(value)) {
        errors.push(`${name} must be one of: ${rules.enum.join(', ')}`);
      }
    }

    if (typeof value === 'number') {
      if (rules.min !== undefined && value < rules.min) {
        errors.push(`${name} must be at least ${rules.min}`);
      }
      if (rules.max !== undefined && value > rules.max) {
        errors.push(`${name} must be at most ${rules.max}`);
      }
    }

    return errors;
  }

  /**
   * Execute with timeout
   */
  private async executeWithTimeout(
    skill: SkillConfig,
    context: SkillExecutionContext,
    timeout: number
  ): Promise<{ outputs: Record<string, unknown> }> {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(`Skill execution timed out after ${timeout}ms`));
      }, timeout);

      // Simulate skill execution
      // In real implementation, this would invoke the skill logic
      setTimeout(() => {
        clearTimeout(timeoutId);

        // Generate placeholder outputs
        const outputs: Record<string, unknown> = {};
        for (const output of skill.outputs) {
          outputs[output.name] = this.generatePlaceholder(output.type);
        }

        resolve({ outputs });
      }, 100); // Simulated execution time
    });
  }

  /**
   * Generate placeholder value for output type
   */
  private generatePlaceholder(type: string): unknown {
    switch (type) {
      case 'string':
        return '';
      case 'number':
        return 0;
      case 'boolean':
        return false;
      case 'object':
        return {};
      case 'string[]':
        return [];
      case 'object[]':
        return [];
      default:
        return null;
    }
  }

  /**
   * Get active executions
   */
  getActiveExecutions(): ExecutionState[] {
    return Array.from(this.activeExecutions.values());
  }

  /**
   * Get execution history
   */
  getHistory(limit = 50): typeof this.executionHistory {
    return this.executionHistory.slice(-limit);
  }

  /**
   * Get statistics
   */
  getStats(): {
    totalExecutions: number;
    successRate: number;
    averageDuration: number;
    activeCount: number;
  } {
    const total = this.executionHistory.length;
    const successful = this.executionHistory.filter(e => e.success).length;
    const totalDuration = this.executionHistory.reduce((sum, e) => sum + e.duration, 0);

    return {
      totalExecutions: total,
      successRate: total > 0 ? successful / total : 0,
      averageDuration: total > 0 ? totalDuration / total : 0,
      activeCount: this.activeExecutions.size
    };
  }

  /**
   * Clear history
   */
  clearHistory(): void {
    this.executionHistory = [];
  }
}

// Export singleton instance
export const SkillExecutor = new SkillExecutorClass();

// Also export the class for testing
export { SkillExecutorClass };
