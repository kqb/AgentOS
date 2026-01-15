/**
 * FeedbackCollector - Automatic feedback collection from workflow events
 *
 * Listens to EventBus for signals and collects:
 * - Workflow transitions (success/failure)
 * - Agent errors
 * - Test results
 * - PR feedback
 * - Build results
 */

import { EventBus } from '../core/event-bus.js';

/** Feedback entry */
export interface FeedbackEntry {
  id: string;
  timestamp: number;
  type: 'workflow' | 'agent' | 'test' | 'pr' | 'build' | 'human';
  agentId?: string;
  agentType?: string;
  taskId?: string;
  outcome: 'success' | 'failure' | 'partial';
  context: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

/** Agent performance stats */
export interface AgentStats {
  agentType: string;
  totalTasks: number;
  successCount: number;
  failureCount: number;
  partialCount: number;
  successRate: number;
  averageDuration: number;
  lastUpdated: number;
}

/** Feedback collector singleton */
class FeedbackCollectorClass {
  private feedback: FeedbackEntry[] = [];
  private agentStats: Map<string, AgentStats> = new Map();
  private isListening = false;
  private maxEntries = 10000;

  /**
   * Start listening for events
   */
  startListening(): void {
    if (this.isListening) return;

    // Workflow transitions
    EventBus.on('workflow:transition', (data) => {
      this.collectWorkflowFeedback(data);
    });

    // Workflow completion
    EventBus.on('workflow:complete', (data) => {
      this.collectWorkflowComplete(data);
    });

    // Agent errors
    EventBus.on('agent:error', (data) => {
      this.collectAgentError(data);
    });

    // Agent task completion
    EventBus.on('agent:task:complete', (data) => {
      this.collectAgentTaskComplete(data);
    });

    // Test results
    EventBus.on('tests:result', (data) => {
      this.collectTestResult(data);
    });

    // PR feedback
    EventBus.on('pr:feedback', (data) => {
      this.collectPRFeedback(data);
    });

    // Build results
    EventBus.on('build:result', (data) => {
      this.collectBuildResult(data);
    });

    this.isListening = true;
    console.log('[FeedbackCollector] Started listening for events');
  }

  /**
   * Stop listening for events
   */
  stopListening(): void {
    this.isListening = false;
    console.log('[FeedbackCollector] Stopped listening');
  }

  /**
   * Generate unique ID
   */
  private generateId(): string {
    return `fb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  /**
   * Add feedback entry
   */
  private addEntry(entry: Omit<FeedbackEntry, 'id' | 'timestamp'>): FeedbackEntry {
    const fullEntry: FeedbackEntry = {
      ...entry,
      id: this.generateId(),
      timestamp: Date.now()
    };

    this.feedback.push(fullEntry);

    // Update agent stats
    if (entry.agentType) {
      this.updateAgentStats(entry.agentType, entry.outcome);
    }

    // Trim old entries if over limit
    if (this.feedback.length > this.maxEntries) {
      this.feedback = this.feedback.slice(-this.maxEntries);
    }

    // Emit event for real-time monitoring
    EventBus.emit('feedback:collected', fullEntry);

    return fullEntry;
  }

  /**
   * Update agent statistics
   */
  private updateAgentStats(agentType: string, outcome: FeedbackEntry['outcome']): void {
    let stats = this.agentStats.get(agentType);

    if (!stats) {
      stats = {
        agentType,
        totalTasks: 0,
        successCount: 0,
        failureCount: 0,
        partialCount: 0,
        successRate: 0,
        averageDuration: 0,
        lastUpdated: Date.now()
      };
    }

    stats.totalTasks++;

    switch (outcome) {
      case 'success':
        stats.successCount++;
        break;
      case 'failure':
        stats.failureCount++;
        break;
      case 'partial':
        stats.partialCount++;
        break;
    }

    stats.successRate = stats.successCount / stats.totalTasks;
    stats.lastUpdated = Date.now();

    this.agentStats.set(agentType, stats);
  }

  /**
   * Collect workflow transition feedback
   */
  private collectWorkflowFeedback(data: {
    workflowId?: string;
    from?: string;
    to?: string;
    success?: boolean;
    agentId?: string;
    agentType?: string;
  }): void {
    const failureStates = ['FAILED', 'BLOCKED', 'CANCELLED'];
    const outcome = data.to && failureStates.includes(data.to) ? 'failure' : 'success';

    this.addEntry({
      type: 'workflow',
      agentId: data.agentId,
      agentType: data.agentType,
      taskId: data.workflowId,
      outcome,
      context: {
        from: data.from,
        to: data.to,
        transition: `${data.from} -> ${data.to}`
      }
    });
  }

  /**
   * Collect workflow completion feedback
   */
  private collectWorkflowComplete(data: {
    workflowId?: string;
    success?: boolean;
    duration?: number;
    agentType?: string;
  }): void {
    this.addEntry({
      type: 'workflow',
      agentType: data.agentType,
      taskId: data.workflowId,
      outcome: data.success ? 'success' : 'failure',
      context: {
        event: 'workflow:complete',
        duration: data.duration
      }
    });
  }

  /**
   * Collect agent error
   */
  private collectAgentError(data: {
    agentId?: string;
    agentType?: string;
    error?: string;
    taskId?: string;
    recoverable?: boolean;
  }): void {
    this.addEntry({
      type: 'agent',
      agentId: data.agentId,
      agentType: data.agentType,
      taskId: data.taskId,
      outcome: 'failure',
      context: {
        error: data.error,
        recoverable: data.recoverable
      }
    });
  }

  /**
   * Collect agent task completion
   */
  private collectAgentTaskComplete(data: {
    agentId?: string;
    agentType?: string;
    taskId?: string;
    success?: boolean;
    duration?: number;
    output?: unknown;
  }): void {
    this.addEntry({
      type: 'agent',
      agentId: data.agentId,
      agentType: data.agentType,
      taskId: data.taskId,
      outcome: data.success ? 'success' : 'failure',
      context: {
        duration: data.duration,
        hasOutput: !!data.output
      }
    });
  }

  /**
   * Collect test result
   */
  private collectTestResult(data: {
    agentId?: string;
    agentType?: string;
    passed?: number;
    failed?: number;
    skipped?: number;
    coverage?: number;
  }): void {
    const total = (data.passed || 0) + (data.failed || 0);
    const passRate = total > 0 ? (data.passed || 0) / total : 0;

    let outcome: FeedbackEntry['outcome'] = 'success';
    if (data.failed && data.failed > 0) {
      outcome = passRate > 0.8 ? 'partial' : 'failure';
    }

    this.addEntry({
      type: 'test',
      agentId: data.agentId,
      agentType: data.agentType || 'qa-engineer',
      outcome,
      context: {
        passed: data.passed,
        failed: data.failed,
        skipped: data.skipped,
        coverage: data.coverage,
        passRate
      }
    });
  }

  /**
   * Collect PR feedback
   */
  private collectPRFeedback(data: {
    agentId?: string;
    agentType?: string;
    prId?: string;
    action?: 'approved' | 'changes_requested' | 'commented' | 'merged';
    reviewer?: string;
  }): void {
    let outcome: FeedbackEntry['outcome'] = 'success';
    if (data.action === 'changes_requested') {
      outcome = 'partial';
    }

    this.addEntry({
      type: 'pr',
      agentId: data.agentId,
      agentType: data.agentType || 'code-generator',
      outcome,
      context: {
        prId: data.prId,
        action: data.action,
        reviewer: data.reviewer
      }
    });
  }

  /**
   * Collect build result
   */
  private collectBuildResult(data: {
    agentId?: string;
    agentType?: string;
    buildId?: string;
    success?: boolean;
    duration?: number;
    errors?: string[];
  }): void {
    this.addEntry({
      type: 'build',
      agentId: data.agentId,
      agentType: data.agentType,
      outcome: data.success ? 'success' : 'failure',
      context: {
        buildId: data.buildId,
        duration: data.duration,
        errorCount: data.errors?.length || 0,
        errors: data.errors?.slice(0, 5) // Keep first 5 errors
      }
    });
  }

  /**
   * Add human feedback
   */
  addHumanFeedback(
    agentId: string,
    agentType: string,
    outcome: 'success' | 'failure' | 'partial',
    context: Record<string, unknown>
  ): FeedbackEntry {
    return this.addEntry({
      type: 'human',
      agentId,
      agentType,
      outcome,
      context
    });
  }

  /**
   * Get success rate for agent type
   */
  getSuccessRate(agentType: string): number {
    const stats = this.agentStats.get(agentType);
    return stats?.successRate || 0;
  }

  /**
   * Get all agent stats
   */
  getAllStats(): AgentStats[] {
    return Array.from(this.agentStats.values());
  }

  /**
   * Get feedback by type
   */
  getFeedbackByType(type: FeedbackEntry['type'], limit = 100): FeedbackEntry[] {
    return this.feedback
      .filter(f => f.type === type)
      .slice(-limit);
  }

  /**
   * Get feedback by agent
   */
  getFeedbackByAgent(agentType: string, limit = 100): FeedbackEntry[] {
    return this.feedback
      .filter(f => f.agentType === agentType)
      .slice(-limit);
  }

  /**
   * Get recent feedback
   */
  getRecentFeedback(limit = 100): FeedbackEntry[] {
    return this.feedback.slice(-limit);
  }

  /**
   * Get feedback since timestamp
   */
  getFeedbackSince(timestamp: number): FeedbackEntry[] {
    return this.feedback.filter(f => f.timestamp >= timestamp);
  }

  /**
   * Get failure feedback
   */
  getFailures(limit = 100): FeedbackEntry[] {
    return this.feedback
      .filter(f => f.outcome === 'failure')
      .slice(-limit);
  }

  /**
   * Export feedback data
   */
  exportData(): {
    feedback: FeedbackEntry[];
    stats: AgentStats[];
    exportedAt: number;
  } {
    return {
      feedback: this.feedback,
      stats: this.getAllStats(),
      exportedAt: Date.now()
    };
  }

  /**
   * Import feedback data
   */
  importData(data: {
    feedback?: FeedbackEntry[];
    stats?: AgentStats[];
  }): void {
    if (data.feedback) {
      this.feedback = [...this.feedback, ...data.feedback];
    }

    if (data.stats) {
      for (const stat of data.stats) {
        const existing = this.agentStats.get(stat.agentType);
        if (existing) {
          // Merge stats
          existing.totalTasks += stat.totalTasks;
          existing.successCount += stat.successCount;
          existing.failureCount += stat.failureCount;
          existing.partialCount += stat.partialCount;
          existing.successRate = existing.successCount / existing.totalTasks;
        } else {
          this.agentStats.set(stat.agentType, stat);
        }
      }
    }
  }

  /**
   * Clear all feedback
   */
  clear(): void {
    this.feedback = [];
    this.agentStats.clear();
    console.log('[FeedbackCollector] Cleared all feedback');
  }
}

// Export singleton
export const FeedbackCollector = new FeedbackCollectorClass();

// Export class for testing
export { FeedbackCollectorClass };
