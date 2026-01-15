/**
 * Query - Semantic search and query engine for KnowledgeBase
 *
 * Provides unified search across documents, entities, and relationships.
 */

import { EventBus } from '../core/event-bus.js';
import { KBDocument, KBEntity, KBRelationship } from './kb.js';
import { DocumentStore } from './document-store.js';
import { EntityStore } from './entity-store.js';
import { RelationshipStore } from './relationship-store.js';

/** Search result types */
export type SearchResultType = 'document' | 'entity' | 'relationship';

/** Unified search result */
export interface SearchResult {
  type: SearchResultType;
  id: string;
  title: string;
  snippet: string;
  score: number;
  data: KBDocument | KBEntity | KBRelationship;
}

/** Search options */
export interface SearchOptions {
  /** Types to include in search */
  types?: SearchResultType[];
  /** Maximum results */
  limit?: number;
  /** Minimum score threshold */
  minScore?: number;
  /** Filter by source (documents only) */
  source?: string;
  /** Filter by entity type */
  entityType?: string;
}

/** Context about a topic */
export interface TopicContext {
  topic: string;
  documents: KBDocument[];
  entities: KBEntity[];
  relationships: KBRelationship[];
  summary: string;
}

/** Query engine singleton */
class QueryEngineClass {
  /**
   * Calculate text similarity score (simple term frequency)
   */
  private calculateScore(text: string, query: string): number {
    const textLower = text.toLowerCase();
    const queryTerms = query.toLowerCase().split(/\s+/).filter(t => t.length > 2);

    if (queryTerms.length === 0) return 0;

    let score = 0;

    for (const term of queryTerms) {
      // Exact word match
      if (textLower.includes(term)) {
        score += 1;

        // Bonus for exact word boundaries
        const wordBoundaryRegex = new RegExp(`\\b${term}\\b`, 'gi');
        const matches = textLower.match(wordBoundaryRegex);
        if (matches) {
          score += matches.length * 0.5;
        }
      }
    }

    // Normalize by query length
    return score / queryTerms.length;
  }

  /**
   * Extract snippet around match
   */
  private extractSnippet(text: string, query: string, maxLength = 150): string {
    const lowerText = text.toLowerCase();
    const lowerQuery = query.toLowerCase();

    // Find first occurrence
    const idx = lowerText.indexOf(lowerQuery.split(/\s+/)[0] || '');

    if (idx === -1) {
      return text.slice(0, maxLength) + (text.length > maxLength ? '...' : '');
    }

    // Extract around the match
    const start = Math.max(0, idx - 50);
    const end = Math.min(text.length, idx + maxLength);

    let snippet = text.slice(start, end);

    if (start > 0) snippet = '...' + snippet;
    if (end < text.length) snippet = snippet + '...';

    return snippet;
  }

  /**
   * Unified search across all knowledge types
   */
  async search(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    const {
      types = ['document', 'entity', 'relationship'],
      limit = 20,
      minScore = 0.1,
      source,
      entityType
    } = options;

    const results: SearchResult[] = [];

    // Search documents
    if (types.includes('document')) {
      let docs = await DocumentStore.search(query, limit);

      if (source) {
        docs = docs.filter(d => d.source === source);
      }

      for (const doc of docs) {
        const textToScore = `${doc.title} ${doc.content} ${doc.tags?.join(' ') || ''}`;
        const score = this.calculateScore(textToScore, query);

        if (score >= minScore) {
          results.push({
            type: 'document',
            id: doc.id,
            title: doc.title,
            snippet: this.extractSnippet(doc.content, query),
            score,
            data: doc
          });
        }
      }
    }

    // Search entities
    if (types.includes('entity')) {
      let entities = await EntityStore.search(query, limit);

      if (entityType) {
        entities = entities.filter(e => e.type === entityType);
      }

      for (const entity of entities) {
        const textToScore = `${entity.name} ${JSON.stringify(entity.properties)}`;
        const score = this.calculateScore(textToScore, query);

        if (score >= minScore) {
          results.push({
            type: 'entity',
            id: entity.id,
            title: `${entity.type}: ${entity.name}`,
            snippet: JSON.stringify(entity.properties).slice(0, 150),
            score,
            data: entity
          });
        }
      }
    }

    // Search relationships (by type)
    if (types.includes('relationship')) {
      const allRels = await RelationshipStore.getAll();

      for (const rel of allRels) {
        const textToScore = `${rel.type} ${rel.from} ${rel.to}`;
        const score = this.calculateScore(textToScore, query);

        if (score >= minScore) {
          results.push({
            type: 'relationship',
            id: rel.id,
            title: `${rel.from} -[${rel.type}]-> ${rel.to}`,
            snippet: JSON.stringify(rel.metadata || {}).slice(0, 150),
            score,
            data: rel
          });
        }
      }
    }

    // Sort by score and limit
    results.sort((a, b) => b.score - a.score);

    EventBus.emit('kb:search', { query, resultCount: results.length });

    return results.slice(0, limit);
  }

  /**
   * Build context about a topic
   */
  async buildContext(topic: string, maxItems = 10): Promise<TopicContext> {
    // Search for relevant items
    const results = await this.search(topic, { limit: maxItems * 3 });

    const documents: KBDocument[] = [];
    const entities: KBEntity[] = [];
    const relationships: KBRelationship[] = [];

    for (const result of results) {
      switch (result.type) {
        case 'document':
          if (documents.length < maxItems) {
            documents.push(result.data as KBDocument);
          }
          break;
        case 'entity':
          if (entities.length < maxItems) {
            entities.push(result.data as KBEntity);
          }
          break;
        case 'relationship':
          if (relationships.length < maxItems) {
            relationships.push(result.data as KBRelationship);
          }
          break;
      }
    }

    // Build summary
    const docTitles = documents.map(d => d.title).join(', ');
    const entityNames = entities.map(e => e.name).join(', ');

    const summary = `Found ${documents.length} documents, ${entities.length} entities, ` +
      `and ${relationships.length} relationships related to "${topic}". ` +
      (docTitles ? `Key documents: ${docTitles}. ` : '') +
      (entityNames ? `Key entities: ${entityNames}.` : '');

    return {
      topic,
      documents,
      entities,
      relationships,
      summary
    };
  }

  /**
   * Find related entities through relationships
   */
  async findRelated(entityId: string, maxDepth = 2): Promise<KBEntity[]> {
    const traversal = await RelationshipStore.traverse(entityId, maxDepth);
    const relatedIds = new Set(traversal.map(t => t.entityId));

    const entities: KBEntity[] = [];
    for (const id of relatedIds) {
      const entity = await EntityStore.get(id);
      if (entity) {
        entities.push(entity);
      }
    }

    return entities;
  }

  /**
   * Get documents mentioning an entity
   */
  async getDocumentsForEntity(entityId: string): Promise<KBDocument[]> {
    const entity = await EntityStore.get(entityId);
    if (!entity) return [];

    const documents: KBDocument[] = [];
    for (const docId of entity.documentRefs) {
      const doc = await DocumentStore.get(docId);
      if (doc) {
        documents.push(doc);
      }
    }

    return documents;
  }

  /**
   * Semantic similarity between two texts (basic Jaccard)
   */
  calculateSimilarity(text1: string, text2: string): number {
    const words1 = new Set(text1.toLowerCase().split(/\s+/).filter(w => w.length > 2));
    const words2 = new Set(text2.toLowerCase().split(/\s+/).filter(w => w.length > 2));

    if (words1.size === 0 || words2.size === 0) return 0;

    const intersection = new Set([...words1].filter(w => words2.has(w)));
    const union = new Set([...words1, ...words2]);

    return intersection.size / union.size;
  }

  /**
   * Find similar documents
   */
  async findSimilarDocuments(documentId: string, limit = 5): Promise<KBDocument[]> {
    const targetDoc = await DocumentStore.get(documentId);
    if (!targetDoc) return [];

    const allDocs = await DocumentStore.getAll();
    const scored = allDocs
      .filter(d => d.id !== documentId)
      .map(doc => ({
        doc,
        similarity: this.calculateSimilarity(
          `${targetDoc.title} ${targetDoc.content}`,
          `${doc.title} ${doc.content}`
        )
      }))
      .filter(item => item.similarity > 0.1)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);

    return scored.map(s => s.doc);
  }

  /**
   * Autocomplete suggestions
   */
  async autocomplete(prefix: string, limit = 10): Promise<string[]> {
    const suggestions = new Set<string>();
    const lowerPrefix = prefix.toLowerCase();

    // Get entity names
    const entities = await EntityStore.getAll();
    for (const entity of entities) {
      if (entity.name.toLowerCase().startsWith(lowerPrefix)) {
        suggestions.add(entity.name);
      }
    }

    // Get document titles
    const documents = await DocumentStore.getAll();
    for (const doc of documents) {
      if (doc.title.toLowerCase().startsWith(lowerPrefix)) {
        suggestions.add(doc.title);
      }
    }

    // Get tags
    for (const doc of documents) {
      for (const tag of doc.tags || []) {
        if (tag.toLowerCase().startsWith(lowerPrefix)) {
          suggestions.add(tag);
        }
      }
    }

    return Array.from(suggestions).slice(0, limit);
  }

  /**
   * Get knowledge base statistics
   */
  async getStats(): Promise<{
    documents: number;
    entities: number;
    relationships: number;
    entityTypes: Record<string, number>;
    relationTypes: Record<string, number>;
    sources: Record<string, number>;
  }> {
    const documents = await DocumentStore.getAll();
    const entities = await EntityStore.getAll();
    const relationships = await RelationshipStore.getAll();

    const entityTypes: Record<string, number> = {};
    const relationTypes: Record<string, number> = {};
    const sources: Record<string, number> = {};

    for (const entity of entities) {
      entityTypes[entity.type] = (entityTypes[entity.type] || 0) + 1;
    }

    for (const rel of relationships) {
      relationTypes[rel.type] = (relationTypes[rel.type] || 0) + 1;
    }

    for (const doc of documents) {
      sources[doc.source] = (sources[doc.source] || 0) + 1;
    }

    return {
      documents: documents.length,
      entities: entities.length,
      relationships: relationships.length,
      entityTypes,
      relationTypes,
      sources
    };
  }
}

// Export singleton
export const QueryEngine = new QueryEngineClass();

// Export class for testing
export { QueryEngineClass };
