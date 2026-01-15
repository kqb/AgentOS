/**
 * HandoffMachine - State machine for agent handoffs
 *
 * Manages transitions between agents during workflow execution:
 * - Handoff validation
 * - Context transfer
 * - State tracking
 * - Rollback support
 */

import { EventBus } from '../core/event-bus.js';

/** Handoff types */
export type HandoffType =
  | 'delegation'      // Task assigned to specialist
  | 'escalation'      // Issue escalated up
  | 'completion'      // Work completed, returning
  | 'failure'         // Failed, transferring to handler
  | 'parallel-spawn'  // Spawning parallel worker
  | 'parallel-join';  // Joining parallel results

/** Handoff state */
export type HandoffState =
  | 'pending'
  | 'in-progress'
  | 'completed'
  | 'failed'
  | 'rolled-back';

/** Context passed during handoff */
export interface HandoffContext {
  workflowId: string;
  taskId: string;
  data: unknown;
  previousDecisions: Array<{ type: string; choice: string }>;
  artifacts: string[];
  notes: string;
}

/** Handoff record */
export interface Handoff {
  id: string;
  type: HandoffType;
  fromAgent: string;
  toAgent: string;
  context: HandoffContext;
  state: HandoffState;
  createdAt: number;
  completedAt: number | null;
  error: string | null;
}

/** Handoff validation result */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/** Handoff machine singleton */
class HandoffMachineClass {
  private handoffs: Map<string, Handoff> = new Map();
  private activeHandoffs: Map<string, string> = new Map(); // agentId -> handoffId

  /**
   * Generate handoff ID
   */
  private generateId(): string {
    return `handoff-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  /**
   * Validate handoff request
   */
  validate(
    type: HandoffType,
    fromAgent: string,
    toAgent: string,
    context: Partial<HandoffContext>
  ): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Required fields
    if (!fromAgent) errors.push('Source agent is required');
    if (!toAgent) errors.push('Target agent is required');
    if (fromAgent === toAgent) errors.push('Cannot handoff to same agent');

    // Context validation
    if (!context.workflowId) errors.push('Workflow ID is required');
    if (!context.taskId) errors.push('Task ID is required');

    // Type-specific validation
    switch (type) {
      case 'delegation':
        if (!context.data) warnings.push('No task data provided for delegation');
        break;

      case 'escalation':
        if (!context.notes) warnings.push('No notes provided for escalation');
        break;

      case 'completion':
        if (!context.data) warnings.push('No result data for completion');
        break;

      case 'failure':
        if (!context.notes) errors.push('Failure reason is required');
        break;

      case 'parallel-spawn':
        if (!context.data) errors.push('Task data required for parallel spawn');
        break;

      case 'parallel-join':
        if (!context.artifacts?.length) warnings.push('No artifacts to join');
        break;
    }

    // Check for existing active handoff
    const existingHandoff = this.activeHandoffs.get(fromAgent);
    if (existingHandoff && type !== 'completion' && type !== 'failure') {
      warnings.push(`Agent ${fromAgent} has active handoff: ${existingHandoff}`);
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Initiate a handoff
   */
  initiate(
    type: HandoffType,
    fromAgent: string,
    toAgent: string,
    context: HandoffContext
  ): Handoff | null {
    // Validate
    const validation = this.validate(type, fromAgent, toAgent, context);
    if (!validation.valid) {
      console.error('[HandoffMachine] Invalid handoff:', validation.errors);
      return null;
    }

    if (validation.warnings.length > 0) {
      console.warn('[HandoffMachine] Warnings:', validation.warnings);
    }

    const handoff: Handoff = {
      id: this.generateId(),
      type,
      fromAgent,
      toAgent,
      context,
      state: 'pending',
      createdAt: Date.now(),
      completedAt: null,
      error: null
    };

    this.handoffs.set(handoff.id, handoff);

    EventBus.emit('handoff:initiated', {
      id: handoff.id,
      type,
      from: fromAgent,
      to: toAgent
    });

    console.log(`[HandoffMachine] Initiated: ${fromAgent} -> ${toAgent} (${type})`);

    return handoff;
  }

  /**
   * Start handoff (agent accepted)
   */
  start(handoffId: string): boolean {
    const handoff = this.handoffs.get(handoffId);
    if (!handoff) {
      console.error('[HandoffMachine] Handoff not found:', handoffId);
      return false;
    }

    if (handoff.state !== 'pending') {
      console.error('[HandoffMachine] Cannot start handoff in state:', handoff.state);
      return false;
    }

    handoff.state = 'in-progress';
    this.activeHandoffs.set(handoff.toAgent, handoffId);

    EventBus.emit('handoff:started', {
      id: handoffId,
      agent: handoff.toAgent
    });

    console.log(`[HandoffMachine] Started: ${handoff.toAgent} accepted handoff`);

    return true;
  }

  /**
   * Complete a handoff
   */
  complete(handoffId: string, result?: unknown): boolean {
    const handoff = this.handoffs.get(handoffId);
    if (!handoff) {
      console.error('[HandoffMachine] Handoff not found:', handoffId);
      return false;
    }

    if (handoff.state !== 'in-progress') {
      console.error('[HandoffMachine] Cannot complete handoff in state:', handoff.state);
      return false;
    }

    handoff.state = 'completed';
    handoff.completedAt = Date.now();

    if (result) {
      handoff.context.data = result;
    }

    this.activeHandoffs.delete(handoff.toAgent);

    EventBus.emit('handoff:completed', {
      id: handoffId,
      from: handoff.fromAgent,
      to: handoff.toAgent,
      duration: handoff.completedAt - handoff.createdAt
    });

    console.log(`[HandoffMachine] Completed: ${handoffId}`);

    return true;
  }

  /**
   * Fail a handoff
   */
  fail(handoffId: string, error: string): boolean {
    const handoff = this.handoffs.get(handoffId);
    if (!handoff) return false;

    handoff.state = 'failed';
    handoff.error = error;
    handoff.completedAt = Date.now();

    this.activeHandoffs.delete(handoff.toAgent);

    EventBus.emit('handoff:failed', {
      id: handoffId,
      error,
      from: handoff.fromAgent,
      to: handoff.toAgent
    });

    console.log(`[HandoffMachine] Failed: ${handoffId} - ${error}`);

    return true;
  }

  /**
   * Rollback a failed handoff
   */
  rollback(handoffId: string): boolean {
    const handoff = this.handoffs.get(handoffId);
    if (!handoff) return false;

    if (handoff.state !== 'failed') {
      console.error('[HandoffMachine] Can only rollback failed handoffs');
      return false;
    }

    handoff.state = 'rolled-back';

    EventBus.emit('handoff:rolledback', {
      id: handoffId,
      from: handoff.fromAgent,
      to: handoff.toAgent
    });

    console.log(`[HandoffMachine] Rolled back: ${handoffId}`);

    return true;
  }

  /**
   * Get handoff by ID
   */
  get(handoffId: string): Handoff | undefined {
    return this.handoffs.get(handoffId);
  }

  /**
   * Get active handoff for agent
   */
  getActiveForAgent(agentId: string): Handoff | undefined {
    const handoffId = this.activeHandoffs.get(agentId);
    if (handoffId) {
      return this.handoffs.get(handoffId);
    }
    return undefined;
  }

  /**
   * Get all handoffs for a workflow
   */
  getForWorkflow(workflowId: string): Handoff[] {
    return Array.from(this.handoffs.values())
      .filter(h => h.context.workflowId === workflowId);
  }

  /**
   * Get handoff history between agents
   */
  getHistory(fromAgent: string, toAgent: string): Handoff[] {
    return Array.from(this.handoffs.values())
      .filter(h => h.fromAgent === fromAgent && h.toAgent === toAgent)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * Get pending handoffs
   */
  getPending(): Handoff[] {
    return Array.from(this.handoffs.values())
      .filter(h => h.state === 'pending');
  }

  /**
   * Get in-progress handoffs
   */
  getInProgress(): Handoff[] {
    return Array.from(this.handoffs.values())
      .filter(h => h.state === 'in-progress');
  }

  /**
   * Get statistics
   */
  getStats(): {
    total: number;
    byState: Record<HandoffState, number>;
    byType: Record<HandoffType, number>;
    averageDuration: number;
  } {
    const handoffs = Array.from(this.handoffs.values());

    const byState: Record<string, number> = {};
    const byType: Record<string, number> = {};
    let totalDuration = 0;
    let completedCount = 0;

    for (const h of handoffs) {
      byState[h.state] = (byState[h.state] || 0) + 1;
      byType[h.type] = (byType[h.type] || 0) + 1;

      if (h.completedAt) {
        totalDuration += h.completedAt - h.createdAt;
        completedCount++;
      }
    }

    return {
      total: handoffs.length,
      byState: byState as Record<HandoffState, number>,
      byType: byType as Record<HandoffType, number>,
      averageDuration: completedCount > 0 ? totalDuration / completedCount : 0
    };
  }

  /**
   * Clear all handoffs
   */
  clear(): void {
    this.handoffs.clear();
    this.activeHandoffs.clear();
  }
}

// Export singleton
export const HandoffMachine = new HandoffMachineClass();

// Export class for testing
export { HandoffMachineClass };
