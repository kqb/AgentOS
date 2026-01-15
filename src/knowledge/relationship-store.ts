/**
 * RelationshipStore - Relationship management for KnowledgeBase
 *
 * Handles storage and retrieval of relationships between entities:
 * - Person -> Project (works_on)
 * - Person -> Ticket (assigned_to, created_by)
 * - Ticket -> Project (belongs_to)
 * - File -> Function (contains)
 * - Error -> File (occurred_in)
 */

import { EventBus } from '../core/event-bus.js';
import { KnowledgeBase, STORES, KBRelationship } from './kb.js';

/** Common relationship types */
export type RelationType =
  | 'works_on'
  | 'assigned_to'
  | 'created_by'
  | 'reviewed_by'
  | 'belongs_to'
  | 'contains'
  | 'occurred_in'
  | 'depends_on'
  | 'related_to'
  | 'fixes'
  | 'implements'
  | 'mentions'
  | 'causes'
  | 'blocks';

/** Options for creating a relationship */
export interface CreateRelationshipOptions {
  from: string;
  to: string;
  type: string;
  weight?: number;
  metadata?: Record<string, unknown>;
}

/** Relationship query options */
export interface RelationshipQueryOptions {
  from?: string;
  to?: string;
  type?: string;
  minWeight?: number;
  limit?: number;
}

/** Graph traversal result */
export interface TraversalResult {
  entityId: string;
  depth: number;
  path: string[];
  relationship: KBRelationship;
}

/** Relationship store singleton */
class RelationshipStoreClass {
  /**
   * Generate unique relationship ID
   */
  private generateId(): string {
    return `rel-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  /**
   * Create a new relationship
   */
  async create(options: CreateRelationshipOptions): Promise<KBRelationship> {
    const relationship: KBRelationship = {
      id: this.generateId(),
      from: options.from,
      to: options.to,
      type: options.type,
      weight: options.weight ?? 1.0,
      metadata: options.metadata,
      createdAt: Date.now()
    };

    await KnowledgeBase.put(STORES.RELATIONSHIPS, relationship);

    EventBus.emit('kb:relationship:created', {
      id: relationship.id,
      from: relationship.from,
      to: relationship.to,
      type: relationship.type
    });

    console.log(`[RelationshipStore] Created: ${options.from} -[${options.type}]-> ${options.to}`);
    return relationship;
  }

  /**
   * Get relationship by ID
   */
  async get(id: string): Promise<KBRelationship | undefined> {
    return KnowledgeBase.get<KBRelationship>(STORES.RELATIONSHIPS, id);
  }

  /**
   * Get all relationships
   */
  async getAll(): Promise<KBRelationship[]> {
    return KnowledgeBase.getAll<KBRelationship>(STORES.RELATIONSHIPS);
  }

  /**
   * Get relationships from an entity
   */
  async getFrom(entityId: string): Promise<KBRelationship[]> {
    return KnowledgeBase.queryByIndex<KBRelationship>(
      STORES.RELATIONSHIPS,
      'from',
      entityId
    );
  }

  /**
   * Get relationships to an entity
   */
  async getTo(entityId: string): Promise<KBRelationship[]> {
    return KnowledgeBase.queryByIndex<KBRelationship>(
      STORES.RELATIONSHIPS,
      'to',
      entityId
    );
  }

  /**
   * Get relationships by type
   */
  async getByType(type: string): Promise<KBRelationship[]> {
    return KnowledgeBase.queryByIndex<KBRelationship>(
      STORES.RELATIONSHIPS,
      'type',
      type
    );
  }

  /**
   * Query relationships with filters
   */
  async query(options: RelationshipQueryOptions = {}): Promise<KBRelationship[]> {
    let relationships = await this.getAll();

    if (options.from) {
      relationships = relationships.filter(r => r.from === options.from);
    }

    if (options.to) {
      relationships = relationships.filter(r => r.to === options.to);
    }

    if (options.type) {
      relationships = relationships.filter(r => r.type === options.type);
    }

    if (options.minWeight !== undefined) {
      relationships = relationships.filter(r => r.weight >= options.minWeight!);
    }

    // Sort by weight (descending)
    relationships.sort((a, b) => b.weight - a.weight);

    if (options.limit && options.limit > 0) {
      relationships = relationships.slice(0, options.limit);
    }

    return relationships;
  }

  /**
   * Find specific relationship
   */
  async find(from: string, to: string, type: string): Promise<KBRelationship | undefined> {
    const relationships = await this.query({ from, to, type, limit: 1 });
    return relationships[0];
  }

  /**
   * Update relationship weight
   */
  async updateWeight(id: string, weight: number): Promise<KBRelationship | undefined> {
    const existing = await this.get(id);
    if (!existing) return undefined;

    existing.weight = weight;
    await KnowledgeBase.put(STORES.RELATIONSHIPS, existing);

    return existing;
  }

  /**
   * Increment relationship weight (for reinforcement)
   */
  async incrementWeight(from: string, to: string, type: string, delta = 0.1): Promise<KBRelationship> {
    let rel = await this.find(from, to, type);

    if (rel) {
      rel.weight = Math.min(rel.weight + delta, 1.0);
      await KnowledgeBase.put(STORES.RELATIONSHIPS, rel);
    } else {
      rel = await this.create({ from, to, type, weight: delta });
    }

    return rel;
  }

  /**
   * Delete a relationship
   */
  async delete(id: string): Promise<void> {
    await KnowledgeBase.delete(STORES.RELATIONSHIPS, id);
    EventBus.emit('kb:relationship:deleted', { id });
    console.log(`[RelationshipStore] Deleted relationship: ${id}`);
  }

  /**
   * Delete all relationships for an entity
   */
  async deleteForEntity(entityId: string): Promise<void> {
    const fromRels = await this.getFrom(entityId);
    const toRels = await this.getTo(entityId);

    for (const rel of [...fromRels, ...toRels]) {
      await this.delete(rel.id);
    }
  }

  /**
   * Get connected entities (neighbors)
   */
  async getNeighbors(entityId: string): Promise<string[]> {
    const fromRels = await this.getFrom(entityId);
    const toRels = await this.getTo(entityId);

    const neighbors = new Set<string>();

    for (const rel of fromRels) {
      neighbors.add(rel.to);
    }

    for (const rel of toRels) {
      neighbors.add(rel.from);
    }

    return Array.from(neighbors);
  }

  /**
   * Traverse graph from entity (BFS)
   */
  async traverse(
    startEntityId: string,
    maxDepth = 3,
    relationTypes?: string[]
  ): Promise<TraversalResult[]> {
    const results: TraversalResult[] = [];
    const visited = new Set<string>();
    const queue: Array<{ entityId: string; depth: number; path: string[] }> = [
      { entityId: startEntityId, depth: 0, path: [startEntityId] }
    ];

    while (queue.length > 0) {
      const { entityId, depth, path } = queue.shift()!;

      if (depth >= maxDepth) continue;
      if (visited.has(entityId)) continue;
      visited.add(entityId);

      const outgoing = await this.getFrom(entityId);

      for (const rel of outgoing) {
        if (relationTypes && !relationTypes.includes(rel.type)) continue;
        if (visited.has(rel.to)) continue;

        results.push({
          entityId: rel.to,
          depth: depth + 1,
          path: [...path, rel.to],
          relationship: rel
        });

        queue.push({
          entityId: rel.to,
          depth: depth + 1,
          path: [...path, rel.to]
        });
      }
    }

    return results;
  }

  /**
   * Find shortest path between entities
   */
  async findPath(
    fromEntityId: string,
    toEntityId: string,
    maxDepth = 5
  ): Promise<KBRelationship[] | null> {
    const visited = new Set<string>();
    const queue: Array<{ entityId: string; path: KBRelationship[] }> = [
      { entityId: fromEntityId, path: [] }
    ];

    while (queue.length > 0) {
      const { entityId, path } = queue.shift()!;

      if (entityId === toEntityId) {
        return path;
      }

      if (path.length >= maxDepth) continue;
      if (visited.has(entityId)) continue;
      visited.add(entityId);

      const outgoing = await this.getFrom(entityId);

      for (const rel of outgoing) {
        if (visited.has(rel.to)) continue;

        queue.push({
          entityId: rel.to,
          path: [...path, rel]
        });
      }
    }

    return null;
  }

  /**
   * Get relationship count
   */
  async count(): Promise<number> {
    return KnowledgeBase.count(STORES.RELATIONSHIPS);
  }

  /**
   * Get counts by type
   */
  async countByType(): Promise<Record<string, number>> {
    const relationships = await this.getAll();
    const counts: Record<string, number> = {};

    for (const rel of relationships) {
      counts[rel.type] = (counts[rel.type] || 0) + 1;
    }

    return counts;
  }
}

// Export singleton
export const RelationshipStore = new RelationshipStoreClass();

// Export class for testing
export { RelationshipStoreClass };
