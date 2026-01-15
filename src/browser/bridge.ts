/**
 * BrowserBridge - Cross-tab/window communication
 *
 * Enables communication between:
 * - Different browser tabs
 * - Iframes and parent windows
 * - Browser extension contexts
 */

import { EventBus } from '../core/event-bus.js';

/** Message types */
export type BridgeMessageType =
  | 'ping'
  | 'pong'
  | 'command'
  | 'response'
  | 'event'
  | 'sync'
  | 'broadcast';

/** Bridge message */
export interface BridgeMessage {
  id: string;
  type: BridgeMessageType;
  source: string;
  target?: string;
  channel: string;
  payload: unknown;
  timestamp: number;
}

/** Connected peer */
export interface BridgePeer {
  id: string;
  name: string;
  type: 'tab' | 'iframe' | 'extension' | 'worker';
  lastSeen: number;
  metadata?: Record<string, unknown>;
}

/** Message handler */
export type MessageHandler = (message: BridgeMessage) => void | Promise<void>;

/** Bridge configuration */
export interface BridgeConfig {
  channelName?: string;
  peerId?: string;
  peerName?: string;
  peerType?: BridgePeer['type'];
}

/** Browser bridge singleton */
class BrowserBridgeClass {
  private channel: BroadcastChannel | null = null;
  private peerId: string;
  private peerName: string;
  private peerType: BridgePeer['type'];
  private channelName: string;
  private peers: Map<string, BridgePeer> = new Map();
  private handlers: Map<string, Set<MessageHandler>> = new Map();
  private pendingResponses: Map<string, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
  }> = new Map();
  private initialized = false;

  constructor() {
    this.peerId = `peer-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    this.peerName = 'AgentOS';
    this.peerType = 'tab';
    this.channelName = 'agentOS-bridge';
  }

  /**
   * Initialize bridge
   */
  init(config?: BridgeConfig): void {
    if (this.initialized) return;

    if (config?.peerId) this.peerId = config.peerId;
    if (config?.peerName) this.peerName = config.peerName;
    if (config?.peerType) this.peerType = config.peerType;
    if (config?.channelName) this.channelName = config.channelName;

    // Create BroadcastChannel if available
    if (typeof BroadcastChannel !== 'undefined') {
      this.channel = new BroadcastChannel(this.channelName);
      this.channel.onmessage = this.handleMessage.bind(this);
    }

    // Also listen for postMessage
    window.addEventListener('message', this.handleWindowMessage.bind(this));

    // Register self
    this.peers.set(this.peerId, {
      id: this.peerId,
      name: this.peerName,
      type: this.peerType,
      lastSeen: Date.now()
    });

    // Announce presence
    this.broadcast('ping', { peer: this.getSelf() });

    this.initialized = true;
    console.log(`[BrowserBridge] Initialized as ${this.peerName} (${this.peerId})`);
  }

  /**
   * Get self peer info
   */
  getSelf(): BridgePeer {
    return {
      id: this.peerId,
      name: this.peerName,
      type: this.peerType,
      lastSeen: Date.now()
    };
  }

  /**
   * Generate message ID
   */
  private generateMessageId(): string {
    return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  /**
   * Handle incoming message
   */
  private async handleMessage(event: MessageEvent): Promise<void> {
    const message = event.data as BridgeMessage;

    // Ignore own messages
    if (message.source === this.peerId) return;

    // Verify message structure
    if (!message.id || !message.type || !message.source) return;

    // Update peer tracking
    if (message.type === 'ping' || message.type === 'pong') {
      const peer = (message.payload as { peer: BridgePeer })?.peer;
      if (peer) {
        this.peers.set(peer.id, {
          ...peer,
          lastSeen: Date.now()
        });
      }

      // Respond to pings
      if (message.type === 'ping') {
        this.send(message.source, 'pong', { peer: this.getSelf() });
      }
    }

    // Handle responses to our requests
    if (message.type === 'response' && message.target === this.peerId) {
      const pending = this.pendingResponses.get(message.id);
      if (pending) {
        clearTimeout(pending.timeout);
        this.pendingResponses.delete(message.id);
        pending.resolve(message.payload);
        return;
      }
    }

    // Call registered handlers
    const channelHandlers = this.handlers.get(message.channel);
    if (channelHandlers) {
      for (const handler of channelHandlers) {
        try {
          await handler(message);
        } catch (error) {
          console.error('[BrowserBridge] Handler error:', error);
        }
      }
    }

    // Emit event
    EventBus.emit('bridge:message', message);
  }

  /**
   * Handle window postMessage
   */
  private handleWindowMessage(event: MessageEvent): void {
    // Verify origin if needed
    const message = event.data;

    if (message?.channel === this.channelName) {
      this.handleMessage({ data: message } as MessageEvent);
    }
  }

  /**
   * Send message to specific peer
   */
  send(
    targetId: string,
    type: BridgeMessageType,
    payload: unknown,
    channel = 'default'
  ): void {
    const message: BridgeMessage = {
      id: this.generateMessageId(),
      type,
      source: this.peerId,
      target: targetId,
      channel,
      payload,
      timestamp: Date.now()
    };

    this.sendMessage(message);
  }

  /**
   * Broadcast message to all peers
   */
  broadcast(type: BridgeMessageType, payload: unknown, channel = 'default'): void {
    const message: BridgeMessage = {
      id: this.generateMessageId(),
      type,
      source: this.peerId,
      channel,
      payload,
      timestamp: Date.now()
    };

    this.sendMessage(message);
  }

  /**
   * Send message via available channels
   */
  private sendMessage(message: BridgeMessage): void {
    // Use BroadcastChannel if available
    if (this.channel) {
      this.channel.postMessage(message);
    }

    // Also try parent window if in iframe
    if (window.parent !== window) {
      try {
        window.parent.postMessage({ ...message, channel: this.channelName }, '*');
      } catch {
        // Parent might be cross-origin
      }
    }

    // Also post to iframes
    document.querySelectorAll('iframe').forEach(iframe => {
      try {
        iframe.contentWindow?.postMessage({ ...message, channel: this.channelName }, '*');
      } catch {
        // Iframe might be cross-origin
      }
    });
  }

  /**
   * Send command and wait for response
   */
  async sendCommand(
    targetId: string,
    command: string,
    args?: unknown,
    timeout = 5000
  ): Promise<unknown> {
    const messageId = this.generateMessageId();

    const promise = new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.pendingResponses.delete(messageId);
        reject(new Error('Command timeout'));
      }, timeout);

      this.pendingResponses.set(messageId, {
        resolve,
        reject,
        timeout: timeoutId
      });
    });

    const message: BridgeMessage = {
      id: messageId,
      type: 'command',
      source: this.peerId,
      target: targetId,
      channel: 'commands',
      payload: { command, args },
      timestamp: Date.now()
    };

    this.sendMessage(message);

    return promise;
  }

  /**
   * Register message handler
   */
  on(channel: string, handler: MessageHandler): () => void {
    if (!this.handlers.has(channel)) {
      this.handlers.set(channel, new Set());
    }

    this.handlers.get(channel)!.add(handler);

    // Return unsubscribe function
    return () => {
      this.handlers.get(channel)?.delete(handler);
    };
  }

  /**
   * Remove handler
   */
  off(channel: string, handler?: MessageHandler): void {
    if (handler) {
      this.handlers.get(channel)?.delete(handler);
    } else {
      this.handlers.delete(channel);
    }
  }

  /**
   * Get connected peers
   */
  getPeers(): BridgePeer[] {
    // Clean up stale peers (not seen in 30 seconds)
    const now = Date.now();
    for (const [id, peer] of this.peers) {
      if (id !== this.peerId && now - peer.lastSeen > 30000) {
        this.peers.delete(id);
      }
    }

    return Array.from(this.peers.values());
  }

  /**
   * Get peer by ID
   */
  getPeer(peerId: string): BridgePeer | undefined {
    return this.peers.get(peerId);
  }

  /**
   * Check if peer is connected
   */
  isPeerConnected(peerId: string): boolean {
    const peer = this.peers.get(peerId);
    if (!peer) return false;

    return Date.now() - peer.lastSeen < 30000;
  }

  /**
   * Discover peers
   */
  async discoverPeers(timeout = 2000): Promise<BridgePeer[]> {
    this.broadcast('ping', { peer: this.getSelf() });

    await new Promise(resolve => setTimeout(resolve, timeout));

    return this.getPeers();
  }

  /**
   * Close bridge
   */
  close(): void {
    if (this.channel) {
      this.channel.close();
      this.channel = null;
    }

    window.removeEventListener('message', this.handleWindowMessage.bind(this));

    // Clear pending responses
    for (const [id, pending] of this.pendingResponses) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Bridge closed'));
    }
    this.pendingResponses.clear();

    this.handlers.clear();
    this.peers.clear();

    this.initialized = false;

    console.log('[BrowserBridge] Closed');
  }
}

// Export singleton
export const BrowserBridge = new BrowserBridgeClass();

// Export class for testing
export { BrowserBridgeClass };
