/**
 * KBPeerSync - Real-time P2P knowledge sharing
 *
 * Uses BroadcastChannel for same-origin communication between:
 * - Browser tabs
 * - Iframes
 * - Service workers
 *
 * Enables real-time knowledge sharing within a team
 * when multiple developers are on the same network/origin.
 */

import { EventBus } from '../core/event-bus.js';
import { KBExporter } from './exporter.js';
import { KBImporter } from './importer.js';

/** Peer info */
export interface PeerInfo {
  id: string;
  name: string;
  lastSeen: number;
  metadata?: Record<string, unknown>;
}

/** Peer message types */
export type PeerMessageType =
  | 'presence'
  | 'presence_ack'
  | 'sync_request'
  | 'sync_response'
  | 'knowledge_update'
  | 'ping'
  | 'pong';

/** Peer message */
export interface PeerMessage {
  id: string;
  type: PeerMessageType;
  senderId: string;
  senderName: string;
  targetId?: string;
  payload?: unknown;
  timestamp: number;
}

/** Knowledge update payload */
export interface KnowledgeUpdatePayload {
  updateType: 'pattern' | 'rule' | 'knowledge' | 'skill' | 'document';
  data: unknown;
}

/** P2P sync singleton */
class KBPeerSyncClass {
  private channel: BroadcastChannel | null = null;
  private localPeerId: string;
  private localPeerName: string;
  private peers: Map<string, PeerInfo> = new Map();
  private isInitialized = false;
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private presenceInterval: ReturnType<typeof setInterval> | null = null;
  private channelName = 'agentos-kb-sync';

  constructor() {
    this.localPeerId = this.generateId();
    this.localPeerName = 'AgentOS User';
  }

  /**
   * Generate unique ID
   */
  private generateId(): string {
    return `peer-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  /**
   * Initialize P2P sync
   */
  async init(name?: string): Promise<void> {
    if (this.isInitialized) {
      console.log('[KBPeerSync] Already initialized');
      return;
    }

    if (name) {
      this.localPeerName = name;
    }

    // Try to get name from localStorage
    const storedName = localStorage.getItem('agentOS_peerName');
    if (storedName) {
      this.localPeerName = storedName;
    }

    // Check if BroadcastChannel is available
    if (typeof BroadcastChannel === 'undefined') {
      console.warn('[KBPeerSync] BroadcastChannel not available, P2P sync disabled');
      return;
    }

    // Create broadcast channel
    this.channel = new BroadcastChannel(this.channelName);
    this.channel.onmessage = (event) => this.handleMessage(event.data as PeerMessage);

    // Start presence announcements
    this.startPresence();

    // Start ping interval for health checks
    this.startPingInterval();

    // Register event listeners for knowledge changes
    this.registerEventListeners();

    this.isInitialized = true;

    // Announce presence immediately
    this.announcePresence();

    console.log(`[KBPeerSync] Initialized as ${this.localPeerName} (${this.localPeerId})`);

    EventBus.emit('kb:peer:initialized', { peerId: this.localPeerId });
  }

  /**
   * Close P2P sync
   */
  close(): void {
    if (this.channel) {
      // Announce departure (optional - peers will timeout anyway)
      this.channel.close();
      this.channel = null;
    }

    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }

    if (this.presenceInterval) {
      clearInterval(this.presenceInterval);
      this.presenceInterval = null;
    }

    this.peers.clear();
    this.isInitialized = false;

    console.log('[KBPeerSync] Closed');
  }

  /**
   * Register event listeners for automatic broadcasting
   */
  private registerEventListeners(): void {
    // Broadcast new patterns
    EventBus.on('patterns:mined', (data) => {
      this.broadcastUpdate('pattern', data);
    });

    // Broadcast new rules
    EventBus.on('rule:applied', (data) => {
      this.broadcastUpdate('rule', data);
    });

    // Broadcast new knowledge
    EventBus.on('knowledge:extracted', (data) => {
      this.broadcastUpdate('knowledge', data);
    });

    // Broadcast new documents
    EventBus.on('kb:document:added', (data) => {
      this.broadcastUpdate('document', data);
    });
  }

  /**
   * Start presence announcements
   */
  private startPresence(): void {
    // Announce presence every 30 seconds
    this.presenceInterval = setInterval(() => {
      this.announcePresence();
      this.cleanupStalePeers();
    }, 30000);
  }

  /**
   * Start ping interval
   */
  private startPingInterval(): void {
    // Ping peers every 60 seconds
    this.pingInterval = setInterval(() => {
      this.pingAllPeers();
    }, 60000);
  }

  /**
   * Announce presence to all peers
   */
  announcePresence(): void {
    if (!this.channel) return;

    const message: PeerMessage = {
      id: this.generateId(),
      type: 'presence',
      senderId: this.localPeerId,
      senderName: this.localPeerName,
      payload: {
        peer: this.getSelf()
      },
      timestamp: Date.now()
    };

    this.channel.postMessage(message);
  }

  /**
   * Get self peer info
   */
  getSelf(): PeerInfo {
    return {
      id: this.localPeerId,
      name: this.localPeerName,
      lastSeen: Date.now()
    };
  }

  /**
   * Handle incoming message
   */
  private async handleMessage(message: PeerMessage): Promise<void> {
    // Ignore own messages
    if (message.senderId === this.localPeerId) return;

    switch (message.type) {
      case 'presence':
        this.handlePresence(message);
        break;

      case 'presence_ack':
        this.handlePresenceAck(message);
        break;

      case 'sync_request':
        if (!message.targetId || message.targetId === this.localPeerId) {
          await this.handleSyncRequest(message);
        }
        break;

      case 'sync_response':
        if (message.targetId === this.localPeerId) {
          await this.handleSyncResponse(message);
        }
        break;

      case 'knowledge_update':
        this.handleKnowledgeUpdate(message);
        break;

      case 'ping':
        this.handlePing(message);
        break;

      case 'pong':
        this.handlePong(message);
        break;
    }
  }

  /**
   * Handle presence announcement
   */
  private handlePresence(message: PeerMessage): void {
    const payload = message.payload as { peer: PeerInfo };

    if (payload?.peer) {
      this.peers.set(message.senderId, {
        ...payload.peer,
        lastSeen: Date.now()
      });

      // Send acknowledgment
      this.sendPresenceAck(message.senderId);

      console.log(`[KBPeerSync] Discovered peer: ${payload.peer.name} (${message.senderId})`);

      EventBus.emit('kb:peer:discovered', { peer: payload.peer });
    }
  }

  /**
   * Handle presence acknowledgment
   */
  private handlePresenceAck(message: PeerMessage): void {
    const payload = message.payload as { peer: PeerInfo };

    if (payload?.peer) {
      this.peers.set(message.senderId, {
        ...payload.peer,
        lastSeen: Date.now()
      });
    }
  }

  /**
   * Send presence acknowledgment
   */
  private sendPresenceAck(targetId: string): void {
    if (!this.channel) return;

    const message: PeerMessage = {
      id: this.generateId(),
      type: 'presence_ack',
      senderId: this.localPeerId,
      senderName: this.localPeerName,
      targetId,
      payload: {
        peer: this.getSelf()
      },
      timestamp: Date.now()
    };

    this.channel.postMessage(message);
  }

  /**
   * Handle sync request
   */
  private async handleSyncRequest(message: PeerMessage): Promise<void> {
    console.log(`[KBPeerSync] Sync request from ${message.senderName}`);

    // Export current knowledge
    const data = await KBExporter.exportAll();

    // Send response
    this.sendSyncResponse(message.senderId, data);
  }

  /**
   * Send sync response
   */
  private sendSyncResponse(targetId: string, data: unknown): void {
    if (!this.channel) return;

    const message: PeerMessage = {
      id: this.generateId(),
      type: 'sync_response',
      senderId: this.localPeerId,
      senderName: this.localPeerName,
      targetId,
      payload: data,
      timestamp: Date.now()
    };

    this.channel.postMessage(message);

    console.log(`[KBPeerSync] Sent sync data to ${targetId}`);
  }

  /**
   * Handle sync response
   */
  private async handleSyncResponse(message: PeerMessage): Promise<void> {
    console.log(`[KBPeerSync] Received sync data from ${message.senderName}`);

    try {
      const data = message.payload as Parameters<typeof KBImporter.importData>[0];
      const stats = await KBImporter.importData(data, {
        mergeStrategy: 'merge'
      });

      console.log(`[KBPeerSync] Imported:`, stats);

      EventBus.emit('kb:peer:synced', {
        peerId: message.senderId,
        stats
      });

    } catch (error) {
      console.error('[KBPeerSync] Failed to import sync data:', error);
    }
  }

  /**
   * Handle knowledge update
   */
  private handleKnowledgeUpdate(message: PeerMessage): void {
    const payload = message.payload as KnowledgeUpdatePayload;

    if (!payload) return;

    console.log(`[KBPeerSync] Received ${payload.updateType} from ${message.senderName}`);

    // Import the update
    this.applyKnowledgeUpdate(payload);

    EventBus.emit('kb:peer:update', {
      peerId: message.senderId,
      updateType: payload.updateType
    });
  }

  /**
   * Apply knowledge update locally
   */
  private async applyKnowledgeUpdate(payload: KnowledgeUpdatePayload): Promise<void> {
    try {
      switch (payload.updateType) {
        case 'pattern':
          // Patterns are derived, just note the update
          console.log('[KBPeerSync] Pattern update received');
          break;

        case 'rule':
          // Import single rule
          await KBImporter.importData({
            version: '1.0',
            exportedAt: Date.now(),
            exportedBy: 'peer',
            rules: [payload.data],
            feedback: [],
            decisions: [],
            humanFeedback: [],
            patterns: [],
            knowledge: [],
            documents: [],
            entities: [],
            relationships: [],
            skills: [],
            stats: { totalPatterns: 0, totalRules: 1, totalKnowledge: 0, totalDocuments: 0, totalEntities: 0 }
          });
          break;

        case 'knowledge':
          await KBImporter.importData({
            version: '1.0',
            exportedAt: Date.now(),
            exportedBy: 'peer',
            knowledge: [payload.data],
            feedback: [],
            decisions: [],
            humanFeedback: [],
            patterns: [],
            rules: [],
            documents: [],
            entities: [],
            relationships: [],
            skills: [],
            stats: { totalPatterns: 0, totalRules: 0, totalKnowledge: 1, totalDocuments: 0, totalEntities: 0 }
          });
          break;

        case 'document':
          await KBImporter.importData({
            version: '1.0',
            exportedAt: Date.now(),
            exportedBy: 'peer',
            documents: [payload.data],
            feedback: [],
            decisions: [],
            humanFeedback: [],
            patterns: [],
            rules: [],
            knowledge: [],
            entities: [],
            relationships: [],
            skills: [],
            stats: { totalPatterns: 0, totalRules: 0, totalKnowledge: 0, totalDocuments: 1, totalEntities: 0 }
          });
          break;
      }
    } catch (error) {
      console.error('[KBPeerSync] Failed to apply update:', error);
    }
  }

  /**
   * Handle ping
   */
  private handlePing(message: PeerMessage): void {
    this.sendPong(message.senderId);

    // Update peer last seen
    const peer = this.peers.get(message.senderId);
    if (peer) {
      peer.lastSeen = Date.now();
    }
  }

  /**
   * Handle pong
   */
  private handlePong(message: PeerMessage): void {
    const peer = this.peers.get(message.senderId);
    if (peer) {
      peer.lastSeen = Date.now();
    }
  }

  /**
   * Send pong response
   */
  private sendPong(targetId: string): void {
    if (!this.channel) return;

    const message: PeerMessage = {
      id: this.generateId(),
      type: 'pong',
      senderId: this.localPeerId,
      senderName: this.localPeerName,
      targetId,
      timestamp: Date.now()
    };

    this.channel.postMessage(message);
  }

  /**
   * Ping all peers
   */
  private pingAllPeers(): void {
    if (!this.channel) return;

    const message: PeerMessage = {
      id: this.generateId(),
      type: 'ping',
      senderId: this.localPeerId,
      senderName: this.localPeerName,
      timestamp: Date.now()
    };

    this.channel.postMessage(message);
  }

  /**
   * Request sync from a specific peer
   */
  requestSync(targetPeerId?: string): void {
    if (!this.channel) return;

    const message: PeerMessage = {
      id: this.generateId(),
      type: 'sync_request',
      senderId: this.localPeerId,
      senderName: this.localPeerName,
      targetId: targetPeerId,
      timestamp: Date.now()
    };

    this.channel.postMessage(message);

    console.log(`[KBPeerSync] Requested sync from ${targetPeerId || 'all peers'}`);
  }

  /**
   * Broadcast knowledge update to all peers
   */
  broadcastUpdate(updateType: KnowledgeUpdatePayload['updateType'], data: unknown): void {
    if (!this.channel) return;

    const message: PeerMessage = {
      id: this.generateId(),
      type: 'knowledge_update',
      senderId: this.localPeerId,
      senderName: this.localPeerName,
      payload: {
        updateType,
        data
      } as KnowledgeUpdatePayload,
      timestamp: Date.now()
    };

    this.channel.postMessage(message);

    console.log(`[KBPeerSync] Broadcast ${updateType} update`);
  }

  /**
   * Get connected peers
   */
  getPeers(): PeerInfo[] {
    this.cleanupStalePeers();
    return Array.from(this.peers.values());
  }

  /**
   * Get peer by ID
   */
  getPeer(peerId: string): PeerInfo | undefined {
    return this.peers.get(peerId);
  }

  /**
   * Check if peer is connected
   */
  isPeerConnected(peerId: string): boolean {
    const peer = this.peers.get(peerId);
    if (!peer) return false;

    return Date.now() - peer.lastSeen < 60000;
  }

  /**
   * Cleanup stale peers
   */
  private cleanupStalePeers(): void {
    const now = Date.now();
    const staleThreshold = 120000; // 2 minutes

    for (const [peerId, peer] of this.peers) {
      if (now - peer.lastSeen > staleThreshold) {
        this.peers.delete(peerId);
        console.log(`[KBPeerSync] Peer ${peer.name} went offline`);

        EventBus.emit('kb:peer:offline', { peerId, peer });
      }
    }
  }

  /**
   * Set local peer name
   */
  setName(name: string): void {
    this.localPeerName = name;
    localStorage.setItem('agentOS_peerName', name);

    // Re-announce with new name
    this.announcePresence();
  }

  /**
   * Get local peer ID
   */
  getLocalPeerId(): string {
    return this.localPeerId;
  }

  /**
   * Get local peer name
   */
  getLocalPeerName(): string {
    return this.localPeerName;
  }

  /**
   * Check if P2P is available
   */
  isAvailable(): boolean {
    return typeof BroadcastChannel !== 'undefined';
  }

  /**
   * Check if initialized
   */
  isReady(): boolean {
    return this.isInitialized;
  }

  /**
   * Get peer count
   */
  getPeerCount(): number {
    this.cleanupStalePeers();
    return this.peers.size;
  }

  /**
   * Report status
   */
  reportStatus(): string {
    const peers = this.getPeers();

    const lines = [
      '## P2P Sync Status',
      '',
      `**Local Peer:** ${this.localPeerName} (${this.localPeerId})`,
      `**Available:** ${this.isAvailable() ? 'Yes' : 'No'}`,
      `**Initialized:** ${this.isInitialized ? 'Yes' : 'No'}`,
      `**Connected Peers:** ${peers.length}`,
      ''
    ];

    if (peers.length > 0) {
      lines.push('### Connected Peers');
      for (const peer of peers) {
        const lastSeen = new Date(peer.lastSeen).toLocaleTimeString();
        lines.push(`- ${peer.name} (${peer.id.slice(0, 10)}...) - Last seen: ${lastSeen}`);
      }
    }

    return lines.join('\n');
  }
}

// Export singleton
export const KBPeerSync = new KBPeerSyncClass();

// Export class for testing
export { KBPeerSyncClass };
