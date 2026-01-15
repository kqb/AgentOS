/**
 * DecisionLogger - Log agent decisions with context for learning
 *
 * Tracks:
 * - Decision type (action, approach, tool, delegation)
 * - Choice made and alternatives
 * - Context at decision time
 * - Outcome (filled in later)
 */

import { EventBus } from '../core/event-bus.js';

/** Decision types */
export type DecisionType = 'action' | 'approach' | 'tool' | 'delegation' | 'pattern' | 'retry';

/** Decision entry */
export interface DecisionEntry {
  id: string;
  timestamp: number;
  agentId: string;
  agentType: string;
  taskId?: string;
  type: DecisionType;
  choice: string;
  alternatives?: string[];
  reasoning?: string;
  context: Record<string, unknown>;
  outcome?: {
    result: 'success' | 'failure' | 'partial';
    notes?: string;
    recordedAt: number;
  };
}

/** Decision pattern - aggregated from similar decisions */
export interface DecisionPattern {
  type: DecisionType;
  choice: string;
  totalOccurrences: number;
  successCount: number;
  failureCount: number;
  partialCount: number;
  successRate: number;
  contexts: string[];  // Unique context identifiers
}

/** Decision logger singleton */
class DecisionLoggerClass {
  private decisions: DecisionEntry[] = [];
  private maxEntries = 10000;

  /**
   * Generate unique ID
   */
  private generateId(): string {
    return `dec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  /**
   * Log a decision
   */
  log(
    agentId: string,
    decision: {
      agentType?: string;
      taskId?: string;
      type: DecisionType;
      choice: string;
      alternatives?: string[];
      reasoning?: string;
      context?: Record<string, unknown>;
    }
  ): DecisionEntry {
    const entry: DecisionEntry = {
      id: this.generateId(),
      timestamp: Date.now(),
      agentId,
      agentType: decision.agentType || 'unknown',
      taskId: decision.taskId,
      type: decision.type,
      choice: decision.choice,
      alternatives: decision.alternatives,
      reasoning: decision.reasoning,
      context: decision.context || {}
    };

    this.decisions.push(entry);

    // Trim old entries
    if (this.decisions.length > this.maxEntries) {
      this.decisions = this.decisions.slice(-this.maxEntries);
    }

    // Emit event
    EventBus.emit('decision:logged', entry);

    console.log(`[DecisionLogger] ${agentId} decided: ${decision.type}=${decision.choice}`);

    return entry;
  }

  /**
   * Parse decision from agent signal
   * Signals format: [DECISION: type=choice]
   */
  parseSignal(agentId: string, signal: string, context?: Record<string, unknown>): DecisionEntry | null {
    const match = signal.match(/\[DECISION:\s*(\w+)=([^\]]+)\]/);
    if (!match) return null;

    const [, typeStr, choice] = match;
    const type = typeStr as DecisionType;

    if (!['action', 'approach', 'tool', 'delegation', 'pattern', 'retry'].includes(type)) {
      return null;
    }

    return this.log(agentId, {
      type,
      choice: choice.trim(),
      context
    });
  }

  /**
   * Record outcome for a decision
   * Signals format: [OUTCOME: success] or [OUTCOME: failure=reason]
   */
  recordOutcome(
    decisionId: string,
    result: 'success' | 'failure' | 'partial',
    notes?: string
  ): boolean {
    const decision = this.decisions.find(d => d.id === decisionId);
    if (!decision) return false;

    decision.outcome = {
      result,
      notes,
      recordedAt: Date.now()
    };

    // Emit event
    EventBus.emit('decision:outcome', {
      decisionId,
      result,
      notes
    });

    return true;
  }

  /**
   * Parse outcome signal
   * Signals format: [OUTCOME: success] or [OUTCOME: failure=reason]
   */
  parseOutcomeSignal(agentId: string, signal: string): boolean {
    const successMatch = signal.match(/\[OUTCOME:\s*success\]/);
    const failureMatch = signal.match(/\[OUTCOME:\s*failure(?:=([^\]]+))?\]/);
    const partialMatch = signal.match(/\[OUTCOME:\s*partial(?:=([^\]]+))?\]/);

    // Find most recent unresolved decision for this agent
    const pendingDecision = [...this.decisions]
      .reverse()
      .find(d => d.agentId === agentId && !d.outcome);

    if (!pendingDecision) return false;

    if (successMatch) {
      return this.recordOutcome(pendingDecision.id, 'success');
    }

    if (failureMatch) {
      return this.recordOutcome(pendingDecision.id, 'failure', failureMatch[1]);
    }

    if (partialMatch) {
      return this.recordOutcome(pendingDecision.id, 'partial', partialMatch[1]);
    }

    return false;
  }

  /**
   * Get decisions by agent
   */
  getByAgent(agentId: string, limit = 100): DecisionEntry[] {
    return this.decisions
      .filter(d => d.agentId === agentId)
      .slice(-limit);
  }

  /**
   * Get decisions by type
   */
  getByType(type: DecisionType, limit = 100): DecisionEntry[] {
    return this.decisions
      .filter(d => d.type === type)
      .slice(-limit);
  }

  /**
   * Get decisions with outcomes
   */
  getWithOutcomes(limit = 100): DecisionEntry[] {
    return this.decisions
      .filter(d => d.outcome)
      .slice(-limit);
  }

  /**
   * Get pending decisions (no outcome yet)
   */
  getPending(limit = 100): DecisionEntry[] {
    return this.decisions
      .filter(d => !d.outcome)
      .slice(-limit);
  }

  /**
   * Get successful decisions
   */
  getSuccessful(limit = 100): DecisionEntry[] {
    return this.decisions
      .filter(d => d.outcome?.result === 'success')
      .slice(-limit);
  }

  /**
   * Get failed decisions
   */
  getFailed(limit = 100): DecisionEntry[] {
    return this.decisions
      .filter(d => d.outcome?.result === 'failure')
      .slice(-limit);
  }

  /**
   * Analyze decision patterns
   */
  analyzePatterns(): DecisionPattern[] {
    const patternMap = new Map<string, DecisionPattern>();

    for (const decision of this.decisions) {
      if (!decision.outcome) continue;

      const key = `${decision.type}:${decision.choice}`;

      let pattern = patternMap.get(key);
      if (!pattern) {
        pattern = {
          type: decision.type,
          choice: decision.choice,
          totalOccurrences: 0,
          successCount: 0,
          failureCount: 0,
          partialCount: 0,
          successRate: 0,
          contexts: []
        };
        patternMap.set(key, pattern);
      }

      pattern.totalOccurrences++;

      switch (decision.outcome.result) {
        case 'success':
          pattern.successCount++;
          break;
        case 'failure':
          pattern.failureCount++;
          break;
        case 'partial':
          pattern.partialCount++;
          break;
      }

      pattern.successRate = pattern.successCount / pattern.totalOccurrences;

      // Track unique contexts
      const contextKey = JSON.stringify(Object.keys(decision.context).sort());
      if (!pattern.contexts.includes(contextKey)) {
        pattern.contexts.push(contextKey);
      }
    }

    return Array.from(patternMap.values())
      .sort((a, b) => b.totalOccurrences - a.totalOccurrences);
  }

  /**
   * Get high-performing choices for a decision type
   */
  getHighPerformingChoices(type: DecisionType, minOccurrences = 3, minSuccessRate = 0.7): DecisionPattern[] {
    return this.analyzePatterns()
      .filter(p =>
        p.type === type &&
        p.totalOccurrences >= minOccurrences &&
        p.successRate >= minSuccessRate
      )
      .sort((a, b) => b.successRate - a.successRate);
  }

  /**
   * Get low-performing choices (anti-patterns)
   */
  getAntiPatterns(minOccurrences = 3, maxSuccessRate = 0.3): DecisionPattern[] {
    return this.analyzePatterns()
      .filter(p =>
        p.totalOccurrences >= minOccurrences &&
        p.successRate <= maxSuccessRate
      )
      .sort((a, b) => a.successRate - b.successRate);
  }

  /**
   * Get decision sequences for a task
   */
  getTaskDecisionSequence(taskId: string): DecisionEntry[] {
    return this.decisions
      .filter(d => d.taskId === taskId)
      .sort((a, b) => a.timestamp - b.timestamp);
  }

  /**
   * Export decisions
   */
  exportData(): DecisionEntry[] {
    return [...this.decisions];
  }

  /**
   * Import decisions
   */
  importData(decisions: DecisionEntry[]): void {
    this.decisions = [...this.decisions, ...decisions];

    // Trim if over limit
    if (this.decisions.length > this.maxEntries) {
      this.decisions = this.decisions.slice(-this.maxEntries);
    }
  }

  /**
   * Clear all decisions
   */
  clear(): void {
    this.decisions = [];
    console.log('[DecisionLogger] Cleared all decisions');
  }

  /**
   * Get statistics
   */
  getStats(): {
    total: number;
    withOutcome: number;
    pending: number;
    byType: Record<DecisionType, number>;
    byOutcome: Record<string, number>;
  } {
    const byType: Record<DecisionType, number> = {
      action: 0,
      approach: 0,
      tool: 0,
      delegation: 0,
      pattern: 0,
      retry: 0
    };

    const byOutcome: Record<string, number> = {
      success: 0,
      failure: 0,
      partial: 0,
      pending: 0
    };

    for (const decision of this.decisions) {
      byType[decision.type]++;

      if (decision.outcome) {
        byOutcome[decision.outcome.result]++;
      } else {
        byOutcome.pending++;
      }
    }

    return {
      total: this.decisions.length,
      withOutcome: this.decisions.filter(d => d.outcome).length,
      pending: this.decisions.filter(d => !d.outcome).length,
      byType,
      byOutcome
    };
  }
}

// Export singleton
export const DecisionLogger = new DecisionLoggerClass();

// Export class for testing
export { DecisionLoggerClass };
