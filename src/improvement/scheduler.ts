/**
 * ImprovementScheduler - Orchestrate continuous improvement cycle
 *
 * Orchestrates:
 * - Runs analysis every hour (configurable)
 * - Auto-applies high-confidence improvements
 * - Queues others for human approval
 * - Generates domain knowledge summaries
 */

import { EventBus } from '../core/event-bus.js';
import { FeedbackCollector } from './feedback-collector.js';
import { DecisionLogger } from './decision-logger.js';
import { HumanFeedback } from './human-feedback.js';
import { PatternMiner } from './pattern-miner.js';
import { PromptRefiner, RefinedRule } from './prompt-refiner.js';
import { KnowledgeExtractor } from './knowledge-extractor.js';

/** Improvement status */
export interface ImprovementStatus {
  isRunning: boolean;
  lastRun: number | null;
  nextRun: number | null;
  intervalMs: number;
  stats: {
    totalRuns: number;
    patternsDiscovered: number;
    rulesGenerated: number;
    rulesApplied: number;
    knowledgeExtracted: number;
  };
}

/** Improvement run result */
export interface ImprovementRunResult {
  timestamp: number;
  duration: number;
  patterns: {
    success: number;
    failure: number;
    sequence: number;
    total: number;
  };
  rules: {
    generated: number;
    autoApplied: number;
    pending: number;
  };
  knowledge: {
    extracted: number;
    consolidated: number;
  };
  recommendations: string[];
}

/** Pending improvement */
export interface PendingImprovement {
  id: string;
  type: 'rule' | 'pattern' | 'knowledge';
  description: string;
  confidence: number;
  source: unknown;
  createdAt: number;
}

/** Improvement scheduler singleton */
class ImprovementSchedulerClass {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private intervalMs = 3600000;  // 1 hour default
  private isRunning = false;
  private lastRun: number | null = null;
  private stats = {
    totalRuns: 0,
    patternsDiscovered: 0,
    rulesGenerated: 0,
    rulesApplied: 0,
    knowledgeExtracted: 0
  };
  private runHistory: ImprovementRunResult[] = [];
  private maxHistorySize = 100;

  /**
   * Start the improvement scheduler
   */
  start(intervalMs?: number): void {
    if (this.intervalId) {
      console.log('[ImprovementScheduler] Already running');
      return;
    }

    if (intervalMs) {
      this.intervalMs = intervalMs;
    }

    // Start feedback collector
    FeedbackCollector.startListening();

    // Start pattern miner
    PatternMiner.startMining(this.intervalMs);

    // Schedule improvement runs
    this.intervalId = setInterval(() => {
      this.runImprovement();
    }, this.intervalMs);

    // Run initial improvement after a short delay
    setTimeout(() => this.runImprovement(), 5000);

    console.log(`[ImprovementScheduler] Started with ${this.intervalMs}ms interval`);

    EventBus.emit('improvement:started', { intervalMs: this.intervalMs });
  }

  /**
   * Stop the improvement scheduler
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    FeedbackCollector.stopListening();
    PatternMiner.stopMining();

    console.log('[ImprovementScheduler] Stopped');

    EventBus.emit('improvement:stopped', {});
  }

  /**
   * Run improvement cycle
   */
  async runImprovement(): Promise<ImprovementRunResult> {
    if (this.isRunning) {
      console.log('[ImprovementScheduler] Already running improvement cycle');
      return this.getLastResult() || this.createEmptyResult();
    }

    this.isRunning = true;
    const startTime = Date.now();

    console.log('[ImprovementScheduler] Starting improvement cycle...');

    EventBus.emit('improvement:run:start', { timestamp: startTime });

    try {
      // 1. Mine patterns
      PatternMiner.mineAll();
      const patternStats = PatternMiner.getStats();

      // 2. Refine rules from patterns
      const newRules = PromptRefiner.refineFromPatterns();
      const appliedRules = newRules.filter(r => r.status === 'applied');
      const pendingRules = newRules.filter(r => r.status === 'pending');

      // 3. Extract knowledge from successes
      const newKnowledge = KnowledgeExtractor.extractFromSuccesses();
      KnowledgeExtractor.consolidate();
      const knowledgeStats = KnowledgeExtractor.getStats();

      // 4. Generate recommendations
      const recommendations = this.generateRecommendations();

      // Update stats
      this.stats.totalRuns++;
      this.stats.patternsDiscovered += patternStats.total;
      this.stats.rulesGenerated += newRules.length;
      this.stats.rulesApplied += appliedRules.length;
      this.stats.knowledgeExtracted += newKnowledge.length;

      const result: ImprovementRunResult = {
        timestamp: startTime,
        duration: Date.now() - startTime,
        patterns: {
          success: patternStats.byType?.success || 0,
          failure: patternStats.byType?.failure || 0,
          sequence: patternStats.byType?.sequence || 0,
          total: patternStats.total
        },
        rules: {
          generated: newRules.length,
          autoApplied: appliedRules.length,
          pending: pendingRules.length
        },
        knowledge: {
          extracted: newKnowledge.length,
          consolidated: knowledgeStats.total
        },
        recommendations
      };

      // Store in history
      this.runHistory.push(result);
      if (this.runHistory.length > this.maxHistorySize) {
        this.runHistory = this.runHistory.slice(-this.maxHistorySize);
      }

      this.lastRun = Date.now();

      EventBus.emit('improvement:run:complete', result);

      console.log(`[ImprovementScheduler] Improvement cycle complete in ${result.duration}ms`);
      console.log(`  - Patterns: ${result.patterns.total}`);
      console.log(`  - Rules: ${result.rules.generated} generated, ${result.rules.autoApplied} applied`);
      console.log(`  - Knowledge: ${result.knowledge.extracted} extracted`);

      return result;
    } catch (error) {
      console.error('[ImprovementScheduler] Error during improvement cycle:', error);

      EventBus.emit('improvement:run:error', { error });

      return this.createEmptyResult();
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Generate recommendations based on current state
   */
  private generateRecommendations(): string[] {
    const recommendations: string[] = [];

    // Check agent success rates
    const agentStats = FeedbackCollector.getAllStats();
    for (const stats of agentStats) {
      if (stats.successRate < 0.5 && stats.totalTasks > 10) {
        recommendations.push(
          `${stats.agentType} has low success rate (${(stats.successRate * 100).toFixed(0)}%). Review anti-patterns.`
        );
      }
    }

    // Check for pending rules
    const pendingRules = PromptRefiner.getPendingRules();
    if (pendingRules.length > 5) {
      recommendations.push(
        `${pendingRules.length} rules pending review. Run /review-improvements to approve.`
      );
    }

    // Check human feedback trends
    const feedbackSummaries = HumanFeedback.getSummariesByAgentType();
    for (const summary of feedbackSummaries) {
      if (summary.recentTrend === 'declining') {
        recommendations.push(
          `${summary.agentType} satisfaction is declining. Investigate recent changes.`
        );
      }
    }

    // Check decision patterns
    const decisionStats = DecisionLogger.getStats();
    if (decisionStats.pending > 50) {
      recommendations.push(
        `${decisionStats.pending} decisions without outcomes. Ensure agents emit [OUTCOME:] signals.`
      );
    }

    return recommendations;
  }

  /**
   * Create empty result
   */
  private createEmptyResult(): ImprovementRunResult {
    return {
      timestamp: Date.now(),
      duration: 0,
      patterns: { success: 0, failure: 0, sequence: 0, total: 0 },
      rules: { generated: 0, autoApplied: 0, pending: 0 },
      knowledge: { extracted: 0, consolidated: 0 },
      recommendations: []
    };
  }

  /**
   * Get last run result
   */
  getLastResult(): ImprovementRunResult | null {
    return this.runHistory.length > 0
      ? this.runHistory[this.runHistory.length - 1]
      : null;
  }

  /**
   * Get run history
   */
  getHistory(limit = 10): ImprovementRunResult[] {
    return this.runHistory.slice(-limit);
  }

  /**
   * Get current status
   */
  getStatus(): ImprovementStatus {
    return {
      isRunning: this.isRunning,
      lastRun: this.lastRun,
      nextRun: this.lastRun && this.intervalId
        ? this.lastRun + this.intervalMs
        : null,
      intervalMs: this.intervalMs,
      stats: { ...this.stats }
    };
  }

  /**
   * Report status (formatted)
   */
  reportStatus(): string {
    const status = this.getStatus();
    const lines: string[] = [
      '## Improvement System Status',
      '',
      `**Status:** ${status.isRunning ? 'Running' : this.intervalId ? 'Scheduled' : 'Stopped'}`,
      `**Interval:** ${(status.intervalMs / 60000).toFixed(0)} minutes`,
      `**Last Run:** ${status.lastRun ? new Date(status.lastRun).toLocaleString() : 'Never'}`,
      `**Next Run:** ${status.nextRun ? new Date(status.nextRun).toLocaleString() : 'Not scheduled'}`,
      '',
      '### Statistics',
      `- Total runs: ${status.stats.totalRuns}`,
      `- Patterns discovered: ${status.stats.patternsDiscovered}`,
      `- Rules generated: ${status.stats.rulesGenerated}`,
      `- Rules applied: ${status.stats.rulesApplied}`,
      `- Knowledge extracted: ${status.stats.knowledgeExtracted}`
    ];

    // Add recent recommendations
    const lastResult = this.getLastResult();
    if (lastResult && lastResult.recommendations.length > 0) {
      lines.push('', '### Recommendations');
      for (const rec of lastResult.recommendations) {
        lines.push(`- ${rec}`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Get pending improvements for review
   */
  getPendingImprovements(): PendingImprovement[] {
    const pending: PendingImprovement[] = [];

    // Pending rules
    const pendingRules = PromptRefiner.getPendingRules();
    for (const rule of pendingRules) {
      pending.push({
        id: rule.id,
        type: 'rule',
        description: rule.rule,
        confidence: rule.confidence,
        source: rule,
        createdAt: rule.createdAt
      });
    }

    // High-confidence patterns not yet converted to rules
    const patterns = PatternMiner.getHighConfidencePatterns(0.7);
    for (const pattern of patterns.slice(0, 10)) {
      pending.push({
        id: pattern.id,
        type: 'pattern',
        description: pattern.description,
        confidence: pattern.confidence,
        source: pattern,
        createdAt: pattern.minedAt
      });
    }

    return pending.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Review and approve improvement
   */
  approveImprovement(id: string): boolean {
    // Try as rule
    if (PromptRefiner.approveRule(id)) {
      PromptRefiner.applyRule(id);
      return true;
    }

    return false;
  }

  /**
   * Reject improvement
   */
  rejectImprovement(id: string): boolean {
    return PromptRefiner.rejectRule(id);
  }

  /**
   * Get agent success rates
   */
  getAgentSuccessRates(): Record<string, number> {
    const stats = FeedbackCollector.getAllStats();
    const rates: Record<string, number> = {};

    for (const stat of stats) {
      rates[stat.agentType] = stat.successRate;
    }

    return rates;
  }

  /**
   * Generate prompt additions for agent
   */
  generatePromptAdditions(agentType: string): string {
    const sections: string[] = [];

    // Add refined rules
    const rulesAdditions = PromptRefiner.generatePromptAdditions(agentType);
    if (rulesAdditions) {
      sections.push(rulesAdditions);
    }

    // Add extracted knowledge
    const knowledgeAdditions = KnowledgeExtractor.generatePromptAdditions(agentType);
    if (knowledgeAdditions) {
      sections.push(knowledgeAdditions);
    }

    // Add recommendations from patterns
    const recommendations = PatternMiner.getRecommendations(agentType);
    if (recommendations.do.length > 0 || recommendations.avoid.length > 0) {
      sections.push('\n## Pattern-Based Guidance\n');

      if (recommendations.do.length > 0) {
        sections.push('### Recommended:');
        for (const rec of recommendations.do.slice(0, 5)) {
          sections.push(`- ${rec}`);
        }
      }

      if (recommendations.avoid.length > 0) {
        sections.push('\n### Avoid:');
        for (const rec of recommendations.avoid.slice(0, 5)) {
          sections.push(`- ${rec}`);
        }
      }
    }

    return sections.join('\n');
  }

  /**
   * Export all improvement data
   */
  exportAllData(): {
    feedback: ReturnType<typeof FeedbackCollector.exportData>;
    decisions: ReturnType<typeof DecisionLogger.exportData>;
    humanFeedback: ReturnType<typeof HumanFeedback.exportData>;
    patterns: ReturnType<typeof PatternMiner.exportData>;
    rules: ReturnType<typeof PromptRefiner.exportData>;
    knowledge: ReturnType<typeof KnowledgeExtractor.exportData>;
    history: ImprovementRunResult[];
    exportedAt: number;
  } {
    return {
      feedback: FeedbackCollector.exportData(),
      decisions: DecisionLogger.exportData(),
      humanFeedback: HumanFeedback.exportData(),
      patterns: PatternMiner.exportData(),
      rules: PromptRefiner.exportData(),
      knowledge: KnowledgeExtractor.exportData(),
      history: this.runHistory,
      exportedAt: Date.now()
    };
  }

  /**
   * Import improvement data
   */
  importAllData(data: {
    feedback?: ReturnType<typeof FeedbackCollector.exportData>;
    decisions?: ReturnType<typeof DecisionLogger.exportData>;
    humanFeedback?: ReturnType<typeof HumanFeedback.exportData>;
    patterns?: ReturnType<typeof PatternMiner.exportData>;
    rules?: ReturnType<typeof PromptRefiner.exportData>;
    knowledge?: ReturnType<typeof KnowledgeExtractor.exportData>;
  }): void {
    if (data.feedback) {
      FeedbackCollector.importData(data.feedback);
    }
    if (data.decisions) {
      DecisionLogger.importData(data.decisions);
    }
    if (data.humanFeedback) {
      HumanFeedback.importData(data.humanFeedback);
    }
    if (data.patterns) {
      PatternMiner.importData(data.patterns);
    }
    if (data.rules) {
      PromptRefiner.importData(data.rules);
    }
    if (data.knowledge) {
      KnowledgeExtractor.importData(data.knowledge);
    }

    console.log('[ImprovementScheduler] Imported improvement data');
  }

  /**
   * Reset all improvement data
   */
  reset(): void {
    FeedbackCollector.clear();
    DecisionLogger.clear();
    HumanFeedback.clear();
    PatternMiner.clear();
    PromptRefiner.clear();
    KnowledgeExtractor.clear();

    this.runHistory = [];
    this.stats = {
      totalRuns: 0,
      patternsDiscovered: 0,
      rulesGenerated: 0,
      rulesApplied: 0,
      knowledgeExtracted: 0
    };

    console.log('[ImprovementScheduler] Reset all improvement data');
  }
}

// Export singleton
export const ImprovementScheduler = new ImprovementSchedulerClass();

// Export class for testing
export { ImprovementSchedulerClass };
