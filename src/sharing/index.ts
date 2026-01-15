/**
 * Team Knowledge Sharing System
 *
 * Enables team-wide knowledge sharing so learnings
 * from one developer benefit the entire team automatically.
 *
 * Components:
 * - KBExporter: Export knowledge to files
 * - KBImporter: Import from files, URLs, clipboard
 * - KBSyncManager: Core sync orchestration
 * - KBPeerSync: Real-time P2P sync
 */

// Core exports
export { KBExporter, KBExporterClass, EXPORT_VERSION } from './exporter.js';
export type { TeamKnowledgeExport, PatternExport, RuleExport, KnowledgeExport, GitSyncFiles } from './exporter.js';

export { KBImporter, KBImporterClass } from './importer.js';
export type { ImportStats, ImportOptions } from './importer.js';

export { KBSyncManager, KBSyncManagerClass } from './sync-manager.js';
export type { SyncMethod, ConflictStrategy, SyncConfig, PendingChange, SyncState, SyncResult, SyncStatus } from './sync-manager.js';

export { KBPeerSync, KBPeerSyncClass } from './peer-sync.js';
export type { PeerInfo, PeerMessageType, PeerMessage, KnowledgeUpdatePayload } from './peer-sync.js';

/**
 * Initialize the sharing system
 */
export async function initSharing(config?: {
  syncMethod?: 'git' | 's3' | 'confluence' | 'file';
  syncPath?: string;
  syncInterval?: number;
  autoSync?: boolean;
  enableP2P?: boolean;
  peerName?: string;
}): Promise<void> {
  const {
    syncMethod = 'git',
    syncPath = '.agentos/knowledge',
    syncInterval = 300000,
    autoSync = true,
    enableP2P = true,
    peerName
  } = config || {};

  // Initialize sync manager
  const { KBSyncManager } = await import('./sync-manager.js');
  await KBSyncManager.init({
    syncMethod,
    syncPath,
    syncInterval,
    autoSync,
    conflictResolution: 'merge'
  });

  // Initialize P2P if enabled
  if (enableP2P) {
    const { KBPeerSync } = await import('./peer-sync.js');
    await KBPeerSync.init(peerName);
  }

  console.log('[Sharing] Knowledge sharing system initialized');
}

/**
 * Register CLI commands for knowledge sharing
 */
export async function registerSharingCommands(): Promise<void> {
  try {
    const { CommandParser } = await import('../cli/parser.js');
    const { KBSyncManager } = await import('./sync-manager.js');
    const { KBExporter } = await import('./exporter.js');
    const { KBImporter } = await import('./importer.js');
    const { KBPeerSync } = await import('./peer-sync.js');

    // /kb-sync - Sync with team
    CommandParser.register(
      'kb-sync',
      async () => {
        console.log('Starting knowledge sync...');
        const result = await KBSyncManager.sync();

        if (result.success) {
          console.log(`✅ Sync complete: pulled ${result.pulled}, pushed ${result.pushed}`);
        } else {
          console.log(`❌ Sync failed: ${result.errors.join(', ')}`);
        }

        return { success: result.success };
      },
      'Sync knowledge base with team',
      { category: 'Knowledge Sharing' }
    );

    // /kb-export - Download JSON export
    CommandParser.register(
      'kb-export',
      async () => {
        console.log('Exporting knowledge base...');
        await KBExporter.downloadExport();
        console.log('✅ Export downloaded');
        return { success: true };
      },
      'Export knowledge base to JSON file',
      { category: 'Knowledge Sharing' }
    );

    // /kb-export-md - Export markdown summary
    CommandParser.register(
      'kb-export-md',
      async () => {
        const md = await KBExporter.exportMarkdownSummary();
        console.log(md);

        // Copy to clipboard if available
        if (typeof navigator !== 'undefined' && navigator.clipboard) {
          await navigator.clipboard.writeText(md);
          console.log('\n📋 Copied to clipboard!');
        }

        return { success: true, markdown: md };
      },
      'Export knowledge summary as Markdown',
      { category: 'Knowledge Sharing' }
    );

    // /kb-import <url> - Import from URL
    CommandParser.register(
      'kb-import',
      async (args) => {
        if (!args || !args.url) {
          console.log('Usage: /kb-import <url>');
          console.log('Example: /kb-import https://raw.githubusercontent.com/.../export.json');
          return { success: false, error: 'URL required' };
        }

        console.log(`Importing from: ${args.url}`);
        const stats = await KBImporter.importFromUrl(args.url);

        console.log('✅ Import complete:', stats);
        return { success: true, stats };
      },
      'Import knowledge from URL',
      { category: 'Knowledge Sharing' }
    );

    // /kb-import-clipboard - Import from clipboard
    CommandParser.register(
      'kb-import-clipboard',
      async () => {
        console.log('Importing from clipboard...');
        try {
          const stats = await KBImporter.importFromClipboard();
          console.log('✅ Import complete:', stats);
          return { success: true, stats };
        } catch (error) {
          console.log(`❌ Import failed: ${(error as Error).message}`);
          return { success: false, error: (error as Error).message };
        }
      },
      'Import knowledge from clipboard',
      { category: 'Knowledge Sharing' }
    );

    // /kb-commit - Generate Git commit files
    CommandParser.register(
      'kb-commit',
      async () => {
        console.log('Generating Git sync files...');
        const files = await KBExporter.generateSyncFiles();

        console.log(`\n📁 Files generated: ${Object.keys(files).length}`);
        for (const path of Object.keys(files)) {
          console.log(`  - .agentos/knowledge/${path}`);
        }

        const commands = KBExporter.generateGitCommands(files);
        console.log(commands);

        return { success: true, files: Object.keys(files) };
      },
      'Generate files for Git commit',
      { category: 'Knowledge Sharing' }
    );

    // /kb-peers - Show connected peers
    CommandParser.register(
      'kb-peers',
      async () => {
        if (!KBPeerSync.isReady()) {
          console.log('P2P sync not initialized. Run initSharing() first.');
          return { success: false, error: 'Not initialized' };
        }

        const peers = KBPeerSync.getPeers();

        if (peers.length === 0) {
          console.log('No active peers found');
        } else {
          console.log(`\n👥 Connected Peers (${peers.length}):\n`);
          for (const peer of peers) {
            const lastSeen = new Date(peer.lastSeen).toLocaleTimeString();
            console.log(`  • ${peer.name} (${peer.id.slice(0, 12)}...) - ${lastSeen}`);
          }
        }

        return { success: true, peers };
      },
      'Show connected P2P peers',
      { category: 'Knowledge Sharing' }
    );

    // /kb-sync-status - Show sync status
    CommandParser.register(
      'kb-sync-status',
      async () => {
        const status = KBSyncManager.reportStatus();
        console.log(status);

        if (KBPeerSync.isReady()) {
          console.log('\n');
          console.log(KBPeerSync.reportStatus());
        }

        return { success: true };
      },
      'Show sync status',
      { category: 'Knowledge Sharing' }
    );

    // /kb-request-sync - Request sync from peers
    CommandParser.register(
      'kb-request-sync',
      async (args) => {
        if (!KBPeerSync.isReady()) {
          console.log('P2P sync not initialized');
          return { success: false };
        }

        KBPeerSync.requestSync(args?.peerId);
        console.log('✅ Sync request sent');
        return { success: true };
      },
      'Request knowledge sync from peers',
      { category: 'Knowledge Sharing' }
    );

    console.log('[Sharing] CLI commands registered');

  } catch (error) {
    console.warn('[Sharing] Could not register CLI commands:', error);
  }
}

/**
 * Quick helper to export knowledge
 */
export async function exportKnowledge(): Promise<void> {
  const { KBExporter } = await import('./exporter.js');
  await KBExporter.downloadExport();
}

/**
 * Quick helper to import from URL
 */
export async function importFromUrl(url: string): Promise<ImportStats> {
  const { KBImporter } = await import('./importer.js');
  return KBImporter.importFromUrl(url);
}

/**
 * Quick helper to sync
 */
export async function sync(): Promise<SyncResult> {
  const { KBSyncManager } = await import('./sync-manager.js');
  return KBSyncManager.sync();
}

/**
 * Quick helper to get sync status
 */
export function getSyncStatus(): SyncStatus {
  // Return minimal status if not initialized
  try {
    const { KBSyncManager } = require('./sync-manager.js');
    return KBSyncManager.getStatus();
  } catch {
    return {
      configured: false,
      method: 'git',
      lastSync: null,
      nextSync: null,
      pendingChanges: 0,
      isRunning: false,
      autoSync: false
    };
  }
}

/**
 * Quick helper to get connected peers
 */
export function getConnectedPeers(): PeerInfo[] {
  try {
    const { KBPeerSync } = require('./peer-sync.js');
    return KBPeerSync.getPeers();
  } catch {
    return [];
  }
}

// Type re-exports for convenience
import type { ImportStats, SyncStatus, SyncResult, PeerInfo } from './index.js';
