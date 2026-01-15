/**
 * HumanFeedback - Thumbs up/down ratings system
 *
 * Allows users to provide explicit feedback on:
 * - Agent outputs
 * - Workflow results
 * - Generated code
 * - Suggestions
 */

import { EventBus } from '../core/event-bus.js';
import { FeedbackCollector } from './feedback-collector.js';

/** Human feedback rating */
export type FeedbackRating = 'thumbs_up' | 'thumbs_down' | 'neutral';

/** Human feedback entry */
export interface HumanFeedbackEntry {
  id: string;
  timestamp: number;
  rating: FeedbackRating;
  agentId?: string;
  agentType?: string;
  taskId?: string;
  workflowId?: string;
  targetType: 'output' | 'code' | 'suggestion' | 'workflow' | 'general';
  targetId?: string;
  comment?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

/** Feedback summary */
export interface FeedbackSummary {
  targetType: string;
  agentType?: string;
  totalCount: number;
  thumbsUp: number;
  thumbsDown: number;
  neutral: number;
  positiveRate: number;
  recentTrend: 'improving' | 'declining' | 'stable';
}

/** Human feedback manager singleton */
class HumanFeedbackClass {
  private feedback: HumanFeedbackEntry[] = [];
  private maxEntries = 5000;

  /**
   * Generate unique ID
   */
  private generateId(): string {
    return `hf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  /**
   * Give thumbs up
   */
  thumbsUp(
    agentId: string,
    options?: {
      agentType?: string;
      taskId?: string;
      workflowId?: string;
      targetType?: HumanFeedbackEntry['targetType'];
      targetId?: string;
      comment?: string;
      tags?: string[];
    }
  ): HumanFeedbackEntry {
    return this.addFeedback({
      rating: 'thumbs_up',
      agentId,
      ...options
    });
  }

  /**
   * Give thumbs down
   */
  thumbsDown(
    agentId: string,
    comment?: string,
    options?: {
      agentType?: string;
      taskId?: string;
      workflowId?: string;
      targetType?: HumanFeedbackEntry['targetType'];
      targetId?: string;
      tags?: string[];
    }
  ): HumanFeedbackEntry {
    return this.addFeedback({
      rating: 'thumbs_down',
      agentId,
      comment,
      ...options
    });
  }

  /**
   * Give neutral feedback
   */
  neutral(
    agentId: string,
    comment?: string,
    options?: {
      agentType?: string;
      taskId?: string;
      targetType?: HumanFeedbackEntry['targetType'];
    }
  ): HumanFeedbackEntry {
    return this.addFeedback({
      rating: 'neutral',
      agentId,
      comment,
      ...options
    });
  }

  /**
   * Add feedback entry
   */
  private addFeedback(data: Omit<HumanFeedbackEntry, 'id' | 'timestamp'>): HumanFeedbackEntry {
    const entry: HumanFeedbackEntry = {
      id: this.generateId(),
      timestamp: Date.now(),
      rating: data.rating,
      agentId: data.agentId,
      agentType: data.agentType,
      taskId: data.taskId,
      workflowId: data.workflowId,
      targetType: data.targetType || 'general',
      targetId: data.targetId,
      comment: data.comment,
      tags: data.tags,
      metadata: data.metadata
    };

    this.feedback.push(entry);

    // Trim old entries
    if (this.feedback.length > this.maxEntries) {
      this.feedback = this.feedback.slice(-this.maxEntries);
    }

    // Also add to FeedbackCollector for unified tracking
    if (data.agentType) {
      const outcome = data.rating === 'thumbs_up' ? 'success' :
                      data.rating === 'thumbs_down' ? 'failure' : 'partial';

      FeedbackCollector.addHumanFeedback(
        data.agentId || 'unknown',
        data.agentType,
        outcome,
        {
          rating: data.rating,
          comment: data.comment,
          targetType: data.targetType
        }
      );
    }

    // Emit event
    EventBus.emit('human:feedback', entry);

    console.log(`[HumanFeedback] ${data.rating} for agent ${data.agentId}`);

    return entry;
  }

  /**
   * Rate code output
   */
  rateCode(
    agentId: string,
    codeId: string,
    rating: FeedbackRating,
    comment?: string
  ): HumanFeedbackEntry {
    return this.addFeedback({
      rating,
      agentId,
      targetType: 'code',
      targetId: codeId,
      comment
    });
  }

  /**
   * Rate suggestion
   */
  rateSuggestion(
    agentId: string,
    suggestionId: string,
    rating: FeedbackRating,
    comment?: string
  ): HumanFeedbackEntry {
    return this.addFeedback({
      rating,
      agentId,
      targetType: 'suggestion',
      targetId: suggestionId,
      comment
    });
  }

  /**
   * Rate workflow result
   */
  rateWorkflow(
    workflowId: string,
    rating: FeedbackRating,
    comment?: string
  ): HumanFeedbackEntry {
    return this.addFeedback({
      rating,
      workflowId,
      targetType: 'workflow',
      targetId: workflowId,
      comment
    });
  }

  /**
   * Get feedback by agent
   */
  getByAgent(agentId: string, limit = 100): HumanFeedbackEntry[] {
    return this.feedback
      .filter(f => f.agentId === agentId)
      .slice(-limit);
  }

  /**
   * Get feedback by agent type
   */
  getByAgentType(agentType: string, limit = 100): HumanFeedbackEntry[] {
    return this.feedback
      .filter(f => f.agentType === agentType)
      .slice(-limit);
  }

  /**
   * Get feedback by target type
   */
  getByTargetType(targetType: HumanFeedbackEntry['targetType'], limit = 100): HumanFeedbackEntry[] {
    return this.feedback
      .filter(f => f.targetType === targetType)
      .slice(-limit);
  }

  /**
   * Get positive feedback
   */
  getPositive(limit = 100): HumanFeedbackEntry[] {
    return this.feedback
      .filter(f => f.rating === 'thumbs_up')
      .slice(-limit);
  }

  /**
   * Get negative feedback
   */
  getNegative(limit = 100): HumanFeedbackEntry[] {
    return this.feedback
      .filter(f => f.rating === 'thumbs_down')
      .slice(-limit);
  }

  /**
   * Get feedback with comments
   */
  getWithComments(limit = 100): HumanFeedbackEntry[] {
    return this.feedback
      .filter(f => f.comment)
      .slice(-limit);
  }

  /**
   * Get recent feedback
   */
  getRecent(limit = 100): HumanFeedbackEntry[] {
    return this.feedback.slice(-limit);
  }

  /**
   * Calculate positive rate for agent type
   */
  getPositiveRate(agentType: string): number {
    const entries = this.feedback.filter(f => f.agentType === agentType);
    if (entries.length === 0) return 0;

    const positive = entries.filter(f => f.rating === 'thumbs_up').length;
    return positive / entries.length;
  }

  /**
   * Get summary for agent type
   */
  getSummary(agentType?: string): FeedbackSummary {
    const entries = agentType
      ? this.feedback.filter(f => f.agentType === agentType)
      : this.feedback;

    const thumbsUp = entries.filter(f => f.rating === 'thumbs_up').length;
    const thumbsDown = entries.filter(f => f.rating === 'thumbs_down').length;
    const neutral = entries.filter(f => f.rating === 'neutral').length;
    const total = entries.length;

    // Calculate recent trend (last 20% vs previous 20%)
    const recentCount = Math.floor(entries.length * 0.2);
    const recent = entries.slice(-recentCount);
    const previous = entries.slice(-recentCount * 2, -recentCount);

    const recentPositive = recent.filter(f => f.rating === 'thumbs_up').length / (recent.length || 1);
    const previousPositive = previous.filter(f => f.rating === 'thumbs_up').length / (previous.length || 1);

    let trend: FeedbackSummary['recentTrend'] = 'stable';
    if (recentPositive > previousPositive + 0.1) {
      trend = 'improving';
    } else if (recentPositive < previousPositive - 0.1) {
      trend = 'declining';
    }

    return {
      targetType: 'all',
      agentType,
      totalCount: total,
      thumbsUp,
      thumbsDown,
      neutral,
      positiveRate: total > 0 ? thumbsUp / total : 0,
      recentTrend: trend
    };
  }

  /**
   * Get summaries by agent type
   */
  getSummariesByAgentType(): FeedbackSummary[] {
    const agentTypes = new Set(
      this.feedback
        .filter(f => f.agentType)
        .map(f => f.agentType!)
    );

    return Array.from(agentTypes).map(type => this.getSummary(type));
  }

  /**
   * Get summaries by target type
   */
  getSummariesByTargetType(): FeedbackSummary[] {
    const targetTypes: HumanFeedbackEntry['targetType'][] = [
      'output', 'code', 'suggestion', 'workflow', 'general'
    ];

    return targetTypes.map(targetType => {
      const entries = this.feedback.filter(f => f.targetType === targetType);
      const thumbsUp = entries.filter(f => f.rating === 'thumbs_up').length;
      const thumbsDown = entries.filter(f => f.rating === 'thumbs_down').length;
      const neutral = entries.filter(f => f.rating === 'neutral').length;

      return {
        targetType,
        totalCount: entries.length,
        thumbsUp,
        thumbsDown,
        neutral,
        positiveRate: entries.length > 0 ? thumbsUp / entries.length : 0,
        recentTrend: 'stable' as const
      };
    });
  }

  /**
   * Get common complaint tags
   */
  getCommonTags(limit = 10): Array<{ tag: string; count: number }> {
    const tagCounts = new Map<string, number>();

    for (const entry of this.feedback) {
      if (entry.tags) {
        for (const tag of entry.tags) {
          tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
        }
      }
    }

    return Array.from(tagCounts.entries())
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  }

  /**
   * Export feedback
   */
  exportData(): HumanFeedbackEntry[] {
    return [...this.feedback];
  }

  /**
   * Import feedback
   */
  importData(entries: HumanFeedbackEntry[]): void {
    this.feedback = [...this.feedback, ...entries];

    if (this.feedback.length > this.maxEntries) {
      this.feedback = this.feedback.slice(-this.maxEntries);
    }
  }

  /**
   * Clear all feedback
   */
  clear(): void {
    this.feedback = [];
    console.log('[HumanFeedback] Cleared all feedback');
  }

  /**
   * Get statistics
   */
  getStats(): {
    total: number;
    thumbsUp: number;
    thumbsDown: number;
    neutral: number;
    withComments: number;
    byAgentType: Record<string, number>;
    byTargetType: Record<string, number>;
  } {
    const byAgentType: Record<string, number> = {};
    const byTargetType: Record<string, number> = {};

    for (const entry of this.feedback) {
      if (entry.agentType) {
        byAgentType[entry.agentType] = (byAgentType[entry.agentType] || 0) + 1;
      }
      byTargetType[entry.targetType] = (byTargetType[entry.targetType] || 0) + 1;
    }

    return {
      total: this.feedback.length,
      thumbsUp: this.feedback.filter(f => f.rating === 'thumbs_up').length,
      thumbsDown: this.feedback.filter(f => f.rating === 'thumbs_down').length,
      neutral: this.feedback.filter(f => f.rating === 'neutral').length,
      withComments: this.feedback.filter(f => f.comment).length,
      byAgentType,
      byTargetType
    };
  }
}

// Export singleton
export const HumanFeedback = new HumanFeedbackClass();

// Export class for testing
export { HumanFeedbackClass };
