/**
 * TaskCoordinator - Task distribution and synchronization
 *
 * Coordinates multi-agent task execution with:
 * - Parallel execution
 * - Result aggregation
 * - Synchronization barriers
 * - Dependency management
 */

import { EventBus } from '../core/event-bus.js';
import { AgentPoolManager, PoolAgent } from './pool-manager.js';

/** Task definition */
export interface Task {
  id: string;
  poolId: string;
  capability: string;
  data: unknown;
  priority?: number;
  dependencies?: string[];
  timeout?: number;
}

/** Task result */
export interface TaskResult {
  taskId: string;
  agentId: string;
  success: boolean;
  data: unknown;
  error?: string;
  duration: number;
  completedAt: number;
}

/** Aggregated result */
export interface AggregatedResult {
  taskIds: string[];
  successful: TaskResult[];
  failed: TaskResult[];
  totalDuration: number;
  overallSuccess: boolean;
}

/** Barrier for synchronization */
export interface Barrier {
  id: string;
  taskIds: string[];
  pending: Set<string>;
  resolved: boolean;
  promise: Promise<void>;
  resolve: () => void;
}

/** Task execution state */
interface TaskExecution {
  task: Task;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'timeout';
  agentId: string | null;
  result: TaskResult | null;
  startedAt: number | null;
}

/** Coordinator singleton */
class TaskCoordinatorClass {
  private executions: Map<string, TaskExecution> = new Map();
  private barriers: Map<string, Barrier> = new Map();
  private pendingDependencies: Map<string, Set<string>> = new Map();

  /**
   * Execute a single task
   */
  async execute(task: Task): Promise<TaskResult> {
    // Check dependencies
    if (task.dependencies && task.dependencies.length > 0) {
      const unmet = task.dependencies.filter(depId => {
        const dep = this.executions.get(depId);
        return !dep || dep.status !== 'completed';
      });

      if (unmet.length > 0) {
        // Queue for later when dependencies complete
        this.pendingDependencies.set(task.id, new Set(unmet));
        this.executions.set(task.id, {
          task,
          status: 'pending',
          agentId: null,
          result: null,
          startedAt: null
        });

        return new Promise((resolve, reject) => {
          const checkDeps = () => {
            const pending = this.pendingDependencies.get(task.id);
            if (!pending || pending.size === 0) {
              this.executeTask(task).then(resolve).catch(reject);
            }
          };

          // Listen for dependency completions
          for (const depId of unmet) {
            EventBus.once(`task:${depId}:completed`, () => {
              const pending = this.pendingDependencies.get(task.id);
              if (pending) {
                pending.delete(depId);
                checkDeps();
              }
            });
          }
        });
      }
    }

    return this.executeTask(task);
  }

  /**
   * Execute task (internal)
   */
  private async executeTask(task: Task): Promise<TaskResult> {
    const startTime = Date.now();

    const execution: TaskExecution = {
      task,
      status: 'running',
      agentId: null,
      result: null,
      startedAt: startTime
    };

    this.executions.set(task.id, execution);

    // Queue task to pool
    const queued = AgentPoolManager.queueTask(
      task.poolId,
      task.id,
      task.capability,
      task.data,
      task.priority ?? 0
    );

    if (!queued) {
      const result: TaskResult = {
        taskId: task.id,
        agentId: '',
        success: false,
        data: null,
        error: 'Failed to queue task',
        duration: 0,
        completedAt: Date.now()
      };

      execution.status = 'failed';
      execution.result = result;

      return result;
    }

    // Wait for completion
    return new Promise((resolve, reject) => {
      let timeoutId: ReturnType<typeof setTimeout> | null = null;

      const cleanup = () => {
        if (timeoutId) clearTimeout(timeoutId);
      };

      // Listen for task completion
      const unsubscribe = EventBus.on('pool:task:completed', (event: unknown) => {
        const { taskId, agentId, success } = event as {
          taskId: string;
          agentId: string;
          success: boolean;
        };

        if (taskId === task.id) {
          cleanup();
          unsubscribe();

          const result: TaskResult = {
            taskId,
            agentId,
            success,
            data: execution.task.data,
            duration: Date.now() - startTime,
            completedAt: Date.now()
          };

          execution.status = success ? 'completed' : 'failed';
          execution.agentId = agentId;
          execution.result = result;

          EventBus.emit(`task:${taskId}:completed`, result);

          resolve(result);
        }
      });

      // Set timeout if specified
      if (task.timeout && task.timeout > 0) {
        timeoutId = setTimeout(() => {
          unsubscribe();

          const result: TaskResult = {
            taskId: task.id,
            agentId: execution.agentId || '',
            success: false,
            data: null,
            error: 'Task timeout',
            duration: task.timeout!,
            completedAt: Date.now()
          };

          execution.status = 'timeout';
          execution.result = result;

          reject(new Error('Task timeout'));
        }, task.timeout);
      }
    });
  }

  /**
   * Execute multiple tasks in parallel
   */
  async executeParallel(tasks: Task[]): Promise<TaskResult[]> {
    const promises = tasks.map(task => this.execute(task));
    return Promise.all(promises);
  }

  /**
   * Wait for all specified tasks to complete
   */
  async waitForAll(taskIds: string[]): Promise<void> {
    const pending = taskIds.filter(id => {
      const exec = this.executions.get(id);
      return !exec || exec.status === 'pending' || exec.status === 'running';
    });

    if (pending.length === 0) return;

    const promises = pending.map(taskId =>
      new Promise<void>(resolve => {
        const exec = this.executions.get(taskId);
        if (exec && (exec.status === 'completed' || exec.status === 'failed')) {
          resolve();
          return;
        }

        EventBus.once(`task:${taskId}:completed`, () => resolve());
      })
    );

    await Promise.all(promises);
  }

  /**
   * Wait for any of the specified tasks to complete
   */
  async waitForAny(taskIds: string[]): Promise<TaskResult> {
    return new Promise(resolve => {
      // Check if any already completed
      for (const taskId of taskIds) {
        const exec = this.executions.get(taskId);
        if (exec && exec.result && (exec.status === 'completed' || exec.status === 'failed')) {
          resolve(exec.result);
          return;
        }
      }

      // Wait for first completion
      const unsubscribes: Array<() => void> = [];

      for (const taskId of taskIds) {
        const unsub = EventBus.on(`task:${taskId}:completed`, (result: unknown) => {
          unsubscribes.forEach(u => u());
          resolve(result as TaskResult);
        });
        unsubscribes.push(unsub);
      }
    });
  }

  /**
   * Create a synchronization barrier
   */
  createBarrier(taskIds: string[]): Barrier {
    const barrierId = `barrier-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    let resolveBarrier: () => void;
    const promise = new Promise<void>(resolve => {
      resolveBarrier = resolve;
    });

    const barrier: Barrier = {
      id: barrierId,
      taskIds,
      pending: new Set(taskIds),
      resolved: false,
      promise,
      resolve: resolveBarrier!
    };

    this.barriers.set(barrierId, barrier);

    // Listen for task completions
    for (const taskId of taskIds) {
      EventBus.once(`task:${taskId}:completed`, () => {
        barrier.pending.delete(taskId);

        if (barrier.pending.size === 0 && !barrier.resolved) {
          barrier.resolved = true;
          barrier.resolve();
          EventBus.emit('barrier:resolved', { barrierId });
        }
      });
    }

    // Check if any already completed
    for (const taskId of taskIds) {
      const exec = this.executions.get(taskId);
      if (exec && (exec.status === 'completed' || exec.status === 'failed')) {
        barrier.pending.delete(taskId);
      }
    }

    if (barrier.pending.size === 0) {
      barrier.resolved = true;
      barrier.resolve();
    }

    return barrier;
  }

  /**
   * Aggregate results from multiple tasks
   */
  aggregateResults(taskIds: string[]): AggregatedResult {
    const successful: TaskResult[] = [];
    const failed: TaskResult[] = [];
    let totalDuration = 0;

    for (const taskId of taskIds) {
      const exec = this.executions.get(taskId);
      if (exec?.result) {
        if (exec.result.success) {
          successful.push(exec.result);
        } else {
          failed.push(exec.result);
        }
        totalDuration += exec.result.duration;
      }
    }

    return {
      taskIds,
      successful,
      failed,
      totalDuration,
      overallSuccess: failed.length === 0
    };
  }

  /**
   * Get task execution status
   */
  getTaskStatus(taskId: string): TaskExecution | undefined {
    return this.executions.get(taskId);
  }

  /**
   * Get all task executions
   */
  getAllExecutions(): Map<string, TaskExecution> {
    return new Map(this.executions);
  }

  /**
   * Cancel a pending or running task
   */
  cancelTask(taskId: string): boolean {
    const exec = this.executions.get(taskId);
    if (!exec) return false;

    if (exec.status === 'pending' || exec.status === 'running') {
      exec.status = 'failed';
      exec.result = {
        taskId,
        agentId: exec.agentId || '',
        success: false,
        data: null,
        error: 'Task cancelled',
        duration: exec.startedAt ? Date.now() - exec.startedAt : 0,
        completedAt: Date.now()
      };

      EventBus.emit(`task:${taskId}:completed`, exec.result);
      return true;
    }

    return false;
  }

  /**
   * Clear all executions
   */
  clear(): void {
    this.executions.clear();
    this.barriers.clear();
    this.pendingDependencies.clear();
  }
}

// Export singleton
export const TaskCoordinator = new TaskCoordinatorClass();

// Export class for testing
export { TaskCoordinatorClass };
