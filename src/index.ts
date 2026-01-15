/**
 * AgentOS - Multi-Agent Orchestration System
 *
 * Main entry point that exports all modules.
 */

// Core modules
export * from './core/index.js';

// Type definitions
export * from './types/index.js';

// External integrations
export * from './integrations/index.js';

// Skill system
export * from './skills/index.js';

// Browser automation
export * from './browser/index.js';

// Workflow DNA
export * from './workflow-dna/index.js';

// CDP injection
export * from './cdp/index.js';

// Version info
export const VERSION = '1.0.0';

/**
 * Initialize AgentOS
 */
export async function init(): Promise<void> {
  const { EventBus } = await import('./core/event-bus.js');
  const { StateManager } = await import('./core/state-manager.js');
  const { IntegrationRegistry } = await import('./integrations/registry.js');

  // Initialize state manager
  StateManager.init();

  // Load saved integration configs
  await IntegrationRegistry.initFromSaved();

  // Emit init event
  EventBus.emit('agentos:initialized', { version: VERSION });

  console.log(`[AgentOS] Initialized v${VERSION}`);
}
