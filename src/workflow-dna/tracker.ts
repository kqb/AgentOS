/**
 * Workflow Tracker
 *
 * Tracks workflow execution for DNA extraction:
 * - State transitions
 * - Agent actions
 * - Human interventions
 * - Timing metrics
 */

import { EventBus } from '../core/event-bus.js';
import { StateManager } from '../core/state-manager.js';
import type { WorkflowState, StateTransition } from '../types/workflow.js';

/** Tracked action */
export interface TrackedAction {
  type: 'transition' | 'agent_action' | 'human_intervention' | 'error' | 'signal';
  timestamp: number;
  data: Record<string, unknown>;
}

/** Workflow session */
export interface WorkflowSession {
  id: string;
  workflowName: string;
  startTime: number;
  endTime?: number;
  initialState: WorkflowState;
  currentState: WorkflowState;
  finalState?: WorkflowState;
  actions: TrackedAction[];
  success?: boolean;
  metadata: Record<string, unknown>;
}

/**
 * Workflow Tracker class
 */
class WorkflowTrackerClass {
  private currentSession: WorkflowSession | null = null;
  private sessions: WorkflowSession[] = [];
  private tracking = false;
  private maxStoredSessions = 50;

  /**
   * Start tracking a new workflow session
   */
  startSession(
    workflowName: string,
    initialState: WorkflowState,
    metadata: Record<string, unknown> = {}
  ): string {
    const id = `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    this.currentSession = {
      id,
      workflowName,
      startTime: Date.now(),
      initialState,
      currentState: initialState,
      actions: [],
      metadata
    };

    this.tracking = true;

    // Set up event listeners
    this.setupListeners();

    EventBus.emit('tracker:session:started', { id, workflowName, initialState });

    return id;
  }

  /**
   * End the current session
   */
  endSession(success: boolean, finalState?: WorkflowState): WorkflowSession | null {
    if (!this.currentSession) return null;

    this.currentSession.endTime = Date.now();
    this.currentSession.success = success;
    this.currentSession.finalState = finalState || this.currentSession.currentState;

    const session = { ...this.currentSession };

    // Store session
    this.sessions.push(session);
    if (this.sessions.length > this.maxStoredSessions) {
      this.sessions.shift();
    }

    // Persist to state
    this.persistSessions();

    // Clean up
    this.removeListeners();
    this.currentSession = null;
    this.tracking = false;

    EventBus.emit('tracker:session:ended', {
      id: session.id,
      success,
      duration: session.endTime! - session.startTime,
      actionCount: session.actions.length
    });

    return session;
  }

  /**
   * Record a state transition
   */
  recordTransition(transition: StateTransition): void {
    if (!this.tracking || !this.currentSession) return;

    this.currentSession.actions.push({
      type: 'transition',
      timestamp: Date.now(),
      data: {
        from: transition.from,
        to: transition.to,
        trigger: transition.trigger,
        conditions: transition.conditions
      }
    });

    this.currentSession.currentState = transition.to;

    EventBus.emit('tracker:transition:recorded', { transition });
  }

  /**
   * Record an agent action
   */
  recordAgentAction(
    agentId: string,
    action: string,
    details: Record<string, unknown> = {}
  ): void {
    if (!this.tracking || !this.currentSession) return;

    this.currentSession.actions.push({
      type: 'agent_action',
      timestamp: Date.now(),
      data: {
        agentId,
        action,
        ...details
      }
    });

    EventBus.emit('tracker:agent:recorded', { agentId, action });
  }

  /**
   * Record a human intervention
   */
  recordIntervention(
    interventionType: string,
    description: string,
    atState?: WorkflowState
  ): void {
    if (!this.tracking || !this.currentSession) return;

    this.currentSession.actions.push({
      type: 'human_intervention',
      timestamp: Date.now(),
      data: {
        interventionType,
        description,
        atState: atState || this.currentSession.currentState
      }
    });

    EventBus.emit('tracker:intervention:recorded', { interventionType, description });
  }

  /**
   * Record an error
   */
  recordError(error: string, context: Record<string, unknown> = {}): void {
    if (!this.tracking || !this.currentSession) return;

    this.currentSession.actions.push({
      type: 'error',
      timestamp: Date.now(),
      data: {
        error,
        atState: this.currentSession.currentState,
        ...context
      }
    });

    EventBus.emit('tracker:error:recorded', { error });
  }

  /**
   * Record a signal
   */
  recordSignal(signalType: string, payload: Record<string, unknown> = {}): void {
    if (!this.tracking || !this.currentSession) return;

    this.currentSession.actions.push({
      type: 'signal',
      timestamp: Date.now(),
      data: {
        signalType,
        atState: this.currentSession.currentState,
        ...payload
      }
    });
  }

  /**
   * Set up event listeners for automatic tracking
   */
  private setupListeners(): void {
    // Listen for signals
    EventBus.on('signal:any', (signal) => {
      const s = signal as { type: string; payload: Record<string, unknown> };
      this.recordSignal(s.type, s.payload);
    });

    // Listen for agent events
    EventBus.on('agent:action', (event) => {
      const e = event as { agentId: string; action: string };
      this.recordAgentAction(e.agentId, e.action);
    });
  }

  /**
   * Remove event listeners
   */
  private removeListeners(): void {
    EventBus.off('signal:any');
    EventBus.off('agent:action');
  }

  /**
   * Persist sessions to state
   */
  private persistSessions(): void {
    StateManager.set('tracker', 'sessions', this.sessions);
  }

  /**
   * Load sessions from state
   */
  loadSessions(): void {
    const stored = StateManager.get<WorkflowSession[]>('tracker', 'sessions');
    if (stored) {
      this.sessions = stored;
    }
  }

  /**
   * Get current session
   */
  getCurrentSession(): WorkflowSession | null {
    return this.currentSession ? { ...this.currentSession } : null;
  }

  /**
   * Get all sessions
   */
  getSessions(): WorkflowSession[] {
    return [...this.sessions];
  }

  /**
   * Get sessions by workflow name
   */
  getSessionsByWorkflow(workflowName: string): WorkflowSession[] {
    return this.sessions.filter(s => s.workflowName === workflowName);
  }

  /**
   * Get successful sessions
   */
  getSuccessfulSessions(): WorkflowSession[] {
    return this.sessions.filter(s => s.success === true);
  }

  /**
   * Check if currently tracking
   */
  isTracking(): boolean {
    return this.tracking;
  }

  /**
   * Get tracking statistics
   */
  getStats(): {
    totalSessions: number;
    successfulSessions: number;
    averageDuration: number;
    averageActions: number;
    interventionRate: number;
  } {
    const completedSessions = this.sessions.filter(s => s.endTime);
    const successfulSessions = completedSessions.filter(s => s.success);

    const totalDuration = completedSessions.reduce(
      (sum, s) => sum + (s.endTime! - s.startTime),
      0
    );

    const totalActions = this.sessions.reduce(
      (sum, s) => sum + s.actions.length,
      0
    );

    const interventions = this.sessions.reduce(
      (sum, s) => sum + s.actions.filter(a => a.type === 'human_intervention').length,
      0
    );

    return {
      totalSessions: this.sessions.length,
      successfulSessions: successfulSessions.length,
      averageDuration: completedSessions.length > 0 ? totalDuration / completedSessions.length : 0,
      averageActions: this.sessions.length > 0 ? totalActions / this.sessions.length : 0,
      interventionRate: totalActions > 0 ? interventions / totalActions : 0
    };
  }

  /**
   * Clear all sessions
   */
  clear(): void {
    this.sessions = [];
    StateManager.remove('tracker', 'sessions');
    EventBus.emit('tracker:cleared', {});
  }
}

// Export singleton instance
export const WorkflowTracker = new WorkflowTrackerClass();

// Also export the class for testing
export { WorkflowTrackerClass };
