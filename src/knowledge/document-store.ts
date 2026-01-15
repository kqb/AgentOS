/**
 * DocumentStore - Document management for KnowledgeBase
 *
 * Handles storage and retrieval of scraped/extracted documents.
 */

import { EventBus } from '../core/event-bus.js';
import { KnowledgeBase, STORES, KBDocument, DocumentSource } from './kb.js';

/** Options for adding a document */
export interface AddDocumentOptions {
  url: string;
  title: string;
  content: string;
  source: DocumentSource;
  metadata?: Record<string, unknown>;
  tags?: string[];
}

/** Query options for documents */
export interface DocumentQueryOptions {
  source?: DocumentSource;
  tags?: string[];
  since?: number;
  limit?: number;
}

/** Document store singleton */
class DocumentStoreClass {
  /**
   * Generate unique document ID
   */
  private generateId(): string {
    return `doc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  /**
   * Add a document to the knowledge base
   */
  async add(options: AddDocumentOptions): Promise<KBDocument> {
    const doc: KBDocument = {
      id: this.generateId(),
      url: options.url,
      title: options.title,
      content: options.content,
      source: options.source,
      extractedAt: Date.now(),
      metadata: options.metadata,
      tags: options.tags || []
    };

    await KnowledgeBase.put(STORES.DOCUMENTS, doc);

    EventBus.emit('kb:document:added', {
      id: doc.id,
      url: doc.url,
      source: doc.source
    });

    console.log(`[DocumentStore] Added document: ${doc.title} (${doc.id})`);
    return doc;
  }

  /**
   * Get document by ID
   */
  async get(id: string): Promise<KBDocument | undefined> {
    return KnowledgeBase.get<KBDocument>(STORES.DOCUMENTS, id);
  }

  /**
   * Get document by URL
   */
  async getByUrl(url: string): Promise<KBDocument | undefined> {
    const docs = await KnowledgeBase.queryByIndex<KBDocument>(
      STORES.DOCUMENTS,
      'url',
      url
    );
    return docs[0];
  }

  /**
   * Get all documents
   */
  async getAll(): Promise<KBDocument[]> {
    return KnowledgeBase.getAll<KBDocument>(STORES.DOCUMENTS);
  }

  /**
   * Query documents with filters
   */
  async query(options: DocumentQueryOptions = {}): Promise<KBDocument[]> {
    let docs = await this.getAll();

    // Filter by source
    if (options.source) {
      docs = docs.filter(d => d.source === options.source);
    }

    // Filter by tags
    if (options.tags && options.tags.length > 0) {
      docs = docs.filter(d =>
        options.tags!.some(tag => d.tags?.includes(tag))
      );
    }

    // Filter by time
    if (options.since) {
      docs = docs.filter(d => d.extractedAt >= options.since!);
    }

    // Sort by extraction time (newest first)
    docs.sort((a, b) => b.extractedAt - a.extractedAt);

    // Apply limit
    if (options.limit && options.limit > 0) {
      docs = docs.slice(0, options.limit);
    }

    return docs;
  }

  /**
   * Get documents by source
   */
  async getBySource(source: DocumentSource): Promise<KBDocument[]> {
    return KnowledgeBase.queryByIndex<KBDocument>(
      STORES.DOCUMENTS,
      'source',
      source
    );
  }

  /**
   * Update a document
   */
  async update(id: string, updates: Partial<AddDocumentOptions>): Promise<KBDocument | undefined> {
    const existing = await this.get(id);
    if (!existing) {
      console.warn(`[DocumentStore] Document not found: ${id}`);
      return undefined;
    }

    const updated: KBDocument = {
      ...existing,
      ...updates,
      extractedAt: Date.now()
    };

    await KnowledgeBase.put(STORES.DOCUMENTS, updated);

    EventBus.emit('kb:document:updated', { id });

    return updated;
  }

  /**
   * Delete a document
   */
  async delete(id: string): Promise<void> {
    await KnowledgeBase.delete(STORES.DOCUMENTS, id);
    EventBus.emit('kb:document:deleted', { id });
    console.log(`[DocumentStore] Deleted document: ${id}`);
  }

  /**
   * Search documents by content (basic text search)
   */
  async search(query: string, limit = 10): Promise<KBDocument[]> {
    const docs = await this.getAll();
    const lowerQuery = query.toLowerCase();

    // Score documents by relevance
    const scored = docs
      .map(doc => {
        const titleMatch = doc.title.toLowerCase().includes(lowerQuery);
        const contentMatch = doc.content.toLowerCase().includes(lowerQuery);
        const tagMatch = doc.tags?.some(t => t.toLowerCase().includes(lowerQuery));

        let score = 0;
        if (titleMatch) score += 10;
        if (contentMatch) score += 5;
        if (tagMatch) score += 3;

        // Count occurrences in content
        const contentLower = doc.content.toLowerCase();
        let idx = 0;
        let occurrences = 0;
        while ((idx = contentLower.indexOf(lowerQuery, idx)) !== -1) {
          occurrences++;
          idx += lowerQuery.length;
        }
        score += Math.min(occurrences, 10);

        return { doc, score };
      })
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(item => item.doc);

    return scored;
  }

  /**
   * Get document count
   */
  async count(): Promise<number> {
    return KnowledgeBase.count(STORES.DOCUMENTS);
  }

  /**
   * Get recent documents
   */
  async getRecent(limit = 10): Promise<KBDocument[]> {
    return this.query({ limit });
  }

  /**
   * Check if document exists by URL
   */
  async exists(url: string): Promise<boolean> {
    const doc = await this.getByUrl(url);
    return doc !== undefined;
  }

  /**
   * Add or update document (upsert by URL)
   */
  async upsert(options: AddDocumentOptions): Promise<KBDocument> {
    const existing = await this.getByUrl(options.url);

    if (existing) {
      const updated = await this.update(existing.id, options);
      return updated!;
    }

    return this.add(options);
  }
}

// Export singleton
export const DocumentStore = new DocumentStoreClass();

// Export class for testing
export { DocumentStoreClass };
