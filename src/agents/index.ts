/**
 * Agents Module - Multi-agent coordination for AgentOS
 *
 * Components:
 * - AgentPoolManager: Pool lifecycle and scaling
 * - TaskCoordinator: Parallel execution and synchronization
 * - HandoffMachine: Agent-to-agent transitions
 */

// Pool Manager
export {
  AgentPoolManager,
  AgentPoolManagerClass,
  type AgentStatus,
  type PoolConfig,
  type PoolAgent,
  type PoolStatus,
  type HealthStatus
} from './pool-manager.js';

// Task Coordinator
export {
  TaskCoordinator,
  TaskCoordinatorClass,
  type Task,
  type TaskResult,
  type AggregatedResult,
  type Barrier
} from './coordinator.js';

// Handoff Machine
export {
  HandoffMachine,
  HandoffMachineClass,
  type HandoffType,
  type HandoffState,
  type HandoffContext,
  type Handoff,
  type ValidationResult
} from './handoff-machine.js';

/**
 * Initialize agent infrastructure
 */
export function initAgents(): void {
  console.log('[Agents] Infrastructure initialized');
}

/**
 * Create a standard SWE pool
 */
export function createSWEPool(options?: {
  minAgents?: number;
  maxAgents?: number;
  autoScale?: boolean;
}): void {
  const { AgentPoolManager } = require('./pool-manager.js');

  AgentPoolManager.createPool({
    id: 'swe-pool',
    type: 'swe',
    minAgents: options?.minAgents ?? 1,
    maxAgents: options?.maxAgents ?? 5,
    autoScale: options?.autoScale ?? true,
    loadBalancing: 'round-robin',
    capabilities: ['implement-feature', 'refactor', 'fix-bug', 'write-tests']
  });
}

/**
 * Execute tasks in parallel with synchronization
 */
export async function executeParallelTasks(
  poolId: string,
  tasks: Array<{
    capability: string;
    data: unknown;
    priority?: number;
  }>
): Promise<import('./coordinator.js').AggregatedResult> {
  const { TaskCoordinator } = await import('./coordinator.js');

  const taskDefs = tasks.map((t, idx) => ({
    id: `task-${Date.now()}-${idx}`,
    poolId,
    capability: t.capability,
    data: t.data,
    priority: t.priority ?? 0
  }));

  await TaskCoordinator.executeParallel(taskDefs);

  return TaskCoordinator.aggregateResults(taskDefs.map(t => t.id));
}

/**
 * Perform an agent handoff
 */
export function handoff(
  type: import('./handoff-machine.js').HandoffType,
  fromAgent: string,
  toAgent: string,
  context: {
    workflowId: string;
    taskId: string;
    data: unknown;
    notes?: string;
  }
): import('./handoff-machine.js').Handoff | null {
  const { HandoffMachine } = require('./handoff-machine.js');

  return HandoffMachine.initiate(type, fromAgent, toAgent, {
    workflowId: context.workflowId,
    taskId: context.taskId,
    data: context.data,
    previousDecisions: [],
    artifacts: [],
    notes: context.notes ?? ''
  });
}

/**
 * Get overall agent system status
 */
export function getAgentSystemStatus(): {
  pools: import('./pool-manager.js').PoolStatus[];
  activeHandoffs: number;
  pendingTasks: number;
} {
  const { AgentPoolManager } = require('./pool-manager.js');
  const { HandoffMachine } = require('./handoff-machine.js');

  const pools = AgentPoolManager.getPoolStatus();
  const handoffStats = HandoffMachine.getStats();

  return {
    pools,
    activeHandoffs: handoffStats.byState['in-progress'] || 0,
    pendingTasks: pools.reduce((sum, p) => sum + p.queuedTasks, 0)
  };
}
