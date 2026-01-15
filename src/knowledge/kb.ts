/**
 * KnowledgeBase - IndexedDB-backed persistent storage for AgentOS
 *
 * Provides scalable cross-session knowledge storage with:
 * - Document storage
 * - Entity extraction
 * - Relationship mapping
 * - Full-text search
 */

import { EventBus } from '../core/event-bus.js';

/** Database configuration */
const DB_NAME = 'AgentOS_KnowledgeBase';
const DB_VERSION = 1;

/** Store names */
export const STORES = {
  DOCUMENTS: 'documents',
  ENTITIES: 'entities',
  RELATIONSHIPS: 'relationships',
  SKILLS: 'generated_skills',
  DECISIONS: 'decisions',
  FEEDBACK: 'feedback'
} as const;

/** Document source types */
export type DocumentSource = 'jira' | 'confluence' | 'github' | 'slack' | 'scraped' | 'manual';

/** Document stored in KB */
export interface KBDocument {
  id: string;
  url: string;
  title: string;
  content: string;
  extractedAt: number;
  source: DocumentSource;
  metadata?: Record<string, unknown>;
  tags?: string[];
}

/** Entity types */
export type EntityType = 'person' | 'project' | 'ticket' | 'concept' | 'file' | 'function' | 'error';

/** Entity stored in KB */
export interface KBEntity {
  id: string;
  type: EntityType;
  name: string;
  properties: Record<string, unknown>;
  documentRefs: string[];
  createdAt: number;
  updatedAt: number;
}

/** Relationship between entities */
export interface KBRelationship {
  id: string;
  from: string;
  to: string;
  type: string;
  weight: number;
  metadata?: Record<string, unknown>;
  createdAt: number;
}

/** Generated skill from patterns */
export interface KBSkill {
  id: string;
  name: string;
  pattern: string;
  generatedFrom: string[];
  occurrences: number;
  successRate: number;
  averageDuration: number;
  createdAt: number;
  updatedAt: number;
}

/** KnowledgeBase class */
class KnowledgeBaseClass {
  private db: IDBDatabase | null = null;
  private initPromise: Promise<void> | null = null;

  /**
   * Initialize the database
   */
  async init(): Promise<void> {
    if (this.db) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => {
        console.error('[KnowledgeBase] Failed to open database:', request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        this.db = request.result;
        console.log('[KnowledgeBase] Database opened successfully');
        EventBus.emit('kb:ready');
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        this.createStores(db);
      };
    });

    return this.initPromise;
  }

  /**
   * Create object stores on first load
   */
  private createStores(db: IDBDatabase): void {
    // Documents store
    if (!db.objectStoreNames.contains(STORES.DOCUMENTS)) {
      const docStore = db.createObjectStore(STORES.DOCUMENTS, { keyPath: 'id' });
      docStore.createIndex('url', 'url', { unique: false });
      docStore.createIndex('source', 'source', { unique: false });
      docStore.createIndex('extractedAt', 'extractedAt', { unique: false });
      docStore.createIndex('title', 'title', { unique: false });
    }

    // Entities store
    if (!db.objectStoreNames.contains(STORES.ENTITIES)) {
      const entityStore = db.createObjectStore(STORES.ENTITIES, { keyPath: 'id' });
      entityStore.createIndex('type', 'type', { unique: false });
      entityStore.createIndex('name', 'name', { unique: false });
    }

    // Relationships store
    if (!db.objectStoreNames.contains(STORES.RELATIONSHIPS)) {
      const relStore = db.createObjectStore(STORES.RELATIONSHIPS, { keyPath: 'id' });
      relStore.createIndex('from', 'from', { unique: false });
      relStore.createIndex('to', 'to', { unique: false });
      relStore.createIndex('type', 'type', { unique: false });
    }

    // Skills store
    if (!db.objectStoreNames.contains(STORES.SKILLS)) {
      const skillStore = db.createObjectStore(STORES.SKILLS, { keyPath: 'id' });
      skillStore.createIndex('name', 'name', { unique: true });
      skillStore.createIndex('successRate', 'successRate', { unique: false });
    }

    // Decisions store (for self-improvement)
    if (!db.objectStoreNames.contains(STORES.DECISIONS)) {
      const decisionStore = db.createObjectStore(STORES.DECISIONS, { keyPath: 'id' });
      decisionStore.createIndex('agentId', 'agentId', { unique: false });
      decisionStore.createIndex('agentType', 'agentType', { unique: false });
      decisionStore.createIndex('timestamp', 'timestamp', { unique: false });
    }

    // Feedback store (for self-improvement)
    if (!db.objectStoreNames.contains(STORES.FEEDBACK)) {
      const feedbackStore = db.createObjectStore(STORES.FEEDBACK, { keyPath: 'id' });
      feedbackStore.createIndex('agentId', 'agentId', { unique: false });
      feedbackStore.createIndex('type', 'type', { unique: false });
      feedbackStore.createIndex('timestamp', 'timestamp', { unique: false });
    }

    console.log('[KnowledgeBase] Object stores created');
  }

  /**
   * Ensure database is ready
   */
  private async ensureReady(): Promise<IDBDatabase> {
    await this.init();
    if (!this.db) {
      throw new Error('Database not initialized');
    }
    return this.db;
  }

  /**
   * Generic put operation
   */
  async put<T>(storeName: string, data: T): Promise<void> {
    const db = await this.ensureReady();

    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const request = store.put(data);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Generic get operation
   */
  async get<T>(storeName: string, key: string): Promise<T | undefined> {
    const db = await this.ensureReady();

    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const request = store.get(key);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Generic getAll operation
   */
  async getAll<T>(storeName: string): Promise<T[]> {
    const db = await this.ensureReady();

    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const request = store.getAll();

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Generic delete operation
   */
  async delete(storeName: string, key: string): Promise<void> {
    const db = await this.ensureReady();

    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const request = store.delete(key);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Query by index
   */
  async queryByIndex<T>(
    storeName: string,
    indexName: string,
    value: IDBValidKey
  ): Promise<T[]> {
    const db = await this.ensureReady();

    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const index = store.index(indexName);
      const request = index.getAll(value);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Count records in store
   */
  async count(storeName: string): Promise<number> {
    const db = await this.ensureReady();

    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const request = store.count();

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Clear a store
   */
  async clearStore(storeName: string): Promise<void> {
    const db = await this.ensureReady();

    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const request = store.clear();

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get database statistics
   */
  async getStats(): Promise<Record<string, number>> {
    await this.ensureReady();

    const stats: Record<string, number> = {};

    for (const storeName of Object.values(STORES)) {
      stats[storeName] = await this.count(storeName);
    }

    return stats;
  }

  /**
   * Close database connection
   */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
      this.initPromise = null;
      console.log('[KnowledgeBase] Database closed');
    }
  }

  /**
   * Delete the entire database
   */
  async destroy(): Promise<void> {
    this.close();

    return new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase(DB_NAME);
      request.onsuccess = () => {
        console.log('[KnowledgeBase] Database deleted');
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
  }
}

// Export singleton instance
export const KnowledgeBase = new KnowledgeBaseClass();

// Also export class for testing
export { KnowledgeBaseClass };
