/**
 * Workflow DNA Extractor
 *
 * Extracts patterns from successful workflows to create
 * reusable workflow templates.
 */

import { EventBus } from '../../../src/core/event-bus.js';
import { StateManager } from '../../../src/core/state-manager.js';
import type { WorkflowState, StateTransition } from '../../../src/types/workflow.js';

/** Workflow execution record */
interface WorkflowExecution {
  id: string;
  startState: WorkflowState;
  endState: WorkflowState;
  transitions: StateTransition[];
  humanInterventions: HumanIntervention[];
  success: boolean;
  duration: number;
  timestamp: number;
}

/** Human intervention record */
interface HumanIntervention {
  atState: WorkflowState;
  type: 'correction' | 'approval' | 'input' | 'escalation';
  description: string;
  timestamp: number;
}

/** Extracted workflow pattern */
interface WorkflowPattern {
  name: string;
  description: string;
  triggerConditions: string[];
  stateSequence: WorkflowState[];
  commonInterventions: {
    atState: WorkflowState;
    frequency: number;
    type: string;
  }[];
  averageDuration: number;
  successRate: number;
  extractedFrom: number; // Number of executions analyzed
}

/**
 * Workflow DNA Extractor class
 */
class WorkflowDnaExtractorClass {
  private executions: WorkflowExecution[] = [];
  private patterns: Map<string, WorkflowPattern> = new Map();
  private tracking = false;
  private currentExecution: Partial<WorkflowExecution> | null = null;

  /**
   * Start tracking a workflow execution
   */
  startTracking(id: string, startState: WorkflowState): void {
    this.currentExecution = {
      id,
      startState,
      transitions: [],
      humanInterventions: [],
      timestamp: Date.now()
    };
    this.tracking = true;

    EventBus.emit('dna:tracking:started', { id, startState });
  }

  /**
   * Record a state transition
   */
  recordTransition(transition: StateTransition): void {
    if (!this.tracking || !this.currentExecution) return;

    this.currentExecution.transitions = this.currentExecution.transitions || [];
    this.currentExecution.transitions.push(transition);

    EventBus.emit('dna:transition:recorded', { transition });
  }

  /**
   * Record a human intervention
   */
  recordIntervention(
    atState: WorkflowState,
    type: HumanIntervention['type'],
    description: string
  ): void {
    if (!this.tracking || !this.currentExecution) return;

    const intervention: HumanIntervention = {
      atState,
      type,
      description,
      timestamp: Date.now()
    };

    this.currentExecution.humanInterventions = this.currentExecution.humanInterventions || [];
    this.currentExecution.humanInterventions.push(intervention);

    EventBus.emit('dna:intervention:recorded', { intervention });
  }

  /**
   * Complete tracking
   */
  completeTracking(endState: WorkflowState, success: boolean): void {
    if (!this.tracking || !this.currentExecution) return;

    const execution: WorkflowExecution = {
      id: this.currentExecution.id!,
      startState: this.currentExecution.startState!,
      endState,
      transitions: this.currentExecution.transitions || [],
      humanInterventions: this.currentExecution.humanInterventions || [],
      success,
      duration: Date.now() - this.currentExecution.timestamp!,
      timestamp: this.currentExecution.timestamp!
    };

    this.executions.push(execution);
    this.tracking = false;
    this.currentExecution = null;

    // Persist execution
    this.saveExecution(execution);

    EventBus.emit('dna:tracking:completed', { execution });

    // Analyze patterns if we have enough data
    if (this.executions.length % 5 === 0) {
      this.analyzePatterns();
    }
  }

  /**
   * Save execution to storage
   */
  private saveExecution(execution: WorkflowExecution): void {
    const stored = StateManager.get<WorkflowExecution[]>('dna', 'executions') || [];
    stored.push(execution);

    // Keep last 100 executions
    if (stored.length > 100) {
      stored.shift();
    }

    StateManager.set('dna', 'executions', stored);
  }

  /**
   * Analyze executions to extract patterns
   */
  analyzePatterns(): void {
    const successfulExecutions = this.executions.filter(e => e.success);

    if (successfulExecutions.length < 3) {
      return; // Not enough data
    }

    // Group executions by state sequence
    const sequenceGroups = new Map<string, WorkflowExecution[]>();

    for (const exec of successfulExecutions) {
      const sequence = exec.transitions.map(t => t.from).join('->');
      const group = sequenceGroups.get(sequence) || [];
      group.push(exec);
      sequenceGroups.set(sequence, group);
    }

    // Extract patterns from groups
    for (const [sequence, group] of sequenceGroups) {
      if (group.length < 2) continue; // Need at least 2 similar executions

      const pattern = this.extractPattern(sequence, group);
      this.patterns.set(pattern.name, pattern);
    }

    // Persist patterns
    this.savePatterns();

    EventBus.emit('dna:patterns:updated', { count: this.patterns.size });
  }

  /**
   * Extract pattern from execution group
   */
  private extractPattern(sequence: string, executions: WorkflowExecution[]): WorkflowPattern {
    const stateSequence = sequence.split('->') as WorkflowState[];

    // Analyze interventions
    const interventionMap = new Map<string, { count: number; types: Map<string, number> }>();

    for (const exec of executions) {
      for (const intervention of exec.humanInterventions) {
        const key = intervention.atState;
        const entry = interventionMap.get(key) || { count: 0, types: new Map() };
        entry.count++;
        entry.types.set(
          intervention.type,
          (entry.types.get(intervention.type) || 0) + 1
        );
        interventionMap.set(key, entry);
      }
    }

    const commonInterventions = Array.from(interventionMap.entries())
      .filter(([_, data]) => data.count / executions.length >= 0.3) // 30% threshold
      .map(([state, data]) => ({
        atState: state as WorkflowState,
        frequency: data.count / executions.length,
        type: Array.from(data.types.entries())
          .sort((a, b) => b[1] - a[1])[0][0]
      }));

    const averageDuration =
      executions.reduce((sum, e) => sum + e.duration, 0) / executions.length;

    return {
      name: `pattern-${Date.now()}`,
      description: `Auto-extracted pattern from ${executions.length} executions`,
      triggerConditions: [], // Would be derived from context
      stateSequence,
      commonInterventions,
      averageDuration,
      successRate: 1, // All executions in group were successful
      extractedFrom: executions.length
    };
  }

  /**
   * Save patterns to storage
   */
  private savePatterns(): void {
    const patterns = Array.from(this.patterns.values());
    StateManager.set('dna', 'patterns', patterns);
  }

  /**
   * Load patterns from storage
   */
  loadPatterns(): void {
    const stored = StateManager.get<WorkflowPattern[]>('dna', 'patterns');
    if (stored) {
      for (const pattern of stored) {
        this.patterns.set(pattern.name, pattern);
      }
    }

    const executions = StateManager.get<WorkflowExecution[]>('dna', 'executions');
    if (executions) {
      this.executions = executions;
    }
  }

  /**
   * Get pattern suggestions for current state
   */
  suggestPattern(currentState: WorkflowState): WorkflowPattern | null {
    for (const pattern of this.patterns.values()) {
      const stateIndex = pattern.stateSequence.indexOf(currentState);
      if (stateIndex >= 0 && stateIndex < pattern.stateSequence.length - 1) {
        return pattern;
      }
    }
    return null;
  }

  /**
   * Get intervention suggestion for state
   */
  suggestIntervention(state: WorkflowState): {
    type: string;
    likelihood: number;
  } | null {
    for (const pattern of this.patterns.values()) {
      const intervention = pattern.commonInterventions.find(i => i.atState === state);
      if (intervention && intervention.frequency >= 0.5) {
        return {
          type: intervention.type,
          likelihood: intervention.frequency
        };
      }
    }
    return null;
  }

  /**
   * List all patterns
   */
  listPatterns(): WorkflowPattern[] {
    return Array.from(this.patterns.values());
  }

  /**
   * Get statistics
   */
  getStats(): {
    totalExecutions: number;
    successfulExecutions: number;
    patternCount: number;
    averageInterventions: number;
  } {
    const successful = this.executions.filter(e => e.success);
    const totalInterventions = this.executions.reduce(
      (sum, e) => sum + e.humanInterventions.length,
      0
    );

    return {
      totalExecutions: this.executions.length,
      successfulExecutions: successful.length,
      patternCount: this.patterns.size,
      averageInterventions: this.executions.length > 0
        ? totalInterventions / this.executions.length
        : 0
    };
  }

  /**
   * Clear all data
   */
  clear(): void {
    this.executions = [];
    this.patterns.clear();
    this.tracking = false;
    this.currentExecution = null;
    StateManager.clearNamespace('dna');
  }
}

// Export singleton instance
export const WorkflowDnaExtractor = new WorkflowDnaExtractorClass();

// Also export the class for testing
export { WorkflowDnaExtractorClass };
