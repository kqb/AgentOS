/**
 * KBSyncManager - Core sync orchestration for team knowledge sharing
 *
 * Supports multiple sync backends:
 * - Git (recommended for most teams)
 * - S3/Cloud storage
 * - Confluence
 * - File export/import
 *
 * Features:
 * - Auto-sync on knowledge changes
 * - Conflict resolution
 * - Change tracking
 */

import { EventBus } from '../core/event-bus.js';
import { KBExporter, GitSyncFiles } from './exporter.js';
import { KBImporter, ImportStats } from './importer.js';

/** Sync method */
export type SyncMethod = 'git' | 's3' | 'confluence' | 'file';

/** Conflict resolution strategy */
export type ConflictStrategy = 'merge' | 'local-wins' | 'remote-wins';

/** Sync configuration */
export interface SyncConfig {
  syncMethod: SyncMethod;
  syncPath: string;
  syncInterval: number;
  conflictResolution: ConflictStrategy;
  autoSync: boolean;
  s3Config?: {
    bucket: string;
    region: string;
    prefix?: string;
  };
  confluenceConfig?: {
    baseUrl: string;
    spaceKey: string;
    pageId?: string;
  };
}

/** Pending change */
export interface PendingChange {
  id: string;
  action: 'add' | 'update' | 'delete';
  type: 'pattern' | 'rule' | 'knowledge' | 'skill' | 'document' | 'entity';
  data: unknown;
  timestamp: number;
  author: string;
}

/** Sync state */
export interface SyncState {
  lastSync: number | null;
  pendingChanges: PendingChange[];
  syncInProgress: boolean;
  conflicts: unknown[];
  lastError: string | null;
}

/** Sync result */
export interface SyncResult {
  success: boolean;
  timestamp: number;
  pulled: number;
  pushed: number;
  conflicts: number;
  errors: string[];
}

/** Sync status */
export interface SyncStatus {
  configured: boolean;
  method: SyncMethod;
  lastSync: number | null;
  nextSync: number | null;
  pendingChanges: number;
  isRunning: boolean;
  autoSync: boolean;
}

/** Default config */
const DEFAULT_CONFIG: SyncConfig = {
  syncMethod: 'git',
  syncPath: '.agentos/knowledge',
  syncInterval: 300000, // 5 minutes
  conflictResolution: 'merge',
  autoSync: true
};

/** Sync manager singleton */
class KBSyncManagerClass {
  private config: SyncConfig = DEFAULT_CONFIG;
  private state: SyncState = {
    lastSync: null,
    pendingChanges: [],
    syncInProgress: false,
    conflicts: [],
    lastError: null
  };
  private autoSyncInterval: ReturnType<typeof setInterval> | null = null;
  private isInitialized = false;

  /**
   * Initialize sync manager
   */
  async init(config?: Partial<SyncConfig>): Promise<void> {
    if (this.isInitialized) {
      console.log('[KBSyncManager] Already initialized');
      return;
    }

    if (config) {
      this.config = { ...DEFAULT_CONFIG, ...config };
    }

    // Load persisted state
    await this.loadState();

    // Register event listeners for change tracking
    this.registerEventListeners();

    // Start auto-sync if enabled
    if (this.config.autoSync) {
      this.startAutoSync();
    }

    this.isInitialized = true;

    console.log(`[KBSyncManager] Initialized with method: ${this.config.syncMethod}`);

    EventBus.emit('kb:sync:initialized', { config: this.config });
  }

  /**
   * Register event listeners for change tracking
   */
  private registerEventListeners(): void {
    // Knowledge changes
    EventBus.on('kb:document:added', (data) => {
      this.queueChange('add', 'document', data);
    });

    EventBus.on('kb:entity:created', (data) => {
      this.queueChange('add', 'entity', data);
    });

    // Improvement system changes
    EventBus.on('patterns:mined', (data) => {
      this.queueChange('add', 'pattern', data);
    });

    EventBus.on('rules:refined', (data) => {
      this.queueChange('add', 'rule', data);
    });

    EventBus.on('knowledge:extracted', (data) => {
      this.queueChange('add', 'knowledge', data);
    });

    EventBus.on('rule:applied', (data) => {
      this.queueChange('update', 'rule', data);
    });

    // Auto-sync after improvement run
    EventBus.on('improvement:run:complete', () => {
      // Debounce - sync 10 seconds after improvement completes
      setTimeout(() => this.sync(), 10000);
    });
  }

  /**
   * Queue a change for sync
   */
  queueChange(
    action: PendingChange['action'],
    type: PendingChange['type'],
    data: unknown
  ): void {
    const change: PendingChange = {
      id: `change-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      action,
      type,
      data,
      timestamp: Date.now(),
      author: KBExporter.getAuthorId()
    };

    this.state.pendingChanges.push(change);

    // Limit pending changes
    if (this.state.pendingChanges.length > 1000) {
      this.state.pendingChanges = this.state.pendingChanges.slice(-1000);
    }

    this.saveState();

    EventBus.emit('kb:sync:change-queued', { change });
  }

  /**
   * Get pending changes
   */
  getPendingChanges(): PendingChange[] {
    return [...this.state.pendingChanges];
  }

  /**
   * Perform sync
   */
  async sync(): Promise<SyncResult> {
    if (this.state.syncInProgress) {
      console.log('[KBSyncManager] Sync already in progress');
      return {
        success: false,
        timestamp: Date.now(),
        pulled: 0,
        pushed: 0,
        conflicts: 0,
        errors: ['Sync already in progress']
      };
    }

    this.state.syncInProgress = true;
    this.state.lastError = null;

    console.log('[KBSyncManager] Starting sync...');

    EventBus.emit('kb:sync:start', { timestamp: Date.now() });

    const result: SyncResult = {
      success: false,
      timestamp: Date.now(),
      pulled: 0,
      pushed: 0,
      conflicts: 0,
      errors: []
    };

    try {
      // 1. Pull remote changes
      const pullResult = await this.pullRemote();
      result.pulled = pullResult.imported;
      result.conflicts = pullResult.conflicts;

      // 2. Push local changes
      await this.pushLocal();
      result.pushed = this.state.pendingChanges.length;

      // 3. Clear pending changes
      this.state.pendingChanges = [];
      this.state.lastSync = Date.now();

      result.success = true;

      this.saveState();

      EventBus.emit('kb:sync:complete', result);

      console.log('[KBSyncManager] Sync complete:', result);

    } catch (error) {
      const err = error as Error;
      result.errors.push(err.message);
      this.state.lastError = err.message;

      EventBus.emit('kb:sync:error', { error: err.message });

      console.error('[KBSyncManager] Sync failed:', err);

    } finally {
      this.state.syncInProgress = false;
    }

    return result;
  }

  /**
   * Pull remote changes
   */
  async pullRemote(): Promise<ImportStats> {
    switch (this.config.syncMethod) {
      case 'git':
        return this.pullFromGit();
      case 's3':
        return this.pullFromS3();
      case 'confluence':
        return this.pullFromConfluence();
      case 'file':
        return this.pullFromFile();
      default:
        throw new Error(`Unknown sync method: ${this.config.syncMethod}`);
    }
  }

  /**
   * Push local changes
   */
  async pushLocal(): Promise<void> {
    switch (this.config.syncMethod) {
      case 'git':
        return this.pushToGit();
      case 's3':
        return this.pushToS3();
      case 'confluence':
        return this.pushToConfluence();
      case 'file':
        return this.pushToFile();
    }
  }

  /**
   * Pull from Git (read local files)
   */
  private async pullFromGit(): Promise<ImportStats> {
    // In browser context, we read from localStorage simulation
    // In real deployment, this would read from .agentos/knowledge/ files
    const files = await this.readGitFiles();

    if (Object.keys(files).length === 0) {
      return {
        patterns: 0, rules: 0, knowledge: 0, skills: 0, documents: 0,
        entities: 0, relationships: 0, feedback: 0, decisions: 0,
        conflicts: 0, skipped: 0, errors: []
      };
    }

    const data = this.parseGitFiles(files);
    return KBImporter.importData(data, {
      mergeStrategy: this.config.conflictResolution === 'local-wins' ? 'skip-existing' :
                     this.config.conflictResolution === 'remote-wins' ? 'replace' : 'merge'
    });
  }

  /**
   * Read Git sync files
   */
  private async readGitFiles(): Promise<Record<string, unknown>> {
    const files: Record<string, unknown> = {};
    const basePath = this.config.syncPath;

    const paths = [
      'patterns/code_generator-patterns.json',
      'patterns/test_writer-patterns.json',
      'patterns/debugger-patterns.json',
      'patterns/qa_engineer-patterns.json',
      'patterns/team_lead-patterns.json',
      'rules/code_generator-learned-rules.json',
      'rules/test_writer-learned-rules.json',
      'domain/general.json',
      'skills/generated-skills.json',
      'sync-manifest.json'
    ];

    for (const path of paths) {
      try {
        // In browser, try localStorage
        const key = `git_sync_${path}`;
        const content = localStorage.getItem(key);
        if (content) {
          files[path] = JSON.parse(content);
        }
      } catch {
        // File doesn't exist or invalid
      }
    }

    return files;
  }

  /**
   * Parse Git files into import format
   */
  private parseGitFiles(files: Record<string, unknown>): Parameters<typeof KBImporter.importData>[0] {
    const data: Parameters<typeof KBImporter.importData>[0] = {
      version: '1.0',
      exportedAt: Date.now(),
      exportedBy: 'git-sync',
      feedback: [],
      decisions: [],
      humanFeedback: [],
      patterns: [],
      rules: [],
      knowledge: [],
      documents: [],
      entities: [],
      relationships: [],
      skills: [],
      stats: { totalPatterns: 0, totalRules: 0, totalKnowledge: 0, totalDocuments: 0, totalEntities: 0 }
    };

    for (const [path, content] of Object.entries(files)) {
      const c = content as Record<string, unknown>;

      if (path.startsWith('patterns/') && c.patterns) {
        data.patterns.push(...(c.patterns as unknown[]));
      } else if (path.startsWith('rules/') && c.rules) {
        data.rules.push(...(c.rules as unknown[]));
      } else if (path.startsWith('domain/') && c.entries) {
        data.knowledge.push(...(c.entries as unknown[]));
      } else if (path.startsWith('skills/') && c.skills) {
        data.skills.push(...(c.skills as unknown[]));
      }
    }

    return data;
  }

  /**
   * Push to Git (write files)
   */
  private async pushToGit(): Promise<void> {
    const files = await KBExporter.generateSyncFiles();

    // In browser, save to localStorage
    for (const [path, content] of Object.entries(files)) {
      const key = `git_sync_${path}`;
      localStorage.setItem(key, JSON.stringify(content));
    }

    // Show git commands to user
    const commands = KBExporter.generateGitCommands(files);
    console.log(commands);

    console.log('[KBSyncManager] Pushed to Git:', Object.keys(files).length, 'files');
  }

  /**
   * Pull from S3
   */
  private async pullFromS3(): Promise<ImportStats> {
    if (!this.config.s3Config) {
      throw new Error('S3 config not provided');
    }

    const { bucket, region, prefix = '.agentos/knowledge' } = this.config.s3Config;

    // Fetch export file from S3
    const url = `https://${bucket}.s3.${region}.amazonaws.com/${prefix}/export.json`;

    try {
      return await KBImporter.importFromUrl(url);
    } catch (error) {
      console.warn('[KBSyncManager] S3 pull failed:', error);
      return {
        patterns: 0, rules: 0, knowledge: 0, skills: 0, documents: 0,
        entities: 0, relationships: 0, feedback: 0, decisions: 0,
        conflicts: 0, skipped: 0, errors: [(error as Error).message]
      };
    }
  }

  /**
   * Push to S3
   */
  private async pushToS3(): Promise<void> {
    if (!this.config.s3Config) {
      throw new Error('S3 config not provided');
    }

    const data = await KBExporter.exportAll();
    const { bucket, region, prefix = '.agentos/knowledge' } = this.config.s3Config;

    // In real implementation, use AWS SDK or signed URLs
    console.log(`[KBSyncManager] Would upload to s3://${bucket}/${prefix}/export.json`);
    console.log('[KBSyncManager] S3 push requires AWS SDK integration');
  }

  /**
   * Pull from Confluence
   */
  private async pullFromConfluence(): Promise<ImportStats> {
    if (!this.config.confluenceConfig) {
      throw new Error('Confluence config not provided');
    }

    // Would use Confluence adapter
    console.log('[KBSyncManager] Confluence pull requires Confluence adapter integration');

    return {
      patterns: 0, rules: 0, knowledge: 0, skills: 0, documents: 0,
      entities: 0, relationships: 0, feedback: 0, decisions: 0,
      conflicts: 0, skipped: 0, errors: []
    };
  }

  /**
   * Push to Confluence
   */
  private async pushToConfluence(): Promise<void> {
    if (!this.config.confluenceConfig) {
      throw new Error('Confluence config not provided');
    }

    // Would use Confluence adapter
    console.log('[KBSyncManager] Confluence push requires Confluence adapter integration');
  }

  /**
   * Pull from local file (manual sync)
   */
  private async pullFromFile(): Promise<ImportStats> {
    // This is triggered manually via file input
    console.log('[KBSyncManager] File pull requires user to select file');

    return {
      patterns: 0, rules: 0, knowledge: 0, skills: 0, documents: 0,
      entities: 0, relationships: 0, feedback: 0, decisions: 0,
      conflicts: 0, skipped: 0, errors: []
    };
  }

  /**
   * Push to local file (download)
   */
  private async pushToFile(): Promise<void> {
    await KBExporter.downloadExport();
  }

  /**
   * Start auto-sync
   */
  startAutoSync(): void {
    if (this.autoSyncInterval) {
      return;
    }

    console.log(`[KBSyncManager] Starting auto-sync every ${this.config.syncInterval}ms`);

    // Initial sync after 30 seconds
    setTimeout(() => this.sync(), 30000);

    // Periodic sync
    this.autoSyncInterval = setInterval(() => {
      this.sync();
    }, this.config.syncInterval);
  }

  /**
   * Stop auto-sync
   */
  stopAutoSync(): void {
    if (this.autoSyncInterval) {
      clearInterval(this.autoSyncInterval);
      this.autoSyncInterval = null;
      console.log('[KBSyncManager] Stopped auto-sync');
    }
  }

  /**
   * Get sync status
   */
  getStatus(): SyncStatus {
    return {
      configured: this.isInitialized,
      method: this.config.syncMethod,
      lastSync: this.state.lastSync,
      nextSync: this.state.lastSync && this.autoSyncInterval
        ? this.state.lastSync + this.config.syncInterval
        : null,
      pendingChanges: this.state.pendingChanges.length,
      isRunning: this.state.syncInProgress,
      autoSync: this.config.autoSync
    };
  }

  /**
   * Get current config
   */
  getConfig(): SyncConfig {
    return { ...this.config };
  }

  /**
   * Update config
   */
  setConfig(config: Partial<SyncConfig>): void {
    this.config = { ...this.config, ...config };

    // Restart auto-sync if interval changed
    if (config.syncInterval && this.autoSyncInterval) {
      this.stopAutoSync();
      this.startAutoSync();
    }

    // Start/stop auto-sync based on config
    if (config.autoSync !== undefined) {
      if (config.autoSync && !this.autoSyncInterval) {
        this.startAutoSync();
      } else if (!config.autoSync && this.autoSyncInterval) {
        this.stopAutoSync();
      }
    }

    this.saveState();
  }

  /**
   * Load persisted state
   */
  private async loadState(): Promise<void> {
    try {
      const saved = localStorage.getItem('agentOS_syncState');
      if (saved) {
        const parsed = JSON.parse(saved);
        this.state = {
          ...this.state,
          lastSync: parsed.lastSync || null,
          pendingChanges: parsed.pendingChanges || []
        };
      }
    } catch {
      console.warn('[KBSyncManager] Could not load sync state');
    }
  }

  /**
   * Save state to persistence
   */
  private saveState(): void {
    try {
      localStorage.setItem('agentOS_syncState', JSON.stringify({
        lastSync: this.state.lastSync,
        pendingChanges: this.state.pendingChanges.slice(-100)
      }));
    } catch {
      console.warn('[KBSyncManager] Could not save sync state');
    }
  }

  /**
   * Report status (formatted for CLI)
   */
  reportStatus(): string {
    const status = this.getStatus();

    const lines = [
      '## KB Sync Status',
      '',
      `**Method:** ${status.method}`,
      `**Auto-sync:** ${status.autoSync ? 'Enabled' : 'Disabled'}`,
      `**Status:** ${status.isRunning ? 'Syncing...' : 'Idle'}`,
      `**Last sync:** ${status.lastSync ? new Date(status.lastSync).toLocaleString() : 'Never'}`,
      `**Next sync:** ${status.nextSync ? new Date(status.nextSync).toLocaleString() : 'Not scheduled'}`,
      `**Pending changes:** ${status.pendingChanges}`
    ];

    if (this.state.lastError) {
      lines.push('', `**Last error:** ${this.state.lastError}`);
    }

    return lines.join('\n');
  }

  /**
   * Reset sync state
   */
  reset(): void {
    this.state = {
      lastSync: null,
      pendingChanges: [],
      syncInProgress: false,
      conflicts: [],
      lastError: null
    };

    localStorage.removeItem('agentOS_syncState');

    console.log('[KBSyncManager] Reset sync state');
  }
}

// Export singleton
export const KBSyncManager = new KBSyncManagerClass();

// Export class for testing
export { KBSyncManagerClass };
