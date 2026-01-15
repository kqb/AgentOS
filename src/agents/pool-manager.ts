/**
 * AgentPoolManager - Multi-agent pool lifecycle management
 *
 * Manages pools of agents for parallel task execution with:
 * - Auto-scaling based on load
 * - Health monitoring
 * - Load balancing
 * - Task assignment
 */

import { EventBus } from '../core/event-bus.js';

/** Agent status */
export type AgentStatus = 'idle' | 'busy' | 'unhealthy' | 'draining';

/** Pool configuration */
export interface PoolConfig {
  id: string;
  type: string;
  minAgents: number;
  maxAgents: number;
  autoScale: boolean;
  scaleUpThreshold?: number;
  scaleDownThreshold?: number;
  loadBalancing: 'round-robin' | 'least-loaded' | 'capability-match';
  capabilities: string[];
}

/** Agent in pool */
export interface PoolAgent {
  id: string;
  poolId: string;
  status: AgentStatus;
  currentTask: string | null;
  completedTasks: number;
  failedTasks: number;
  lastHealthCheck: number;
  createdAt: number;
}

/** Pool status */
export interface PoolStatus {
  id: string;
  type: string;
  totalAgents: number;
  idleAgents: number;
  busyAgents: number;
  unhealthyAgents: number;
  queuedTasks: number;
  utilization: number;
}

/** Health status */
export interface HealthStatus {
  healthy: boolean;
  lastCheck: number;
  consecutiveFailures: number;
  message?: string;
}

/** Task in queue */
interface QueuedTask {
  id: string;
  capability: string;
  priority: number;
  queuedAt: number;
  data: unknown;
}

/** Pool instance */
interface Pool {
  config: PoolConfig;
  agents: Map<string, PoolAgent>;
  taskQueue: QueuedTask[];
  roundRobinIndex: number;
  lastScaleAction: number;
}

/** Pool Manager singleton */
class AgentPoolManagerClass {
  private pools: Map<string, Pool> = new Map();
  private healthCheckInterval: ReturnType<typeof setInterval> | null = null;

  /**
   * Create a new agent pool
   */
  createPool(config: PoolConfig): Pool {
    if (this.pools.has(config.id)) {
      console.warn(`[PoolManager] Pool already exists: ${config.id}`);
      return this.pools.get(config.id)!;
    }

    const pool: Pool = {
      config,
      agents: new Map(),
      taskQueue: [],
      roundRobinIndex: 0,
      lastScaleAction: 0
    };

    this.pools.set(config.id, pool);

    // Initialize minimum agents
    for (let i = 0; i < config.minAgents; i++) {
      this.addAgentToPool(config.id);
    }

    EventBus.emit('pool:created', { poolId: config.id, config });
    console.log(`[PoolManager] Created pool: ${config.id} with ${config.minAgents} agents`);

    // Start health checks if not running
    this.startHealthChecks();

    return pool;
  }

  /**
   * Add an agent to a pool
   */
  private addAgentToPool(poolId: string): PoolAgent | null {
    const pool = this.pools.get(poolId);
    if (!pool) return null;

    if (pool.agents.size >= pool.config.maxAgents) {
      console.warn(`[PoolManager] Pool ${poolId} at max capacity`);
      return null;
    }

    const agentId = `${poolId}-agent-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    const agent: PoolAgent = {
      id: agentId,
      poolId,
      status: 'idle',
      currentTask: null,
      completedTasks: 0,
      failedTasks: 0,
      lastHealthCheck: Date.now(),
      createdAt: Date.now()
    };

    pool.agents.set(agentId, agent);

    EventBus.emit('pool:agent:added', { poolId, agentId });
    console.log(`[PoolManager] Added agent ${agentId} to pool ${poolId}`);

    return agent;
  }

  /**
   * Remove an agent from a pool
   */
  private removeAgentFromPool(poolId: string, agentId: string): boolean {
    const pool = this.pools.get(poolId);
    if (!pool) return false;

    if (pool.agents.size <= pool.config.minAgents) {
      console.warn(`[PoolManager] Pool ${poolId} at minimum capacity`);
      return false;
    }

    const agent = pool.agents.get(agentId);
    if (!agent) return false;

    // Don't remove busy agents
    if (agent.status === 'busy') {
      agent.status = 'draining';
      return false;
    }

    pool.agents.delete(agentId);

    EventBus.emit('pool:agent:removed', { poolId, agentId });
    console.log(`[PoolManager] Removed agent ${agentId} from pool ${poolId}`);

    return true;
  }

  /**
   * Scale pool to specific count
   */
  scalePool(poolId: string, targetCount: number): void {
    const pool = this.pools.get(poolId);
    if (!pool) {
      console.error(`[PoolManager] Pool not found: ${poolId}`);
      return;
    }

    const current = pool.agents.size;
    const clamped = Math.max(
      pool.config.minAgents,
      Math.min(pool.config.maxAgents, targetCount)
    );

    if (clamped === current) return;

    if (clamped > current) {
      // Scale up
      const toAdd = clamped - current;
      for (let i = 0; i < toAdd; i++) {
        this.addAgentToPool(poolId);
      }
      EventBus.emit('pool:scaled:up', { poolId, from: current, to: clamped });
    } else {
      // Scale down
      const toRemove = current - clamped;
      const idleAgents = Array.from(pool.agents.values())
        .filter(a => a.status === 'idle')
        .slice(0, toRemove);

      for (const agent of idleAgents) {
        this.removeAgentFromPool(poolId, agent.id);
      }
      EventBus.emit('pool:scaled:down', { poolId, from: current, to: pool.agents.size });
    }

    pool.lastScaleAction = Date.now();
  }

  /**
   * Destroy a pool
   */
  destroyPool(poolId: string): void {
    const pool = this.pools.get(poolId);
    if (!pool) return;

    // Clear task queue
    pool.taskQueue = [];

    // Remove all agents
    for (const agentId of pool.agents.keys()) {
      pool.agents.delete(agentId);
    }

    this.pools.delete(poolId);

    EventBus.emit('pool:destroyed', { poolId });
    console.log(`[PoolManager] Destroyed pool: ${poolId}`);
  }

  /**
   * Get pool by ID
   */
  getPool(poolId: string): Pool | undefined {
    return this.pools.get(poolId);
  }

  /**
   * Get pool status
   */
  getPoolStatus(poolId?: string): PoolStatus[] {
    const statuses: PoolStatus[] = [];

    const poolsToCheck = poolId
      ? [this.pools.get(poolId)].filter(Boolean) as Pool[]
      : Array.from(this.pools.values());

    for (const pool of poolsToCheck) {
      const agents = Array.from(pool.agents.values());

      const idle = agents.filter(a => a.status === 'idle').length;
      const busy = agents.filter(a => a.status === 'busy').length;
      const unhealthy = agents.filter(a => a.status === 'unhealthy').length;

      statuses.push({
        id: pool.config.id,
        type: pool.config.type,
        totalAgents: agents.length,
        idleAgents: idle,
        busyAgents: busy,
        unhealthyAgents: unhealthy,
        queuedTasks: pool.taskQueue.length,
        utilization: agents.length > 0 ? busy / agents.length : 0
      });
    }

    return statuses;
  }

  /**
   * Get agent health status
   */
  getAgentHealth(agentId: string): HealthStatus | null {
    for (const pool of this.pools.values()) {
      const agent = pool.agents.get(agentId);
      if (agent) {
        return {
          healthy: agent.status !== 'unhealthy',
          lastCheck: agent.lastHealthCheck,
          consecutiveFailures: agent.status === 'unhealthy' ? 1 : 0
        };
      }
    }
    return null;
  }

  /**
   * Find an available agent for a task
   */
  findAvailableAgent(poolId: string, capability?: string): PoolAgent | null {
    const pool = this.pools.get(poolId);
    if (!pool) return null;

    const availableAgents = Array.from(pool.agents.values())
      .filter(a => a.status === 'idle');

    if (availableAgents.length === 0) return null;

    switch (pool.config.loadBalancing) {
      case 'round-robin': {
        const idx = pool.roundRobinIndex % availableAgents.length;
        pool.roundRobinIndex++;
        return availableAgents[idx];
      }

      case 'least-loaded': {
        return availableAgents.sort((a, b) =>
          (a.completedTasks + a.failedTasks) - (b.completedTasks + b.failedTasks)
        )[0];
      }

      case 'capability-match':
      default:
        return availableAgents[0];
    }
  }

  /**
   * Queue a task for the pool
   */
  queueTask(poolId: string, taskId: string, capability: string, data: unknown, priority = 0): boolean {
    const pool = this.pools.get(poolId);
    if (!pool) return false;

    pool.taskQueue.push({
      id: taskId,
      capability,
      priority,
      queuedAt: Date.now(),
      data
    });

    // Sort by priority (higher first)
    pool.taskQueue.sort((a, b) => b.priority - a.priority);

    EventBus.emit('pool:task:queued', { poolId, taskId });

    // Try to assign immediately
    this.processQueue(poolId);

    // Auto-scale if needed
    if (pool.config.autoScale) {
      this.checkAutoScale(poolId);
    }

    return true;
  }

  /**
   * Process task queue
   */
  private processQueue(poolId: string): void {
    const pool = this.pools.get(poolId);
    if (!pool || pool.taskQueue.length === 0) return;

    const task = pool.taskQueue[0];
    const agent = this.findAvailableAgent(poolId, task.capability);

    if (agent) {
      pool.taskQueue.shift();
      agent.status = 'busy';
      agent.currentTask = task.id;

      EventBus.emit('pool:task:assigned', {
        poolId,
        agentId: agent.id,
        taskId: task.id
      });

      console.log(`[PoolManager] Assigned task ${task.id} to agent ${agent.id}`);
    }
  }

  /**
   * Mark task as complete
   */
  completeTask(agentId: string, success: boolean): void {
    for (const pool of this.pools.values()) {
      const agent = pool.agents.get(agentId);
      if (agent) {
        const taskId = agent.currentTask;

        if (success) {
          agent.completedTasks++;
        } else {
          agent.failedTasks++;
        }

        agent.currentTask = null;
        agent.status = agent.status === 'draining' ? 'idle' : 'idle';

        // Remove draining agents
        if (agent.status === 'idle' && pool.agents.size > pool.config.minAgents) {
          const needsRemoval = Array.from(pool.agents.values())
            .filter(a => a.status === 'draining').length > 0;

          if (needsRemoval) {
            this.removeAgentFromPool(pool.config.id, agentId);
          }
        }

        EventBus.emit('pool:task:completed', {
          poolId: pool.config.id,
          agentId,
          taskId,
          success
        });

        // Process next task
        this.processQueue(pool.config.id);

        // Check auto-scale
        if (pool.config.autoScale) {
          this.checkAutoScale(pool.config.id);
        }

        return;
      }
    }
  }

  /**
   * Check if auto-scaling is needed
   */
  private checkAutoScale(poolId: string): void {
    const pool = this.pools.get(poolId);
    if (!pool || !pool.config.autoScale) return;

    // Cooldown period (60 seconds)
    if (Date.now() - pool.lastScaleAction < 60000) return;

    const status = this.getPoolStatus(poolId)[0];
    if (!status) return;

    const scaleUpThreshold = pool.config.scaleUpThreshold ?? 0.8;
    const scaleDownThreshold = pool.config.scaleDownThreshold ?? 0.3;

    if (status.utilization >= scaleUpThreshold && status.queuedTasks > 0) {
      // Scale up
      const target = Math.min(
        status.totalAgents + 1,
        pool.config.maxAgents
      );
      this.scalePool(poolId, target);
    } else if (status.utilization <= scaleDownThreshold && status.queuedTasks === 0) {
      // Scale down
      const target = Math.max(
        status.totalAgents - 1,
        pool.config.minAgents
      );
      this.scalePool(poolId, target);
    }
  }

  /**
   * Start health check loop
   */
  private startHealthChecks(): void {
    if (this.healthCheckInterval) return;

    this.healthCheckInterval = setInterval(() => {
      for (const pool of this.pools.values()) {
        for (const agent of pool.agents.values()) {
          // Mark agents as unhealthy if no activity for 5 minutes
          const inactive = Date.now() - agent.lastHealthCheck > 300000;

          if (inactive && agent.status !== 'busy') {
            agent.status = 'unhealthy';
            EventBus.emit('pool:agent:unhealthy', {
              poolId: pool.config.id,
              agentId: agent.id
            });
          } else if (agent.status !== 'busy') {
            agent.lastHealthCheck = Date.now();
          }
        }
      }
    }, 30000);
  }

  /**
   * Stop health checks
   */
  stopHealthChecks(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }

  /**
   * Get all pools
   */
  listPools(): PoolConfig[] {
    return Array.from(this.pools.values()).map(p => p.config);
  }

  /**
   * Clear all pools
   */
  clear(): void {
    for (const poolId of this.pools.keys()) {
      this.destroyPool(poolId);
    }
    this.stopHealthChecks();
  }
}

// Export singleton
export const AgentPoolManager = new AgentPoolManagerClass();

// Export class for testing
export { AgentPoolManagerClass };
