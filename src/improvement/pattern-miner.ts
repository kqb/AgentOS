/**
 * PatternMiner - Mine success/failure patterns from agent decisions
 *
 * Discovers:
 * - Success patterns (choices with >80% success rate)
 * - Failure patterns (choices with <30% success rate)
 * - Decision sequences that lead to outcomes
 */

import { EventBus } from '../core/event-bus.js';
import { DecisionLogger, DecisionEntry, DecisionPattern } from './decision-logger.js';
import { FeedbackCollector, FeedbackEntry } from './feedback-collector.js';

/** Mined pattern */
export interface MinedPattern {
  id: string;
  type: 'success' | 'failure' | 'sequence' | 'correlation';
  agentType?: string;
  description: string;
  pattern: {
    decisionType?: string;
    choice?: string;
    sequence?: string[];
    conditions?: Record<string, unknown>;
  };
  evidence: {
    occurrences: number;
    successRate: number;
    samples: string[];  // Decision/feedback IDs
  };
  confidence: number;  // 0-1
  minedAt: number;
  lastUpdated: number;
}

/** Sequence pattern */
export interface SequencePattern {
  sequence: string[];
  occurrences: number;
  successRate: number;
  averageDuration: number;
  tasks: string[];
}

/** Correlation */
export interface ContextCorrelation {
  contextKey: string;
  contextValue: unknown;
  successRate: number;
  occurrences: number;
}

/** Pattern miner singleton */
class PatternMinerClass {
  private patterns: MinedPattern[] = [];
  private miningInterval: ReturnType<typeof setInterval> | null = null;

  /**
   * Generate unique ID
   */
  private generateId(): string {
    return `pat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  /**
   * Start periodic mining
   */
  startMining(intervalMs = 3600000): void {  // Default: 1 hour
    if (this.miningInterval) return;

    this.miningInterval = setInterval(() => {
      this.mineAll();
    }, intervalMs);

    // Run initial mining
    this.mineAll();

    console.log('[PatternMiner] Started periodic mining');
  }

  /**
   * Stop periodic mining
   */
  stopMining(): void {
    if (this.miningInterval) {
      clearInterval(this.miningInterval);
      this.miningInterval = null;
    }
    console.log('[PatternMiner] Stopped mining');
  }

  /**
   * Mine all patterns
   */
  mineAll(): void {
    console.log('[PatternMiner] Starting pattern mining...');

    const agentTypes = ['code-generator', 'test-writer', 'debugger', 'code-reviewer', 'doc-writer', 'team-lead', 'qa-engineer', 'researcher'];

    for (const agentType of agentTypes) {
      this.mineSuccessPatterns(agentType);
      this.mineFailurePatterns(agentType);
    }

    this.mineSequencePatterns();
    this.mineContextCorrelations();

    EventBus.emit('patterns:mined', { count: this.patterns.length });

    console.log(`[PatternMiner] Mining complete. ${this.patterns.length} patterns found.`);
  }

  /**
   * Mine success patterns for agent type
   */
  mineSuccessPatterns(agentType: string, minOccurrences = 3, minSuccessRate = 0.8): MinedPattern[] {
    const decisionPatterns = DecisionLogger.analyzePatterns();

    const successPatterns: MinedPattern[] = [];

    for (const dp of decisionPatterns) {
      if (dp.totalOccurrences < minOccurrences) continue;
      if (dp.successRate < minSuccessRate) continue;

      // Check if pattern already exists
      const existingIndex = this.patterns.findIndex(p =>
        p.type === 'success' &&
        p.pattern.decisionType === dp.type &&
        p.pattern.choice === dp.choice
      );

      const pattern: MinedPattern = {
        id: existingIndex >= 0 ? this.patterns[existingIndex].id : this.generateId(),
        type: 'success',
        agentType,
        description: `High success rate for ${dp.type}=${dp.choice}`,
        pattern: {
          decisionType: dp.type,
          choice: dp.choice
        },
        evidence: {
          occurrences: dp.totalOccurrences,
          successRate: dp.successRate,
          samples: []
        },
        confidence: this.calculateConfidence(dp.totalOccurrences, dp.successRate),
        minedAt: existingIndex >= 0 ? this.patterns[existingIndex].minedAt : Date.now(),
        lastUpdated: Date.now()
      };

      if (existingIndex >= 0) {
        this.patterns[existingIndex] = pattern;
      } else {
        this.patterns.push(pattern);
      }

      successPatterns.push(pattern);
    }

    return successPatterns;
  }

  /**
   * Mine failure patterns (anti-patterns)
   */
  mineFailurePatterns(agentType: string, minOccurrences = 3, maxSuccessRate = 0.3): MinedPattern[] {
    const decisionPatterns = DecisionLogger.analyzePatterns();

    const failurePatterns: MinedPattern[] = [];

    for (const dp of decisionPatterns) {
      if (dp.totalOccurrences < minOccurrences) continue;
      if (dp.successRate > maxSuccessRate) continue;

      // Check if pattern already exists
      const existingIndex = this.patterns.findIndex(p =>
        p.type === 'failure' &&
        p.pattern.decisionType === dp.type &&
        p.pattern.choice === dp.choice
      );

      const pattern: MinedPattern = {
        id: existingIndex >= 0 ? this.patterns[existingIndex].id : this.generateId(),
        type: 'failure',
        agentType,
        description: `Low success rate for ${dp.type}=${dp.choice} - AVOID`,
        pattern: {
          decisionType: dp.type,
          choice: dp.choice
        },
        evidence: {
          occurrences: dp.totalOccurrences,
          successRate: dp.successRate,
          samples: []
        },
        confidence: this.calculateConfidence(dp.totalOccurrences, 1 - dp.successRate),
        minedAt: existingIndex >= 0 ? this.patterns[existingIndex].minedAt : Date.now(),
        lastUpdated: Date.now()
      };

      if (existingIndex >= 0) {
        this.patterns[existingIndex] = pattern;
      } else {
        this.patterns.push(pattern);
      }

      failurePatterns.push(pattern);
    }

    return failurePatterns;
  }

  /**
   * Mine decision sequences
   */
  mineSequencePatterns(minOccurrences = 2): SequencePattern[] {
    const feedback = FeedbackCollector.getRecentFeedback(1000);

    // Group by task
    const taskFeedback = new Map<string, FeedbackEntry[]>();
    for (const entry of feedback) {
      if (!entry.taskId) continue;
      if (!taskFeedback.has(entry.taskId)) {
        taskFeedback.set(entry.taskId, []);
      }
      taskFeedback.get(entry.taskId)!.push(entry);
    }

    // Find decision sequences
    const sequenceMap = new Map<string, SequencePattern>();

    for (const [taskId, entries] of taskFeedback) {
      const decisions = DecisionLogger.getTaskDecisionSequence(taskId);
      if (decisions.length < 2) continue;

      // Extract sequence of choices
      const sequence = decisions.map(d => `${d.type}:${d.choice}`);
      const key = sequence.join(' -> ');

      // Calculate success rate for this task
      const taskOutcomes = entries.filter(e => e.outcome);
      const successCount = taskOutcomes.filter(e => e.outcome === 'success').length;
      const successRate = taskOutcomes.length > 0 ? successCount / taskOutcomes.length : 0;

      // Calculate duration
      const duration = decisions.length > 1
        ? decisions[decisions.length - 1].timestamp - decisions[0].timestamp
        : 0;

      if (!sequenceMap.has(key)) {
        sequenceMap.set(key, {
          sequence,
          occurrences: 0,
          successRate: 0,
          averageDuration: 0,
          tasks: []
        });
      }

      const seqPattern = sequenceMap.get(key)!;
      seqPattern.occurrences++;
      seqPattern.successRate = (seqPattern.successRate * (seqPattern.occurrences - 1) + successRate) / seqPattern.occurrences;
      seqPattern.averageDuration = (seqPattern.averageDuration * (seqPattern.occurrences - 1) + duration) / seqPattern.occurrences;
      seqPattern.tasks.push(taskId);
    }

    // Convert to MinedPatterns
    for (const [key, seqPattern] of sequenceMap) {
      if (seqPattern.occurrences < minOccurrences) continue;

      const existingIndex = this.patterns.findIndex(p =>
        p.type === 'sequence' &&
        p.pattern.sequence?.join(' -> ') === key
      );

      const pattern: MinedPattern = {
        id: existingIndex >= 0 ? this.patterns[existingIndex].id : this.generateId(),
        type: 'sequence',
        description: `Decision sequence: ${seqPattern.sequence.slice(0, 3).join(' -> ')}${seqPattern.sequence.length > 3 ? '...' : ''}`,
        pattern: {
          sequence: seqPattern.sequence
        },
        evidence: {
          occurrences: seqPattern.occurrences,
          successRate: seqPattern.successRate,
          samples: seqPattern.tasks.slice(0, 10)
        },
        confidence: this.calculateConfidence(seqPattern.occurrences, seqPattern.successRate),
        minedAt: existingIndex >= 0 ? this.patterns[existingIndex].minedAt : Date.now(),
        lastUpdated: Date.now()
      };

      if (existingIndex >= 0) {
        this.patterns[existingIndex] = pattern;
      } else {
        this.patterns.push(pattern);
      }
    }

    return Array.from(sequenceMap.values()).filter(s => s.occurrences >= minOccurrences);
  }

  /**
   * Mine context correlations
   */
  mineContextCorrelations(minOccurrences = 5): ContextCorrelation[] {
    const decisions = DecisionLogger.getWithOutcomes(1000);

    // Track context key/value -> outcome correlations
    const correlationMap = new Map<string, {
      successCount: number;
      totalCount: number;
      value: unknown;
    }>();

    for (const decision of decisions) {
      if (!decision.outcome) continue;

      for (const [key, value] of Object.entries(decision.context)) {
        const correlationKey = `${key}=${JSON.stringify(value)}`;

        if (!correlationMap.has(correlationKey)) {
          correlationMap.set(correlationKey, {
            successCount: 0,
            totalCount: 0,
            value
          });
        }

        const corr = correlationMap.get(correlationKey)!;
        corr.totalCount++;

        if (decision.outcome.result === 'success') {
          corr.successCount++;
        }
      }
    }

    const correlations: ContextCorrelation[] = [];

    for (const [key, data] of correlationMap) {
      if (data.totalCount < minOccurrences) continue;

      const [contextKey] = key.split('=');
      const successRate = data.successCount / data.totalCount;

      correlations.push({
        contextKey,
        contextValue: data.value,
        successRate,
        occurrences: data.totalCount
      });

      // Add as correlation pattern if significant
      if (successRate > 0.7 || successRate < 0.3) {
        const type = successRate > 0.7 ? 'success' : 'failure';
        const existingIndex = this.patterns.findIndex(p =>
          p.type === 'correlation' &&
          p.pattern.conditions?.[contextKey] === data.value
        );

        const pattern: MinedPattern = {
          id: existingIndex >= 0 ? this.patterns[existingIndex].id : this.generateId(),
          type: 'correlation',
          description: `${type === 'success' ? 'Positive' : 'Negative'} correlation: ${contextKey}=${JSON.stringify(data.value)}`,
          pattern: {
            conditions: { [contextKey]: data.value }
          },
          evidence: {
            occurrences: data.totalCount,
            successRate,
            samples: []
          },
          confidence: this.calculateConfidence(data.totalCount, Math.abs(successRate - 0.5) * 2),
          minedAt: existingIndex >= 0 ? this.patterns[existingIndex].minedAt : Date.now(),
          lastUpdated: Date.now()
        };

        if (existingIndex >= 0) {
          this.patterns[existingIndex] = pattern;
        } else {
          this.patterns.push(pattern);
        }
      }
    }

    return correlations.sort((a, b) => b.occurrences - a.occurrences);
  }

  /**
   * Calculate confidence score
   */
  private calculateConfidence(occurrences: number, rate: number): number {
    // More occurrences = higher confidence
    const occurrenceWeight = Math.min(occurrences / 10, 1);

    // Higher/lower success rate = higher confidence
    const rateWeight = Math.abs(rate - 0.5) * 2;

    return (occurrenceWeight * 0.6) + (rateWeight * 0.4);
  }

  /**
   * Get all patterns
   */
  getPatterns(): MinedPattern[] {
    return [...this.patterns];
  }

  /**
   * Get patterns by type
   */
  getPatternsByType(type: MinedPattern['type']): MinedPattern[] {
    return this.patterns.filter(p => p.type === type);
  }

  /**
   * Get success patterns
   */
  getSuccessPatterns(minConfidence = 0.5): MinedPattern[] {
    return this.patterns
      .filter(p => p.type === 'success' && p.confidence >= minConfidence)
      .sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Get failure patterns (anti-patterns)
   */
  getAntiPatterns(minConfidence = 0.5): MinedPattern[] {
    return this.patterns
      .filter(p => p.type === 'failure' && p.confidence >= minConfidence)
      .sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Get high-confidence patterns
   */
  getHighConfidencePatterns(minConfidence = 0.7): MinedPattern[] {
    return this.patterns
      .filter(p => p.confidence >= minConfidence)
      .sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Get patterns for agent type
   */
  getPatternsForAgent(agentType: string): MinedPattern[] {
    return this.patterns
      .filter(p => p.agentType === agentType)
      .sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Get recommended actions based on patterns
   */
  getRecommendations(agentType: string): {
    do: string[];
    avoid: string[];
    sequences: string[];
  } {
    const agentPatterns = this.getPatternsForAgent(agentType);

    return {
      do: agentPatterns
        .filter(p => p.type === 'success' && p.confidence > 0.6)
        .map(p => `Use ${p.pattern.choice} for ${p.pattern.decisionType} (${(p.evidence.successRate * 100).toFixed(0)}% success)`),

      avoid: agentPatterns
        .filter(p => p.type === 'failure' && p.confidence > 0.6)
        .map(p => `Avoid ${p.pattern.choice} for ${p.pattern.decisionType} (${(p.evidence.successRate * 100).toFixed(0)}% success)`),

      sequences: this.patterns
        .filter(p => p.type === 'sequence' && p.confidence > 0.6)
        .map(p => `Try: ${p.pattern.sequence?.slice(0, 3).join(' → ')}`)
    };
  }

  /**
   * Export patterns
   */
  exportData(): MinedPattern[] {
    return [...this.patterns];
  }

  /**
   * Import patterns
   */
  importData(patterns: MinedPattern[]): void {
    this.patterns = [...this.patterns, ...patterns];
  }

  /**
   * Clear patterns
   */
  clear(): void {
    this.patterns = [];
    console.log('[PatternMiner] Cleared all patterns');
  }

  /**
   * Get statistics
   */
  getStats(): {
    total: number;
    byType: Record<string, number>;
    highConfidence: number;
    averageConfidence: number;
  } {
    const byType: Record<string, number> = {};

    for (const pattern of this.patterns) {
      byType[pattern.type] = (byType[pattern.type] || 0) + 1;
    }

    const avgConfidence = this.patterns.length > 0
      ? this.patterns.reduce((sum, p) => sum + p.confidence, 0) / this.patterns.length
      : 0;

    return {
      total: this.patterns.length,
      byType,
      highConfidence: this.patterns.filter(p => p.confidence >= 0.7).length,
      averageConfidence: avgConfidence
    };
  }
}

// Export singleton
export const PatternMiner = new PatternMinerClass();

// Export class for testing
export { PatternMinerClass };
