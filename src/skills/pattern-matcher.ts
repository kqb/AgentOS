/**
 * PatternMatcher - Identify recurring patterns in workflows
 *
 * Analyzes workflow execution history to discover:
 * - Common state sequences
 * - Action patterns
 * - Decision sequences
 */

import { EventBus } from '../core/event-bus.js';

/** Recorded workflow pattern */
export interface WorkflowPattern {
  id: string;
  sequence: string;
  states: string[];
  occurrences: number;
  successRate: number;
  averageDuration: number;
  sources: string[];
  lastSeen: number;
}

/** Action sequence */
export interface ActionSequence {
  id: string;
  actions: string[];
  occurrences: number;
  successRate: number;
  context: string;
}

/** Decision sequence */
export interface DecisionSequence {
  id: string;
  decisions: Array<{ type: string; choice: string }>;
  occurrences: number;
  successRate: number;
  outcome: 'success' | 'failure' | 'mixed';
}

/** Raw pattern record */
interface PatternRecord {
  id: string;
  states: string[];
  success: boolean;
  duration: number;
  timestamp: number;
}

/** Pattern matcher singleton */
class PatternMatcherClass {
  private records: PatternRecord[] = [];
  private patterns: Map<string, WorkflowPattern> = new Map();
  private maxRecords = 1000;

  /**
   * Record a pattern from workflow execution
   */
  recordPattern(record: PatternRecord): void {
    this.records.push(record);

    // Maintain max records
    if (this.records.length > this.maxRecords) {
      this.records.shift();
    }

    EventBus.emit('pattern:recorded', { id: record.id });
  }

  /**
   * Analyze recorded patterns
   */
  async analyzePatterns(minLength = 2, maxLength = 10): Promise<WorkflowPattern[]> {
    const sequenceCounts = new Map<string, {
      occurrences: number;
      successes: number;
      durations: number[];
      sources: string[];
      states: string[];
    }>();

    // Extract subsequences from all records
    for (const record of this.records) {
      const states = record.states;

      // Generate subsequences of various lengths
      for (let len = minLength; len <= Math.min(maxLength, states.length); len++) {
        for (let start = 0; start <= states.length - len; start++) {
          const subseq = states.slice(start, start + len);
          const key = subseq.join(' -> ');

          if (!sequenceCounts.has(key)) {
            sequenceCounts.set(key, {
              occurrences: 0,
              successes: 0,
              durations: [],
              sources: [],
              states: subseq
            });
          }

          const data = sequenceCounts.get(key)!;
          data.occurrences++;
          if (record.success) data.successes++;
          data.durations.push(record.duration);
          if (!data.sources.includes(record.id)) {
            data.sources.push(record.id);
          }
        }
      }
    }

    // Convert to patterns
    const patterns: WorkflowPattern[] = [];

    sequenceCounts.forEach((data, key) => {
      const avgDuration = data.durations.length > 0
        ? data.durations.reduce((a, b) => a + b, 0) / data.durations.length
        : 0;

      patterns.push({
        id: `pattern-${key.replace(/\s+->\s+/g, '-').toLowerCase()}`,
        sequence: key,
        states: data.states,
        occurrences: data.occurrences,
        successRate: data.successes / data.occurrences,
        averageDuration: avgDuration,
        sources: data.sources.slice(0, 10), // Limit sources
        lastSeen: Date.now()
      });
    });

    // Sort by occurrences
    patterns.sort((a, b) => b.occurrences - a.occurrences);

    // Update stored patterns
    for (const pattern of patterns) {
      this.patterns.set(pattern.id, pattern);
    }

    return patterns;
  }

  /**
   * Find patterns matching criteria
   */
  findPatterns(criteria: {
    minOccurrences?: number;
    minSuccessRate?: number;
    containsState?: string;
    limit?: number;
  }): WorkflowPattern[] {
    const {
      minOccurrences = 3,
      minSuccessRate = 0.7,
      containsState,
      limit = 20
    } = criteria;

    let results = Array.from(this.patterns.values());

    // Filter by occurrences
    results = results.filter(p => p.occurrences >= minOccurrences);

    // Filter by success rate
    results = results.filter(p => p.successRate >= minSuccessRate);

    // Filter by state
    if (containsState) {
      results = results.filter(p =>
        p.states.includes(containsState) ||
        p.sequence.includes(containsState)
      );
    }

    // Sort by success rate * occurrences
    results.sort((a, b) =>
      (b.successRate * b.occurrences) - (a.successRate * a.occurrences)
    );

    return results.slice(0, limit);
  }

  /**
   * Find action sequences
   */
  findActionSequences(minOccurrences = 3): ActionSequence[] {
    // Would analyze action-level patterns
    // For now, return empty (needs action logging integration)
    return [];
  }

  /**
   * Find decision sequences
   */
  findDecisionSequences(minOccurrences = 3): DecisionSequence[] {
    // Would analyze decision patterns
    // For now, return empty (needs decision logging integration)
    return [];
  }

  /**
   * Get pattern by ID
   */
  getPattern(id: string): WorkflowPattern | undefined {
    return this.patterns.get(id);
  }

  /**
   * Match current state against known patterns
   */
  matchCurrentState(currentStates: string[]): WorkflowPattern[] {
    const current = currentStates.join(' -> ');

    return Array.from(this.patterns.values())
      .filter(p => current.includes(p.sequence) || p.sequence.startsWith(current))
      .sort((a, b) => b.successRate - a.successRate);
  }

  /**
   * Predict next state based on patterns
   */
  predictNextState(currentStates: string[]): Array<{
    state: string;
    probability: number;
    basedOn: string;
  }> {
    const predictions: Map<string, { count: number; total: number; source: string }> = new Map();

    for (const record of this.records) {
      const states = record.states;

      // Find current sequence in record
      for (let i = 0; i < states.length - currentStates.length; i++) {
        const slice = states.slice(i, i + currentStates.length);

        if (this.sequenceMatches(slice, currentStates)) {
          const nextState = states[i + currentStates.length];
          if (nextState) {
            const key = nextState;
            if (!predictions.has(key)) {
              predictions.set(key, { count: 0, total: 0, source: record.id });
            }
            const pred = predictions.get(key)!;
            pred.total++;
            if (record.success) pred.count++;
          }
        }
      }
    }

    // Convert to probabilities
    const results: Array<{ state: string; probability: number; basedOn: string }> = [];

    predictions.forEach((data, state) => {
      results.push({
        state,
        probability: data.count / data.total,
        basedOn: data.source
      });
    });

    return results.sort((a, b) => b.probability - a.probability);
  }

  /**
   * Check if two sequences match
   */
  private sequenceMatches(a: string[], b: string[]): boolean {
    if (a.length !== b.length) return false;
    return a.every((state, i) => state === b[i]);
  }

  /**
   * Get statistics
   */
  getStats(): {
    totalRecords: number;
    totalPatterns: number;
    averageOccurrences: number;
    averageSuccessRate: number;
    topPatterns: WorkflowPattern[];
  } {
    const patterns = Array.from(this.patterns.values());

    if (patterns.length === 0) {
      return {
        totalRecords: this.records.length,
        totalPatterns: 0,
        averageOccurrences: 0,
        averageSuccessRate: 0,
        topPatterns: []
      };
    }

    const totalOccurrences = patterns.reduce((sum, p) => sum + p.occurrences, 0);
    const totalSuccessRate = patterns.reduce((sum, p) => sum + p.successRate, 0);

    return {
      totalRecords: this.records.length,
      totalPatterns: patterns.length,
      averageOccurrences: totalOccurrences / patterns.length,
      averageSuccessRate: totalSuccessRate / patterns.length,
      topPatterns: patterns.slice(0, 5)
    };
  }

  /**
   * Clear all records and patterns
   */
  clear(): void {
    this.records = [];
    this.patterns.clear();
  }

  /**
   * Export patterns for analysis
   */
  export(): {
    records: PatternRecord[];
    patterns: WorkflowPattern[];
  } {
    return {
      records: [...this.records],
      patterns: Array.from(this.patterns.values())
    };
  }

  /**
   * Import patterns from export
   */
  import(data: { records: PatternRecord[]; patterns: WorkflowPattern[] }): void {
    this.records = data.records.slice(-this.maxRecords);

    for (const pattern of data.patterns) {
      this.patterns.set(pattern.id, pattern);
    }
  }
}

// Export singleton
export const PatternMatcher = new PatternMatcherClass();

// Export class for testing
export { PatternMatcherClass };
