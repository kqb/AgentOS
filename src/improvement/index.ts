/**
 * Self-Improvement System
 *
 * Enables agents to learn from successes/failures,
 * accumulate domain knowledge, and refine their own prompts.
 *
 * Components:
 * - FeedbackCollector: Auto-collect signals from workflow events
 * - DecisionLogger: Log agent decisions with context
 * - HumanFeedback: Thumbs up/down ratings system
 * - PatternMiner: Mine success/failure patterns
 * - PromptRefiner: Auto-update agent rules
 * - KnowledgeExtractor: Extract domain knowledge
 * - ImprovementScheduler: Orchestrate continuous improvement
 */

// Core components
export { FeedbackCollector, FeedbackCollectorClass } from './feedback-collector.js';
export type { FeedbackEntry, AgentStats } from './feedback-collector.js';

export { DecisionLogger, DecisionLoggerClass } from './decision-logger.js';
export type { DecisionType, DecisionEntry, DecisionPattern } from './decision-logger.js';

export { HumanFeedback, HumanFeedbackClass } from './human-feedback.js';
export type { FeedbackRating, HumanFeedbackEntry, FeedbackSummary } from './human-feedback.js';

export { PatternMiner, PatternMinerClass } from './pattern-miner.js';
export type { MinedPattern, SequencePattern, ContextCorrelation } from './pattern-miner.js';

export { PromptRefiner, PromptRefinerClass } from './prompt-refiner.js';
export type { RuleType, RefinedRule, RuleUpdate } from './prompt-refiner.js';

export { KnowledgeExtractor, KnowledgeExtractorClass } from './knowledge-extractor.js';
export type { KnowledgeType, ExtractedKnowledge, KnowledgeSummary } from './knowledge-extractor.js';

export { ImprovementScheduler, ImprovementSchedulerClass } from './scheduler.js';
export type { ImprovementStatus, ImprovementRunResult, PendingImprovement } from './scheduler.js';

/**
 * Initialize the self-improvement system
 */
export function initImprovement(config?: {
  intervalMs?: number;
  autoApplyThreshold?: number;
  startImmediately?: boolean;
}): void {
  const {
    intervalMs = 3600000,  // 1 hour
    autoApplyThreshold = 0.85,
    startImmediately = true
  } = config || {};

  // Configure prompt refiner
  const { PromptRefiner } = require('./prompt-refiner.js');
  PromptRefiner.setAutoApplyThreshold(autoApplyThreshold);

  // Start scheduler if requested
  if (startImmediately) {
    const { ImprovementScheduler } = require('./scheduler.js');
    ImprovementScheduler.start(intervalMs);
  }

  console.log('[Improvement] Self-improvement system initialized');
}

/**
 * Quick helper to log a decision
 */
export function logDecision(
  agentId: string,
  type: 'action' | 'approach' | 'tool' | 'delegation' | 'pattern' | 'retry',
  choice: string,
  context?: Record<string, unknown>
): string {
  const { DecisionLogger } = require('./decision-logger.js');
  const entry = DecisionLogger.log(agentId, {
    type,
    choice,
    context
  });
  return entry.id;
}

/**
 * Quick helper to record decision outcome
 */
export function recordOutcome(
  decisionId: string,
  result: 'success' | 'failure' | 'partial',
  notes?: string
): boolean {
  const { DecisionLogger } = require('./decision-logger.js');
  return DecisionLogger.recordOutcome(decisionId, result, notes);
}

/**
 * Quick helper to give thumbs up
 */
export function thumbsUp(agentId: string, agentType?: string): void {
  const { HumanFeedback } = require('./human-feedback.js');
  HumanFeedback.thumbsUp(agentId, { agentType });
}

/**
 * Quick helper to give thumbs down
 */
export function thumbsDown(agentId: string, comment?: string, agentType?: string): void {
  const { HumanFeedback } = require('./human-feedback.js');
  HumanFeedback.thumbsDown(agentId, comment, { agentType });
}

/**
 * Get improvement status
 */
export function getImprovementStatus(): {
  isRunning: boolean;
  stats: {
    patterns: number;
    rules: number;
    knowledge: number;
    feedbackEntries: number;
    decisions: number;
  };
} {
  const { ImprovementScheduler } = require('./scheduler.js');
  const { PatternMiner } = require('./pattern-miner.js');
  const { PromptRefiner } = require('./prompt-refiner.js');
  const { KnowledgeExtractor } = require('./knowledge-extractor.js');
  const { FeedbackCollector } = require('./feedback-collector.js');
  const { DecisionLogger } = require('./decision-logger.js');

  const status = ImprovementScheduler.getStatus();

  return {
    isRunning: !!status.lastRun,
    stats: {
      patterns: PatternMiner.getStats().total,
      rules: PromptRefiner.getStats().total,
      knowledge: KnowledgeExtractor.getStats().total,
      feedbackEntries: FeedbackCollector.getRecentFeedback(10000).length,
      decisions: DecisionLogger.getStats().total
    }
  };
}
