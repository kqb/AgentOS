/**
 * Knowledge Layer - IndexedDB-backed persistent storage for AgentOS
 *
 * Components:
 * - KnowledgeBase: Core IndexedDB wrapper
 * - DocumentStore: Document storage and retrieval
 * - EntityStore: Entity management
 * - RelationshipStore: Graph relationships
 * - QueryEngine: Unified search and context building
 */

// Core database
export {
  KnowledgeBase,
  KnowledgeBaseClass,
  STORES,
  type KBDocument,
  type KBEntity,
  type KBRelationship,
  type KBSkill,
  type DocumentSource,
  type EntityType
} from './kb.js';

// Document store
export {
  DocumentStore,
  DocumentStoreClass,
  type AddDocumentOptions,
  type DocumentQueryOptions
} from './document-store.js';

// Entity store
export {
  EntityStore,
  EntityStoreClass,
  type CreateEntityOptions,
  type EntityQueryOptions
} from './entity-store.js';

// Relationship store
export {
  RelationshipStore,
  RelationshipStoreClass,
  type RelationType,
  type CreateRelationshipOptions,
  type RelationshipQueryOptions,
  type TraversalResult
} from './relationship-store.js';

// Query engine
export {
  QueryEngine,
  QueryEngineClass,
  type SearchResult,
  type SearchResultType,
  type SearchOptions,
  type TopicContext
} from './query.js';

/**
 * Initialize all knowledge stores
 */
export async function initKnowledge(): Promise<void> {
  const { KnowledgeBase } = await import('./kb.js');
  await KnowledgeBase.init();
  console.log('[Knowledge] All stores initialized');
}

/**
 * Get unified knowledge statistics
 */
export async function getKnowledgeStats(): Promise<{
  documents: number;
  entities: number;
  relationships: number;
  ready: boolean;
}> {
  const { QueryEngine } = await import('./query.js');

  try {
    const stats = await QueryEngine.getStats();
    return {
      documents: stats.documents,
      entities: stats.entities,
      relationships: stats.relationships,
      ready: true
    };
  } catch {
    return {
      documents: 0,
      entities: 0,
      relationships: 0,
      ready: false
    };
  }
}
