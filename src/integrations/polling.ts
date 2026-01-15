/**
 * Polling Manager
 *
 * Manages polling for external system updates:
 * - Configurable intervals per system
 * - Automatic retry with backoff
 * - Event emission on changes
 */

import { EventBus } from '../core/event-bus.js';
import type { PollConfig } from '../types/workflow.js';

/** Poll job definition */
interface PollJob {
  id: string;
  system: string;
  callback: () => Promise<unknown>;
  interval: number;
  retryCount: number;
  maxRetries: number;
  backoffMultiplier: number;
  lastPoll: number;
  lastResult: unknown;
  active: boolean;
  timeoutId: ReturnType<typeof setTimeout> | null;
}

/** Poll result */
interface PollResult {
  jobId: string;
  system: string;
  success: boolean;
  data?: unknown;
  error?: string;
  changed: boolean;
  timestamp: number;
}

/**
 * Polling Manager class
 */
class PollManagerClass {
  private jobs: Map<string, PollJob> = new Map();
  private paused = false;
  private debugMode = false;

  /**
   * Register a polling job
   */
  register(
    id: string,
    system: string,
    callback: () => Promise<unknown>,
    config: Partial<PollConfig> = {}
  ): void {
    // Stop existing job with same ID
    if (this.jobs.has(id)) {
      this.stop(id);
    }

    const job: PollJob = {
      id,
      system,
      callback,
      interval: config.interval || 30000,
      retryCount: 0,
      maxRetries: config.maxRetries || 3,
      backoffMultiplier: config.backoffMultiplier || 2,
      lastPoll: 0,
      lastResult: null,
      active: false,
      timeoutId: null
    };

    this.jobs.set(id, job);

    if (this.debugMode) {
      console.log(`[PollManager] Registered job: ${id} (${system}, ${job.interval}ms)`);
    }

    EventBus.emit('poll:registered', { id, system });
  }

  /**
   * Start a polling job
   */
  start(id: string): void {
    const job = this.jobs.get(id);
    if (!job) {
      console.warn(`[PollManager] Job not found: ${id}`);
      return;
    }

    if (job.active) {
      return; // Already running
    }

    job.active = true;
    this.scheduleNext(job, 0); // Execute immediately

    if (this.debugMode) {
      console.log(`[PollManager] Started job: ${id}`);
    }

    EventBus.emit('poll:started', { id, system: job.system });
  }

  /**
   * Stop a polling job
   */
  stop(id: string): void {
    const job = this.jobs.get(id);
    if (!job) return;

    job.active = false;
    if (job.timeoutId) {
      clearTimeout(job.timeoutId);
      job.timeoutId = null;
    }

    if (this.debugMode) {
      console.log(`[PollManager] Stopped job: ${id}`);
    }

    EventBus.emit('poll:stopped', { id, system: job.system });
  }

  /**
   * Unregister a polling job
   */
  unregister(id: string): void {
    this.stop(id);
    this.jobs.delete(id);
    EventBus.emit('poll:unregistered', { id });
  }

  /**
   * Schedule next poll execution
   */
  private scheduleNext(job: PollJob, delay: number): void {
    if (!job.active || this.paused) return;

    job.timeoutId = setTimeout(() => {
      this.executePoll(job);
    }, delay);
  }

  /**
   * Execute a poll
   */
  private async executePoll(job: PollJob): Promise<void> {
    if (!job.active || this.paused) return;

    const startTime = Date.now();

    try {
      const data = await job.callback();
      const changed = this.hasChanged(job.lastResult, data);

      job.lastResult = data;
      job.lastPoll = Date.now();
      job.retryCount = 0; // Reset on success

      const result: PollResult = {
        jobId: job.id,
        system: job.system,
        success: true,
        data,
        changed,
        timestamp: startTime
      };

      if (this.debugMode) {
        console.log(`[PollManager] Poll success: ${job.id}`, { changed, duration: Date.now() - startTime });
      }

      EventBus.emit('poll:success', result);

      if (changed) {
        EventBus.emit('poll:changed', result);
        EventBus.emit(`poll:${job.system}:changed`, result);
      }

      // Schedule next poll at normal interval
      this.scheduleNext(job, job.interval);

    } catch (error) {
      job.retryCount++;

      const result: PollResult = {
        jobId: job.id,
        system: job.system,
        success: false,
        error: error instanceof Error ? error.message : String(error),
        changed: false,
        timestamp: startTime
      };

      if (this.debugMode) {
        console.log(`[PollManager] Poll failed: ${job.id}`, result.error);
      }

      EventBus.emit('poll:error', result);

      if (job.retryCount >= job.maxRetries) {
        // Max retries reached, stop job
        console.error(`[PollManager] Max retries reached for ${job.id}, stopping`);
        job.active = false;
        EventBus.emit('poll:max-retries', { id: job.id, system: job.system });
      } else {
        // Schedule retry with backoff
        const backoffDelay = job.interval * Math.pow(job.backoffMultiplier, job.retryCount);
        this.scheduleNext(job, backoffDelay);
      }
    }
  }

  /**
   * Check if result has changed
   */
  private hasChanged(previous: unknown, current: unknown): boolean {
    if (previous === null || previous === undefined) {
      return current !== null && current !== undefined;
    }

    try {
      return JSON.stringify(previous) !== JSON.stringify(current);
    } catch {
      return previous !== current;
    }
  }

  /**
   * Pause all polling
   */
  pause(): void {
    this.paused = true;
    for (const job of this.jobs.values()) {
      if (job.timeoutId) {
        clearTimeout(job.timeoutId);
        job.timeoutId = null;
      }
    }
    EventBus.emit('poll:paused', {});
  }

  /**
   * Resume all polling
   */
  resume(): void {
    this.paused = false;
    for (const job of this.jobs.values()) {
      if (job.active) {
        const timeSinceLastPoll = Date.now() - job.lastPoll;
        const delay = Math.max(0, job.interval - timeSinceLastPoll);
        this.scheduleNext(job, delay);
      }
    }
    EventBus.emit('poll:resumed', {});
  }

  /**
   * Force immediate poll for a job
   */
  async pollNow(id: string): Promise<PollResult | null> {
    const job = this.jobs.get(id);
    if (!job) return null;

    // Cancel scheduled poll
    if (job.timeoutId) {
      clearTimeout(job.timeoutId);
      job.timeoutId = null;
    }

    // Execute immediately
    const startTime = Date.now();

    try {
      const data = await job.callback();
      const changed = this.hasChanged(job.lastResult, data);

      job.lastResult = data;
      job.lastPoll = Date.now();
      job.retryCount = 0;

      const result: PollResult = {
        jobId: job.id,
        system: job.system,
        success: true,
        data,
        changed,
        timestamp: startTime
      };

      // Reschedule if still active
      if (job.active) {
        this.scheduleNext(job, job.interval);
      }

      return result;

    } catch (error) {
      const result: PollResult = {
        jobId: job.id,
        system: job.system,
        success: false,
        error: error instanceof Error ? error.message : String(error),
        changed: false,
        timestamp: startTime
      };

      // Reschedule if still active
      if (job.active) {
        this.scheduleNext(job, job.interval);
      }

      return result;
    }
  }

  /**
   * Get job status
   */
  getJobStatus(id: string): {
    active: boolean;
    lastPoll: number;
    retryCount: number;
    interval: number;
  } | null {
    const job = this.jobs.get(id);
    if (!job) return null;

    return {
      active: job.active,
      lastPoll: job.lastPoll,
      retryCount: job.retryCount,
      interval: job.interval
    };
  }

  /**
   * List all jobs
   */
  list(): Array<{
    id: string;
    system: string;
    active: boolean;
    interval: number;
  }> {
    return Array.from(this.jobs.values()).map(job => ({
      id: job.id,
      system: job.system,
      active: job.active,
      interval: job.interval
    }));
  }

  /**
   * Stop all jobs
   */
  stopAll(): void {
    for (const id of this.jobs.keys()) {
      this.stop(id);
    }
  }

  /**
   * Clear all jobs
   */
  clear(): void {
    this.stopAll();
    this.jobs.clear();
    EventBus.emit('poll:cleared', {});
  }

  /**
   * Enable debug mode
   */
  enableDebug(): void {
    this.debugMode = true;
  }

  /**
   * Disable debug mode
   */
  disableDebug(): void {
    this.debugMode = false;
  }
}

// Export singleton instance
export const PollManager = new PollManagerClass();

// Also export the class for testing
export { PollManagerClass };
