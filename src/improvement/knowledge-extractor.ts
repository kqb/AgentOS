/**
 * KnowledgeExtractor - Extract domain knowledge from successful tasks
 *
 * Extracts:
 * - Domain-specific insights
 * - Code patterns (for SWE agents)
 * - Test patterns (for QA agents)
 * - Workflow patterns (for Team Lead)
 */

import { EventBus } from '../core/event-bus.js';
import { FeedbackCollector, FeedbackEntry } from './feedback-collector.js';
import { DecisionLogger, DecisionEntry } from './decision-logger.js';

/** Knowledge type */
export type KnowledgeType =
  | 'code_pattern'
  | 'test_pattern'
  | 'workflow_pattern'
  | 'domain_insight'
  | 'error_resolution'
  | 'best_practice';

/** Extracted knowledge */
export interface ExtractedKnowledge {
  id: string;
  type: KnowledgeType;
  agentType: string;
  title: string;
  content: string;
  context: Record<string, unknown>;
  source: {
    taskIds: string[];
    feedbackIds: string[];
    decisionIds: string[];
  };
  quality: {
    confidence: number;
    occurrences: number;
    successRate: number;
  };
  tags: string[];
  createdAt: number;
  lastUpdated: number;
}

/** Knowledge summary */
export interface KnowledgeSummary {
  agentType: string;
  totalKnowledge: number;
  byType: Record<KnowledgeType, number>;
  topTags: Array<{ tag: string; count: number }>;
  avgConfidence: number;
}

/** Knowledge extractor singleton */
class KnowledgeExtractorClass {
  private knowledge: ExtractedKnowledge[] = [];
  private maxEntries = 1000;

  /**
   * Generate unique ID
   */
  private generateId(): string {
    return `know-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  /**
   * Extract knowledge from recent successes
   */
  extractFromSuccesses(agentType?: string): ExtractedKnowledge[] {
    const newKnowledge: ExtractedKnowledge[] = [];

    // Get successful feedback
    const feedback = FeedbackCollector.getRecentFeedback(500)
      .filter(f => f.outcome === 'success')
      .filter(f => !agentType || f.agentType === agentType);

    // Group by task
    const taskFeedback = this.groupByTask(feedback);

    for (const [taskId, entries] of taskFeedback) {
      const extracted = this.extractFromTask(taskId, entries);
      for (const k of extracted) {
        if (!this.knowledgeExists(k.title)) {
          this.knowledge.push(k);
          newKnowledge.push(k);
        }
      }
    }

    // Trim if over limit
    if (this.knowledge.length > this.maxEntries) {
      this.knowledge = this.knowledge.slice(-this.maxEntries);
    }

    if (newKnowledge.length > 0) {
      EventBus.emit('knowledge:extracted', { count: newKnowledge.length });
    }

    console.log(`[KnowledgeExtractor] Extracted ${newKnowledge.length} new knowledge entries`);

    return newKnowledge;
  }

  /**
   * Group feedback by task
   */
  private groupByTask(feedback: FeedbackEntry[]): Map<string, FeedbackEntry[]> {
    const grouped = new Map<string, FeedbackEntry[]>();

    for (const entry of feedback) {
      if (!entry.taskId) continue;

      if (!grouped.has(entry.taskId)) {
        grouped.set(entry.taskId, []);
      }
      grouped.get(entry.taskId)!.push(entry);
    }

    return grouped;
  }

  /**
   * Check if knowledge already exists
   */
  private knowledgeExists(title: string): boolean {
    const normalized = title.toLowerCase().trim();
    return this.knowledge.some(k => k.title.toLowerCase().trim() === normalized);
  }

  /**
   * Extract knowledge from a task
   */
  private extractFromTask(taskId: string, feedback: FeedbackEntry[]): ExtractedKnowledge[] {
    const extracted: ExtractedKnowledge[] = [];

    // Get decisions for this task
    const decisions = DecisionLogger.getTaskDecisionSequence(taskId);

    if (decisions.length === 0) return extracted;

    const agentType = feedback[0]?.agentType || decisions[0]?.agentType || 'unknown';

    // Extract based on agent type
    switch (agentType) {
      case 'code-generator':
        extracted.push(...this.extractCodePatterns(taskId, decisions, feedback));
        break;

      case 'test-writer':
      case 'qa-engineer':
        extracted.push(...this.extractTestPatterns(taskId, decisions, feedback));
        break;

      case 'team-lead':
        extracted.push(...this.extractWorkflowPatterns(taskId, decisions, feedback));
        break;

      case 'debugger':
        extracted.push(...this.extractErrorResolutions(taskId, decisions, feedback));
        break;

      default:
        extracted.push(...this.extractGenericInsights(taskId, decisions, feedback));
    }

    return extracted;
  }

  /**
   * Extract code patterns for SWE agents
   */
  private extractCodePatterns(
    taskId: string,
    decisions: DecisionEntry[],
    feedback: FeedbackEntry[]
  ): ExtractedKnowledge[] {
    const patterns: ExtractedKnowledge[] = [];

    // Find pattern decisions
    const patternDecisions = decisions.filter(d =>
      d.type === 'pattern' && d.outcome?.result === 'success'
    );

    for (const decision of patternDecisions) {
      patterns.push({
        id: this.generateId(),
        type: 'code_pattern',
        agentType: 'code-generator',
        title: `Pattern: ${decision.choice}`,
        content: `Using ${decision.choice} pattern proved effective. ${decision.reasoning || ''}`,
        context: decision.context,
        source: {
          taskIds: [taskId],
          feedbackIds: feedback.map(f => f.id),
          decisionIds: [decision.id]
        },
        quality: {
          confidence: 0.7,
          occurrences: 1,
          successRate: 1.0
        },
        tags: ['code', 'pattern', decision.choice],
        createdAt: Date.now(),
        lastUpdated: Date.now()
      });
    }

    // Find tool decisions
    const toolDecisions = decisions.filter(d =>
      d.type === 'tool' && d.outcome?.result === 'success'
    );

    for (const decision of toolDecisions) {
      patterns.push({
        id: this.generateId(),
        type: 'best_practice',
        agentType: 'code-generator',
        title: `Tool: ${decision.choice}`,
        content: `${decision.choice} worked well for this task. ${decision.reasoning || ''}`,
        context: decision.context,
        source: {
          taskIds: [taskId],
          feedbackIds: feedback.map(f => f.id),
          decisionIds: [decision.id]
        },
        quality: {
          confidence: 0.6,
          occurrences: 1,
          successRate: 1.0
        },
        tags: ['tool', decision.choice],
        createdAt: Date.now(),
        lastUpdated: Date.now()
      });
    }

    return patterns;
  }

  /**
   * Extract test patterns for QA agents
   */
  private extractTestPatterns(
    taskId: string,
    decisions: DecisionEntry[],
    feedback: FeedbackEntry[]
  ): ExtractedKnowledge[] {
    const patterns: ExtractedKnowledge[] = [];

    // Find approach decisions
    const approachDecisions = decisions.filter(d =>
      d.type === 'approach' && d.outcome?.result === 'success'
    );

    for (const decision of approachDecisions) {
      patterns.push({
        id: this.generateId(),
        type: 'test_pattern',
        agentType: 'qa-engineer',
        title: `Test approach: ${decision.choice}`,
        content: `${decision.choice} approach led to successful testing. ${decision.reasoning || ''}`,
        context: decision.context,
        source: {
          taskIds: [taskId],
          feedbackIds: feedback.map(f => f.id),
          decisionIds: [decision.id]
        },
        quality: {
          confidence: 0.7,
          occurrences: 1,
          successRate: 1.0
        },
        tags: ['testing', 'approach', decision.choice],
        createdAt: Date.now(),
        lastUpdated: Date.now()
      });
    }

    // Look for test coverage in feedback
    const testFeedback = feedback.filter(f => f.type === 'test');
    for (const tf of testFeedback) {
      const coverage = (tf.context as Record<string, unknown>).coverage as number;
      if (coverage && coverage > 80) {
        patterns.push({
          id: this.generateId(),
          type: 'domain_insight',
          agentType: 'qa-engineer',
          title: `High coverage strategy`,
          content: `Achieved ${coverage}% coverage. Task context provides clues for replication.`,
          context: tf.context,
          source: {
            taskIds: [taskId],
            feedbackIds: [tf.id],
            decisionIds: []
          },
          quality: {
            confidence: 0.8,
            occurrences: 1,
            successRate: 1.0
          },
          tags: ['testing', 'coverage', 'high-performance'],
          createdAt: Date.now(),
          lastUpdated: Date.now()
        });
      }
    }

    return patterns;
  }

  /**
   * Extract workflow patterns for Team Lead
   */
  private extractWorkflowPatterns(
    taskId: string,
    decisions: DecisionEntry[],
    feedback: FeedbackEntry[]
  ): ExtractedKnowledge[] {
    const patterns: ExtractedKnowledge[] = [];

    // Find delegation decisions
    const delegationDecisions = decisions.filter(d =>
      d.type === 'delegation' && d.outcome?.result === 'success'
    );

    for (const decision of delegationDecisions) {
      patterns.push({
        id: this.generateId(),
        type: 'workflow_pattern',
        agentType: 'team-lead',
        title: `Delegation: ${decision.choice}`,
        content: `Delegating to ${decision.choice} was effective. ${decision.reasoning || ''}`,
        context: decision.context,
        source: {
          taskIds: [taskId],
          feedbackIds: feedback.map(f => f.id),
          decisionIds: [decision.id]
        },
        quality: {
          confidence: 0.7,
          occurrences: 1,
          successRate: 1.0
        },
        tags: ['delegation', 'workflow', decision.choice],
        createdAt: Date.now(),
        lastUpdated: Date.now()
      });
    }

    // Extract sequence if multiple decisions
    if (decisions.length >= 3) {
      const sequence = decisions.map(d => d.choice).join(' → ');

      patterns.push({
        id: this.generateId(),
        type: 'workflow_pattern',
        agentType: 'team-lead',
        title: `Workflow sequence`,
        content: `Successful workflow: ${sequence}`,
        context: {
          steps: decisions.map(d => ({ type: d.type, choice: d.choice }))
        },
        source: {
          taskIds: [taskId],
          feedbackIds: feedback.map(f => f.id),
          decisionIds: decisions.map(d => d.id)
        },
        quality: {
          confidence: 0.6,
          occurrences: 1,
          successRate: 1.0
        },
        tags: ['workflow', 'sequence'],
        createdAt: Date.now(),
        lastUpdated: Date.now()
      });
    }

    return patterns;
  }

  /**
   * Extract error resolutions for Debugger
   */
  private extractErrorResolutions(
    taskId: string,
    decisions: DecisionEntry[],
    feedback: FeedbackEntry[]
  ): ExtractedKnowledge[] {
    const patterns: ExtractedKnowledge[] = [];

    // Find retry decisions that eventually succeeded
    const retryDecisions = decisions.filter(d =>
      d.type === 'retry' && d.outcome?.result === 'success'
    );

    for (const decision of retryDecisions) {
      patterns.push({
        id: this.generateId(),
        type: 'error_resolution',
        agentType: 'debugger',
        title: `Resolution: ${decision.choice}`,
        content: `${decision.choice} resolved the issue. ${decision.reasoning || ''}`,
        context: decision.context,
        source: {
          taskIds: [taskId],
          feedbackIds: feedback.map(f => f.id),
          decisionIds: [decision.id]
        },
        quality: {
          confidence: 0.8,
          occurrences: 1,
          successRate: 1.0
        },
        tags: ['debugging', 'resolution', decision.choice],
        createdAt: Date.now(),
        lastUpdated: Date.now()
      });
    }

    return patterns;
  }

  /**
   * Extract generic insights
   */
  private extractGenericInsights(
    taskId: string,
    decisions: DecisionEntry[],
    feedback: FeedbackEntry[]
  ): ExtractedKnowledge[] {
    const patterns: ExtractedKnowledge[] = [];

    const successfulDecisions = decisions.filter(d => d.outcome?.result === 'success');

    for (const decision of successfulDecisions) {
      patterns.push({
        id: this.generateId(),
        type: 'domain_insight',
        agentType: decision.agentType,
        title: `${decision.type}: ${decision.choice}`,
        content: `${decision.choice} worked for ${decision.type}. ${decision.reasoning || ''}`,
        context: decision.context,
        source: {
          taskIds: [taskId],
          feedbackIds: feedback.map(f => f.id),
          decisionIds: [decision.id]
        },
        quality: {
          confidence: 0.5,
          occurrences: 1,
          successRate: 1.0
        },
        tags: [decision.type, decision.choice],
        createdAt: Date.now(),
        lastUpdated: Date.now()
      });
    }

    return patterns;
  }

  /**
   * Consolidate similar knowledge entries
   */
  consolidate(): void {
    const consolidated = new Map<string, ExtractedKnowledge>();

    for (const k of this.knowledge) {
      const key = `${k.type}:${k.title}`;

      if (consolidated.has(key)) {
        const existing = consolidated.get(key)!;

        // Merge sources
        existing.source.taskIds.push(...k.source.taskIds);
        existing.source.feedbackIds.push(...k.source.feedbackIds);
        existing.source.decisionIds.push(...k.source.decisionIds);

        // Update quality
        existing.quality.occurrences++;
        existing.quality.confidence = Math.min(1, existing.quality.confidence + 0.1);

        // Merge tags
        for (const tag of k.tags) {
          if (!existing.tags.includes(tag)) {
            existing.tags.push(tag);
          }
        }

        existing.lastUpdated = Date.now();
      } else {
        consolidated.set(key, { ...k });
      }
    }

    this.knowledge = Array.from(consolidated.values());

    console.log(`[KnowledgeExtractor] Consolidated to ${this.knowledge.length} entries`);
  }

  /**
   * Get all knowledge
   */
  getKnowledge(): ExtractedKnowledge[] {
    return [...this.knowledge];
  }

  /**
   * Get knowledge by type
   */
  getByType(type: KnowledgeType): ExtractedKnowledge[] {
    return this.knowledge.filter(k => k.type === type);
  }

  /**
   * Get knowledge for agent type
   */
  getForAgent(agentType: string): ExtractedKnowledge[] {
    return this.knowledge.filter(k => k.agentType === agentType);
  }

  /**
   * Get high-confidence knowledge
   */
  getHighConfidence(minConfidence = 0.7): ExtractedKnowledge[] {
    return this.knowledge
      .filter(k => k.quality.confidence >= minConfidence)
      .sort((a, b) => b.quality.confidence - a.quality.confidence);
  }

  /**
   * Search knowledge by tags
   */
  searchByTags(tags: string[]): ExtractedKnowledge[] {
    return this.knowledge.filter(k =>
      tags.some(tag => k.tags.includes(tag))
    );
  }

  /**
   * Search knowledge by text
   */
  search(query: string): ExtractedKnowledge[] {
    const lower = query.toLowerCase();

    return this.knowledge.filter(k =>
      k.title.toLowerCase().includes(lower) ||
      k.content.toLowerCase().includes(lower) ||
      k.tags.some(t => t.toLowerCase().includes(lower))
    );
  }

  /**
   * Get summary for agent type
   */
  getSummary(agentType?: string): KnowledgeSummary {
    const entries = agentType
      ? this.getForAgent(agentType)
      : this.knowledge;

    const byType: Record<KnowledgeType, number> = {
      code_pattern: 0,
      test_pattern: 0,
      workflow_pattern: 0,
      domain_insight: 0,
      error_resolution: 0,
      best_practice: 0
    };

    const tagCounts = new Map<string, number>();

    for (const k of entries) {
      byType[k.type]++;

      for (const tag of k.tags) {
        tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
      }
    }

    const topTags = Array.from(tagCounts.entries())
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const avgConfidence = entries.length > 0
      ? entries.reduce((sum, k) => sum + k.quality.confidence, 0) / entries.length
      : 0;

    return {
      agentType: agentType || 'all',
      totalKnowledge: entries.length,
      byType,
      topTags,
      avgConfidence
    };
  }

  /**
   * Generate knowledge summary for agent prompt
   */
  generatePromptAdditions(agentType: string): string {
    const knowledge = this.getForAgent(agentType)
      .filter(k => k.quality.confidence >= 0.6)
      .slice(0, 20);

    if (knowledge.length === 0) return '';

    const sections: string[] = ['## Learned Domain Knowledge\n'];

    // Group by type
    const byType = new Map<KnowledgeType, ExtractedKnowledge[]>();
    for (const k of knowledge) {
      if (!byType.has(k.type)) {
        byType.set(k.type, []);
      }
      byType.get(k.type)!.push(k);
    }

    for (const [type, entries] of byType) {
      sections.push(`\n### ${type.replace('_', ' ').toUpperCase()}:`);
      for (const k of entries.slice(0, 5)) {
        sections.push(`- **${k.title}**: ${k.content.slice(0, 100)}${k.content.length > 100 ? '...' : ''}`);
      }
    }

    return sections.join('\n');
  }

  /**
   * Export knowledge
   */
  exportData(): ExtractedKnowledge[] {
    return [...this.knowledge];
  }

  /**
   * Import knowledge
   */
  importData(knowledge: ExtractedKnowledge[]): void {
    for (const k of knowledge) {
      if (!this.knowledgeExists(k.title)) {
        this.knowledge.push(k);
      }
    }

    if (this.knowledge.length > this.maxEntries) {
      this.knowledge = this.knowledge.slice(-this.maxEntries);
    }
  }

  /**
   * Clear knowledge
   */
  clear(): void {
    this.knowledge = [];
    console.log('[KnowledgeExtractor] Cleared all knowledge');
  }

  /**
   * Get statistics
   */
  getStats(): {
    total: number;
    byType: Record<KnowledgeType, number>;
    byAgent: Record<string, number>;
    highConfidence: number;
    avgConfidence: number;
  } {
    const byType: Record<KnowledgeType, number> = {
      code_pattern: 0,
      test_pattern: 0,
      workflow_pattern: 0,
      domain_insight: 0,
      error_resolution: 0,
      best_practice: 0
    };

    const byAgent: Record<string, number> = {};

    for (const k of this.knowledge) {
      byType[k.type]++;
      byAgent[k.agentType] = (byAgent[k.agentType] || 0) + 1;
    }

    const avgConfidence = this.knowledge.length > 0
      ? this.knowledge.reduce((sum, k) => sum + k.quality.confidence, 0) / this.knowledge.length
      : 0;

    return {
      total: this.knowledge.length,
      byType,
      byAgent,
      highConfidence: this.knowledge.filter(k => k.quality.confidence >= 0.7).length,
      avgConfidence
    };
  }
}

// Export singleton
export const KnowledgeExtractor = new KnowledgeExtractorClass();

// Export class for testing
export { KnowledgeExtractorClass };
