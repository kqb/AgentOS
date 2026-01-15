/**
 * SemanticAnalyzer - Intelligent page understanding
 *
 * Analyzes web pages to understand:
 * - Page type and purpose
 * - Main content areas
 * - Navigation structure
 * - Available actions
 */

import { EventBus } from '../core/event-bus.js';

/** Page types */
export type PageType = 'login' | 'dashboard' | 'form' | 'list' | 'detail' | 'search' | 'settings' | 'error' | 'unknown';

/** Action element */
export interface ActionElement {
  element: Element;
  type: 'button' | 'link' | 'input' | 'select' | 'submit';
  label: string;
  action: string;
  priority: number;
}

/** Extracted entity */
export interface ExtractedEntity {
  type: string;
  name: string;
  value: unknown;
  element: Element;
  confidence: number;
}

/** Extracted relationship */
export interface ExtractedRelationship {
  from: string;
  to: string;
  type: string;
  context: string;
}

/** Page structure */
export interface PageStructure {
  type: PageType;
  mainContent: Element | null;
  navigation: Element[];
  actions: ActionElement[];
  forms: HTMLFormElement[];
  tables: HTMLTableElement[];
  headings: string[];
}

/** Semantic analyzer singleton */
class SemanticAnalyzerClass {
  /**
   * Identify page type
   */
  identifyPageType(doc: Document = document): PageType {
    const url = doc.location?.href || '';
    const title = doc.title?.toLowerCase() || '';
    const bodyText = doc.body?.innerText?.toLowerCase() || '';

    // URL-based hints
    if (/login|signin|auth/i.test(url)) return 'login';
    if (/dashboard|home|overview/i.test(url)) return 'dashboard';
    if (/search|results|find/i.test(url)) return 'search';
    if (/settings|preferences|config/i.test(url)) return 'settings';
    if (/error|404|500/i.test(url)) return 'error';

    // Content-based hints
    if (doc.querySelector('form[action*="login"], input[type="password"]')) {
      return 'login';
    }

    if (doc.querySelectorAll('table').length > 0 || doc.querySelectorAll('.list-item, [role="listitem"]').length > 3) {
      return 'list';
    }

    if (doc.querySelector('form:not([action*="search"])')) {
      return 'form';
    }

    // Title-based hints
    if (/dashboard|overview|summary/i.test(title)) return 'dashboard';
    if (/details?|view|show/i.test(title)) return 'detail';
    if (/error|not found|denied/i.test(title)) return 'error';

    // Default to detail for content-heavy pages
    if (bodyText.length > 1000) return 'detail';

    return 'unknown';
  }

  /**
   * Find main content area
   */
  findMainContent(doc: Document = document): Element | null {
    // Try common main content selectors
    const selectors = [
      'main',
      '[role="main"]',
      '#main-content',
      '#content',
      '.main-content',
      '.content',
      'article',
      '.article'
    ];

    for (const selector of selectors) {
      const element = doc.querySelector(selector);
      if (element) return element;
    }

    // Fall back to largest content block
    const blocks = doc.querySelectorAll('div, section');
    let largest: Element | null = null;
    let largestSize = 0;

    blocks.forEach(block => {
      const rect = block.getBoundingClientRect();
      const size = rect.width * rect.height;

      if (size > largestSize && rect.height > 200) {
        largestSize = size;
        largest = block;
      }
    });

    return largest;
  }

  /**
   * Find navigation elements
   */
  findNavigation(doc: Document = document): Element[] {
    const navElements: Element[] = [];

    // Standard nav elements
    doc.querySelectorAll('nav, [role="navigation"]').forEach(nav => {
      navElements.push(nav);
    });

    // Common navigation patterns
    doc.querySelectorAll('header ul, .navbar, .sidebar, .menu').forEach(nav => {
      if (!navElements.includes(nav)) {
        navElements.push(nav);
      }
    });

    return navElements;
  }

  /**
   * Find available actions
   */
  findActions(doc: Document = document): ActionElement[] {
    const actions: ActionElement[] = [];

    // Buttons
    doc.querySelectorAll('button, [role="button"], input[type="submit"], input[type="button"]').forEach(el => {
      const label = this.getElementLabel(el);
      if (label) {
        actions.push({
          element: el,
          type: el.tagName === 'INPUT' && (el as HTMLInputElement).type === 'submit' ? 'submit' : 'button',
          label,
          action: this.inferAction(label),
          priority: this.calculateActionPriority(el, label)
        });
      }
    });

    // Links that look like actions
    doc.querySelectorAll('a[href]').forEach(el => {
      const label = this.getElementLabel(el);
      const href = (el as HTMLAnchorElement).href;

      // Skip navigation links
      if (this.isNavigationLink(el as HTMLAnchorElement)) return;

      if (label && /create|add|new|edit|delete|save|submit|download/i.test(label)) {
        actions.push({
          element: el,
          type: 'link',
          label,
          action: this.inferAction(label),
          priority: this.calculateActionPriority(el, label)
        });
      }
    });

    // Sort by priority
    return actions.sort((a, b) => b.priority - a.priority);
  }

  /**
   * Get label for element
   */
  private getElementLabel(element: Element): string {
    // Try various label sources
    const sources = [
      element.getAttribute('aria-label'),
      element.getAttribute('title'),
      element.textContent?.trim(),
      (element as HTMLInputElement).value,
      element.getAttribute('name')
    ];

    for (const source of sources) {
      if (source && source.length > 0 && source.length < 100) {
        return source;
      }
    }

    return '';
  }

  /**
   * Infer action from label
   */
  private inferAction(label: string): string {
    const lower = label.toLowerCase();

    if (/save|submit|confirm|ok/i.test(lower)) return 'submit';
    if (/cancel|close|dismiss/i.test(lower)) return 'cancel';
    if (/delete|remove/i.test(lower)) return 'delete';
    if (/edit|modify|update/i.test(lower)) return 'edit';
    if (/create|add|new/i.test(lower)) return 'create';
    if (/search|find/i.test(lower)) return 'search';
    if (/download|export/i.test(lower)) return 'download';
    if (/upload|import/i.test(lower)) return 'upload';

    return 'click';
  }

  /**
   * Calculate action priority
   */
  private calculateActionPriority(element: Element, label: string): number {
    let priority = 0;

    // Primary buttons get higher priority
    if (element.classList.contains('primary') ||
        element.classList.contains('btn-primary') ||
        element.getAttribute('type') === 'submit') {
      priority += 10;
    }

    // Danger buttons get medium priority
    if (element.classList.contains('danger') ||
        element.classList.contains('btn-danger') ||
        /delete|remove/i.test(label)) {
      priority += 5;
    }

    // Visibility matters
    const rect = element.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      priority += 3;
    }

    // Above the fold
    if (rect.top < window.innerHeight) {
      priority += 2;
    }

    return priority;
  }

  /**
   * Check if link is navigation
   */
  private isNavigationLink(link: HTMLAnchorElement): boolean {
    const closestNav = link.closest('nav, [role="navigation"], .navbar, .sidebar');
    return closestNav !== null;
  }

  /**
   * Extract entities from page
   */
  extractEntities(doc: Document = document): ExtractedEntity[] {
    const entities: ExtractedEntity[] = [];

    // Extract from headings
    doc.querySelectorAll('h1, h2, h3').forEach(heading => {
      const text = heading.textContent?.trim();
      if (text && text.length < 100) {
        entities.push({
          type: 'heading',
          name: text,
          value: text,
          element: heading,
          confidence: 0.9
        });
      }
    });

    // Extract from data attributes
    doc.querySelectorAll('[data-id], [data-name], [data-value]').forEach(el => {
      const id = el.getAttribute('data-id');
      const name = el.getAttribute('data-name');
      const value = el.getAttribute('data-value');

      if (id || name) {
        entities.push({
          type: 'data-entity',
          name: name || id || 'unknown',
          value: { id, name, value },
          element: el,
          confidence: 0.8
        });
      }
    });

    // Extract from labeled elements
    doc.querySelectorAll('label').forEach(label => {
      const forId = label.getAttribute('for');
      const input = forId ? doc.getElementById(forId) : label.querySelector('input, select, textarea');

      if (input) {
        entities.push({
          type: 'field',
          name: label.textContent?.trim() || 'unknown',
          value: (input as HTMLInputElement).value,
          element: input,
          confidence: 0.85
        });
      }
    });

    return entities;
  }

  /**
   * Extract relationships from page
   */
  extractRelationships(doc: Document = document): ExtractedRelationship[] {
    const relationships: ExtractedRelationship[] = [];

    // Extract from links
    doc.querySelectorAll('a[href]').forEach(link => {
      const href = (link as HTMLAnchorElement).href;
      const text = link.textContent?.trim();

      if (text && href) {
        relationships.push({
          from: doc.title || 'current-page',
          to: text,
          type: 'links-to',
          context: href
        });
      }
    });

    // Extract from parent-child structures
    doc.querySelectorAll('[data-parent-id]').forEach(el => {
      const parentId = el.getAttribute('data-parent-id');
      const id = el.getAttribute('data-id') || el.id;

      if (parentId && id) {
        relationships.push({
          from: parentId,
          to: id,
          type: 'parent-of',
          context: el.className
        });
      }
    });

    return relationships;
  }

  /**
   * Analyze full page structure
   */
  analyze(doc: Document = document): PageStructure {
    const structure: PageStructure = {
      type: this.identifyPageType(doc),
      mainContent: this.findMainContent(doc),
      navigation: this.findNavigation(doc),
      actions: this.findActions(doc),
      forms: Array.from(doc.querySelectorAll('form')),
      tables: Array.from(doc.querySelectorAll('table')),
      headings: Array.from(doc.querySelectorAll('h1, h2, h3'))
        .map(h => h.textContent?.trim() || '')
        .filter(Boolean)
    };

    EventBus.emit('semantic:analyzed', { type: structure.type });

    return structure;
  }
}

// Export singleton
export const SemanticAnalyzer = new SemanticAnalyzerClass();

// Export class for testing
export { SemanticAnalyzerClass };
