/**
 * EntityStore - Entity management for KnowledgeBase
 *
 * Handles storage and retrieval of extracted entities:
 * - People (developers, reviewers, etc.)
 * - Projects
 * - Tickets
 * - Concepts
 * - Files
 * - Functions
 * - Errors
 */

import { EventBus } from '../core/event-bus.js';
import { KnowledgeBase, STORES, KBEntity, EntityType } from './kb.js';

/** Options for creating an entity */
export interface CreateEntityOptions {
  type: EntityType;
  name: string;
  properties?: Record<string, unknown>;
  documentRefs?: string[];
}

/** Entity query options */
export interface EntityQueryOptions {
  type?: EntityType;
  name?: string;
  limit?: number;
}

/** Entity store singleton */
class EntityStoreClass {
  /**
   * Generate unique entity ID
   */
  private generateId(type: EntityType): string {
    return `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  /**
   * Create a new entity
   */
  async create(options: CreateEntityOptions): Promise<KBEntity> {
    const entity: KBEntity = {
      id: this.generateId(options.type),
      type: options.type,
      name: options.name,
      properties: options.properties || {},
      documentRefs: options.documentRefs || [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    await KnowledgeBase.put(STORES.ENTITIES, entity);

    EventBus.emit('kb:entity:created', {
      id: entity.id,
      type: entity.type,
      name: entity.name
    });

    console.log(`[EntityStore] Created entity: ${entity.type}/${entity.name}`);
    return entity;
  }

  /**
   * Get entity by ID
   */
  async get(id: string): Promise<KBEntity | undefined> {
    return KnowledgeBase.get<KBEntity>(STORES.ENTITIES, id);
  }

  /**
   * Get all entities
   */
  async getAll(): Promise<KBEntity[]> {
    return KnowledgeBase.getAll<KBEntity>(STORES.ENTITIES);
  }

  /**
   * Get entities by type
   */
  async getByType(type: EntityType): Promise<KBEntity[]> {
    return KnowledgeBase.queryByIndex<KBEntity>(STORES.ENTITIES, 'type', type);
  }

  /**
   * Get entities by name (exact match)
   */
  async getByName(name: string): Promise<KBEntity[]> {
    return KnowledgeBase.queryByIndex<KBEntity>(STORES.ENTITIES, 'name', name);
  }

  /**
   * Find entity by type and name
   */
  async findByTypeAndName(type: EntityType, name: string): Promise<KBEntity | undefined> {
    const entities = await this.getByType(type);
    return entities.find(e => e.name === name);
  }

  /**
   * Query entities with filters
   */
  async query(options: EntityQueryOptions = {}): Promise<KBEntity[]> {
    let entities = await this.getAll();

    if (options.type) {
      entities = entities.filter(e => e.type === options.type);
    }

    if (options.name) {
      const lowerName = options.name.toLowerCase();
      entities = entities.filter(e =>
        e.name.toLowerCase().includes(lowerName)
      );
    }

    // Sort by update time (newest first)
    entities.sort((a, b) => b.updatedAt - a.updatedAt);

    if (options.limit && options.limit > 0) {
      entities = entities.slice(0, options.limit);
    }

    return entities;
  }

  /**
   * Update an entity
   */
  async update(id: string, updates: Partial<CreateEntityOptions>): Promise<KBEntity | undefined> {
    const existing = await this.get(id);
    if (!existing) {
      console.warn(`[EntityStore] Entity not found: ${id}`);
      return undefined;
    }

    const updated: KBEntity = {
      ...existing,
      ...updates,
      properties: {
        ...existing.properties,
        ...(updates.properties || {})
      },
      updatedAt: Date.now()
    };

    await KnowledgeBase.put(STORES.ENTITIES, updated);

    EventBus.emit('kb:entity:updated', { id });

    return updated;
  }

  /**
   * Add document reference to entity
   */
  async addDocumentRef(entityId: string, documentId: string): Promise<void> {
    const entity = await this.get(entityId);
    if (!entity) {
      console.warn(`[EntityStore] Entity not found: ${entityId}`);
      return;
    }

    if (!entity.documentRefs.includes(documentId)) {
      entity.documentRefs.push(documentId);
      entity.updatedAt = Date.now();
      await KnowledgeBase.put(STORES.ENTITIES, entity);
    }
  }

  /**
   * Remove document reference from entity
   */
  async removeDocumentRef(entityId: string, documentId: string): Promise<void> {
    const entity = await this.get(entityId);
    if (!entity) return;

    const idx = entity.documentRefs.indexOf(documentId);
    if (idx > -1) {
      entity.documentRefs.splice(idx, 1);
      entity.updatedAt = Date.now();
      await KnowledgeBase.put(STORES.ENTITIES, entity);
    }
  }

  /**
   * Delete an entity
   */
  async delete(id: string): Promise<void> {
    await KnowledgeBase.delete(STORES.ENTITIES, id);
    EventBus.emit('kb:entity:deleted', { id });
    console.log(`[EntityStore] Deleted entity: ${id}`);
  }

  /**
   * Get or create entity (upsert)
   */
  async getOrCreate(options: CreateEntityOptions): Promise<KBEntity> {
    const existing = await this.findByTypeAndName(options.type, options.name);

    if (existing) {
      // Merge properties and refs
      const mergedProps = { ...existing.properties, ...(options.properties || {}) };
      const mergedRefs = [...new Set([
        ...existing.documentRefs,
        ...(options.documentRefs || [])
      ])];

      return this.update(existing.id, {
        properties: mergedProps,
        documentRefs: mergedRefs
      }) as Promise<KBEntity>;
    }

    return this.create(options);
  }

  /**
   * Search entities by name
   */
  async search(query: string, limit = 10): Promise<KBEntity[]> {
    const entities = await this.getAll();
    const lowerQuery = query.toLowerCase();

    return entities
      .filter(e => e.name.toLowerCase().includes(lowerQuery))
      .sort((a, b) => {
        // Exact match first
        const aExact = a.name.toLowerCase() === lowerQuery ? 1 : 0;
        const bExact = b.name.toLowerCase() === lowerQuery ? 1 : 0;
        if (aExact !== bExact) return bExact - aExact;

        // Then by starts with
        const aStarts = a.name.toLowerCase().startsWith(lowerQuery) ? 1 : 0;
        const bStarts = b.name.toLowerCase().startsWith(lowerQuery) ? 1 : 0;
        if (aStarts !== bStarts) return bStarts - aStarts;

        // Then by update time
        return b.updatedAt - a.updatedAt;
      })
      .slice(0, limit);
  }

  /**
   * Get entity count
   */
  async count(): Promise<number> {
    return KnowledgeBase.count(STORES.ENTITIES);
  }

  /**
   * Get counts by type
   */
  async countByType(): Promise<Record<EntityType, number>> {
    const entities = await this.getAll();
    const counts: Record<string, number> = {};

    for (const entity of entities) {
      counts[entity.type] = (counts[entity.type] || 0) + 1;
    }

    return counts as Record<EntityType, number>;
  }

  /**
   * Get entities referenced by a document
   */
  async getByDocumentRef(documentId: string): Promise<KBEntity[]> {
    const entities = await this.getAll();
    return entities.filter(e => e.documentRefs.includes(documentId));
  }
}

// Export singleton
export const EntityStore = new EntityStoreClass();

// Export class for testing
export { EntityStoreClass };
