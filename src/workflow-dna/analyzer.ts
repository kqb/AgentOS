/**
 * Workflow Analyzer
 *
 * Analyzes tracked workflow sessions to identify:
 * - Common patterns
 * - Bottlenecks
 * - Optimization opportunities
 * - Success factors
 */

import { EventBus } from '../core/event-bus.js';
import { StateManager } from '../core/state-manager.js';
import type { WorkflowState } from '../types/workflow.js';
import type { WorkflowSession, TrackedAction } from './tracker.js';

/** State timing analysis */
export interface StateTimingAnalysis {
  state: WorkflowState;
  averageTime: number;
  minTime: number;
  maxTime: number;
  frequency: number;
}

/** Bottleneck analysis */
export interface BottleneckAnalysis {
  state: WorkflowState;
  severity: 'low' | 'medium' | 'high';
  averageTime: number;
  interventionRate: number;
  errorRate: number;
  suggestion: string;
}

/** Pattern analysis */
export interface PatternAnalysis {
  pattern: string;
  frequency: number;
  successRate: number;
  averageDuration: number;
  interventions: number;
}

/** Analysis report */
export interface AnalysisReport {
  generatedAt: number;
  sessionCount: number;
  overallSuccessRate: number;
  stateTimings: StateTimingAnalysis[];
  bottlenecks: BottleneckAnalysis[];
  patterns: PatternAnalysis[];
  recommendations: string[];
}

/**
 * Workflow Analyzer class
 */
class WorkflowAnalyzerClass {
  private lastReport: AnalysisReport | null = null;

  /**
   * Analyze a set of workflow sessions
   */
  analyze(sessions: WorkflowSession[]): AnalysisReport {
    const completedSessions = sessions.filter(s => s.endTime && s.finalState);

    if (completedSessions.length === 0) {
      return this.createEmptyReport();
    }

    const report: AnalysisReport = {
      generatedAt: Date.now(),
      sessionCount: completedSessions.length,
      overallSuccessRate: this.calculateSuccessRate(completedSessions),
      stateTimings: this.analyzeStateTimings(completedSessions),
      bottlenecks: this.analyzeBottlenecks(completedSessions),
      patterns: this.analyzePatterns(completedSessions),
      recommendations: []
    };

    // Generate recommendations based on analysis
    report.recommendations = this.generateRecommendations(report);

    // Cache report
    this.lastReport = report;
    StateManager.set('analyzer', 'lastReport', report);

    EventBus.emit('analyzer:report:generated', { sessionCount: report.sessionCount });

    return report;
  }

  /**
   * Calculate overall success rate
   */
  private calculateSuccessRate(sessions: WorkflowSession[]): number {
    const successful = sessions.filter(s => s.success).length;
    return sessions.length > 0 ? successful / sessions.length : 0;
  }

  /**
   * Analyze time spent in each state
   */
  private analyzeStateTimings(sessions: WorkflowSession[]): StateTimingAnalysis[] {
    const stateTimings: Map<WorkflowState, number[]> = new Map();

    for (const session of sessions) {
      const transitions = session.actions.filter(a => a.type === 'transition');

      for (let i = 0; i < transitions.length - 1; i++) {
        const current = transitions[i];
        const next = transitions[i + 1];
        const state = current.data.to as WorkflowState;
        const duration = next.timestamp - current.timestamp;

        const times = stateTimings.get(state) || [];
        times.push(duration);
        stateTimings.set(state, times);
      }
    }

    return Array.from(stateTimings.entries()).map(([state, times]) => ({
      state,
      averageTime: times.reduce((a, b) => a + b, 0) / times.length,
      minTime: Math.min(...times),
      maxTime: Math.max(...times),
      frequency: times.length
    }));
  }

  /**
   * Identify bottlenecks
   */
  private analyzeBottlenecks(sessions: WorkflowSession[]): BottleneckAnalysis[] {
    const stateStats: Map<WorkflowState, {
      times: number[];
      interventions: number;
      errors: number;
    }> = new Map();

    for (const session of sessions) {
      const actionsByState = this.groupActionsByState(session);

      for (const [state, actions] of actionsByState.entries()) {
        const stats = stateStats.get(state) || { times: [], interventions: 0, errors: 0 };

        // Calculate time in state
        if (actions.length >= 2) {
          const duration = actions[actions.length - 1].timestamp - actions[0].timestamp;
          stats.times.push(duration);
        }

        // Count interventions and errors
        stats.interventions += actions.filter(a => a.type === 'human_intervention').length;
        stats.errors += actions.filter(a => a.type === 'error').length;

        stateStats.set(state, stats);
      }
    }

    const bottlenecks: BottleneckAnalysis[] = [];
    const overallAvgTime = this.calculateOverallAverageTime(stateStats);

    for (const [state, stats] of stateStats.entries()) {
      const avgTime = stats.times.length > 0
        ? stats.times.reduce((a, b) => a + b, 0) / stats.times.length
        : 0;

      const interventionRate = stats.times.length > 0
        ? stats.interventions / stats.times.length
        : 0;

      const errorRate = stats.times.length > 0
        ? stats.errors / stats.times.length
        : 0;

      // Determine if this is a bottleneck
      if (avgTime > overallAvgTime * 1.5 || interventionRate > 0.3 || errorRate > 0.2) {
        bottlenecks.push({
          state,
          severity: this.determineSeverity(avgTime, overallAvgTime, interventionRate, errorRate),
          averageTime: avgTime,
          interventionRate,
          errorRate,
          suggestion: this.generateSuggestion(state, avgTime, interventionRate, errorRate)
        });
      }
    }

    return bottlenecks.sort((a, b) => {
      const severityOrder = { high: 0, medium: 1, low: 2 };
      return severityOrder[a.severity] - severityOrder[b.severity];
    });
  }

  /**
   * Group actions by the state they occurred in
   */
  private groupActionsByState(session: WorkflowSession): Map<WorkflowState, TrackedAction[]> {
    const result: Map<WorkflowState, TrackedAction[]> = new Map();
    let currentState = session.initialState;

    for (const action of session.actions) {
      const stateActions = result.get(currentState) || [];
      stateActions.push(action);
      result.set(currentState, stateActions);

      if (action.type === 'transition') {
        currentState = action.data.to as WorkflowState;
      }
    }

    return result;
  }

  /**
   * Calculate overall average time across all states
   */
  private calculateOverallAverageTime(
    stateStats: Map<WorkflowState, { times: number[] }>
  ): number {
    let totalTime = 0;
    let totalCount = 0;

    for (const stats of stateStats.values()) {
      totalTime += stats.times.reduce((a, b) => a + b, 0);
      totalCount += stats.times.length;
    }

    return totalCount > 0 ? totalTime / totalCount : 0;
  }

  /**
   * Determine bottleneck severity
   */
  private determineSeverity(
    avgTime: number,
    overallAvgTime: number,
    interventionRate: number,
    errorRate: number
  ): 'low' | 'medium' | 'high' {
    let score = 0;

    if (avgTime > overallAvgTime * 3) score += 3;
    else if (avgTime > overallAvgTime * 2) score += 2;
    else if (avgTime > overallAvgTime * 1.5) score += 1;

    if (interventionRate > 0.5) score += 3;
    else if (interventionRate > 0.3) score += 2;
    else if (interventionRate > 0.1) score += 1;

    if (errorRate > 0.3) score += 3;
    else if (errorRate > 0.2) score += 2;
    else if (errorRate > 0.1) score += 1;

    if (score >= 6) return 'high';
    if (score >= 3) return 'medium';
    return 'low';
  }

  /**
   * Generate suggestion for bottleneck
   */
  private generateSuggestion(
    state: WorkflowState,
    avgTime: number,
    interventionRate: number,
    errorRate: number
  ): string {
    if (errorRate > 0.2) {
      return `High error rate in ${state}. Review error handling and add validation.`;
    }
    if (interventionRate > 0.3) {
      return `Frequent human intervention in ${state}. Consider automating common corrections.`;
    }
    if (avgTime > 60000) {
      return `Long processing time in ${state}. Consider breaking down into smaller steps.`;
    }
    return `Monitor ${state} for potential improvements.`;
  }

  /**
   * Analyze common patterns
   */
  private analyzePatterns(sessions: WorkflowSession[]): PatternAnalysis[] {
    const patternMap: Map<string, {
      sessions: WorkflowSession[];
      interventions: number;
    }> = new Map();

    for (const session of sessions) {
      const pattern = this.extractPattern(session);
      const entry = patternMap.get(pattern) || { sessions: [], interventions: 0 };

      entry.sessions.push(session);
      entry.interventions += session.actions.filter(
        a => a.type === 'human_intervention'
      ).length;

      patternMap.set(pattern, entry);
    }

    return Array.from(patternMap.entries())
      .filter(([_, data]) => data.sessions.length >= 2)
      .map(([pattern, data]) => ({
        pattern,
        frequency: data.sessions.length,
        successRate: data.sessions.filter(s => s.success).length / data.sessions.length,
        averageDuration: data.sessions.reduce(
          (sum, s) => sum + (s.endTime! - s.startTime),
          0
        ) / data.sessions.length,
        interventions: data.interventions
      }))
      .sort((a, b) => b.frequency - a.frequency);
  }

  /**
   * Extract state sequence pattern from session
   */
  private extractPattern(session: WorkflowSession): string {
    const states: WorkflowState[] = [session.initialState];

    for (const action of session.actions) {
      if (action.type === 'transition') {
        states.push(action.data.to as WorkflowState);
      }
    }

    return states.join(' -> ');
  }

  /**
   * Generate recommendations based on analysis
   */
  private generateRecommendations(report: AnalysisReport): string[] {
    const recommendations: string[] = [];

    // Success rate recommendations
    if (report.overallSuccessRate < 0.7) {
      recommendations.push(
        'Overall success rate is below 70%. Review failure cases for common issues.'
      );
    }

    // Bottleneck recommendations
    const highSeverity = report.bottlenecks.filter(b => b.severity === 'high');
    if (highSeverity.length > 0) {
      recommendations.push(
        `${highSeverity.length} high-severity bottleneck(s) detected. Prioritize: ${
          highSeverity.map(b => b.state).join(', ')
        }`
      );
    }

    // Pattern recommendations
    const lowSuccessPatterns = report.patterns.filter(p => p.successRate < 0.5);
    if (lowSuccessPatterns.length > 0) {
      recommendations.push(
        'Some workflow patterns have low success rates. Consider redesigning these paths.'
      );
    }

    // Intervention recommendations
    const highInterventionPatterns = report.patterns.filter(p =>
      p.interventions / p.frequency > 2
    );
    if (highInterventionPatterns.length > 0) {
      recommendations.push(
        'High intervention rate detected. Train agents on common correction patterns.'
      );
    }

    return recommendations;
  }

  /**
   * Create empty report
   */
  private createEmptyReport(): AnalysisReport {
    return {
      generatedAt: Date.now(),
      sessionCount: 0,
      overallSuccessRate: 0,
      stateTimings: [],
      bottlenecks: [],
      patterns: [],
      recommendations: ['Collect more workflow data to generate meaningful analysis.']
    };
  }

  /**
   * Get last generated report
   */
  getLastReport(): AnalysisReport | null {
    if (!this.lastReport) {
      this.lastReport = StateManager.get<AnalysisReport>('analyzer', 'lastReport');
    }
    return this.lastReport;
  }

  /**
   * Clear cached report
   */
  clearReport(): void {
    this.lastReport = null;
    StateManager.remove('analyzer', 'lastReport');
  }
}

// Export singleton instance
export const WorkflowAnalyzer = new WorkflowAnalyzerClass();

// Also export the class for testing
export { WorkflowAnalyzerClass };
