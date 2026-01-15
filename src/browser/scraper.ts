/**
 * Page Scraper
 *
 * Extract structured data from web pages:
 * - Text content
 * - Tables
 * - Forms
 * - Links
 * - Metadata
 */

import { EventBus } from '../core/event-bus.js';
import { StateManager } from '../core/state-manager.js';

/** Scraped table data */
export interface ScrapedTable {
  headers: string[];
  rows: string[][];
  selector: string;
}

/** Scraped form data */
export interface ScrapedForm {
  action: string;
  method: string;
  fields: Array<{
    name: string;
    type: string;
    value: string;
    required: boolean;
  }>;
  selector: string;
}

/** Scraped link */
export interface ScrapedLink {
  text: string;
  href: string;
  external: boolean;
}

/** Page metadata */
export interface PageMetadata {
  title: string;
  description: string;
  keywords: string[];
  canonical: string | null;
  ogTags: Record<string, string>;
}

/** Scrape result */
export interface ScrapeResult {
  url: string;
  timestamp: number;
  metadata: PageMetadata;
  content: {
    text: string;
    headings: Array<{ level: number; text: string }>;
    paragraphs: string[];
  };
  tables: ScrapedTable[];
  forms: ScrapedForm[];
  links: ScrapedLink[];
}

/**
 * Page Scraper class
 */
class PageScraperClass {
  private cache: Map<string, ScrapeResult> = new Map();
  private cacheExpiry = 15 * 60 * 1000; // 15 minutes

  /**
   * Scrape the current page
   */
  scrape(): ScrapeResult {
    const url = window.location.href;
    const timestamp = Date.now();

    // Check cache
    const cached = this.cache.get(url);
    if (cached && timestamp - cached.timestamp < this.cacheExpiry) {
      return cached;
    }

    const result: ScrapeResult = {
      url,
      timestamp,
      metadata: this.scrapeMetadata(),
      content: this.scrapeContent(),
      tables: this.scrapeTables(),
      forms: this.scrapeForms(),
      links: this.scrapeLinks()
    };

    // Cache result
    this.cache.set(url, result);

    EventBus.emit('scraper:scraped', { url });

    return result;
  }

  /**
   * Scrape page metadata
   */
  private scrapeMetadata(): PageMetadata {
    const getMetaContent = (name: string): string => {
      const meta = document.querySelector(`meta[name="${name}"], meta[property="${name}"]`);
      return meta?.getAttribute('content') || '';
    };

    const ogTags: Record<string, string> = {};
    document.querySelectorAll('meta[property^="og:"]').forEach(meta => {
      const property = meta.getAttribute('property');
      const content = meta.getAttribute('content');
      if (property && content) {
        ogTags[property.replace('og:', '')] = content;
      }
    });

    const keywords = getMetaContent('keywords')
      .split(',')
      .map(k => k.trim())
      .filter(k => k.length > 0);

    const canonical = document.querySelector('link[rel="canonical"]')?.getAttribute('href') || null;

    return {
      title: document.title,
      description: getMetaContent('description'),
      keywords,
      canonical,
      ogTags
    };
  }

  /**
   * Scrape text content
   */
  private scrapeContent(): ScrapeResult['content'] {
    // Get main text content
    const mainElement = document.querySelector('main, article, [role="main"]') || document.body;
    const text = this.extractText(mainElement);

    // Get headings
    const headings: Array<{ level: number; text: string }> = [];
    document.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach(heading => {
      const level = parseInt(heading.tagName[1]);
      const headingText = heading.textContent?.trim() || '';
      if (headingText) {
        headings.push({ level, text: headingText });
      }
    });

    // Get paragraphs
    const paragraphs: string[] = [];
    mainElement.querySelectorAll('p').forEach(p => {
      const pText = p.textContent?.trim() || '';
      if (pText.length > 20) { // Filter out tiny paragraphs
        paragraphs.push(pText);
      }
    });

    return { text, headings, paragraphs };
  }

  /**
   * Extract text from element
   */
  private extractText(element: Element): string {
    // Clone to avoid modifying original
    const clone = element.cloneNode(true) as Element;

    // Remove script, style, and hidden elements
    clone.querySelectorAll('script, style, [hidden], [aria-hidden="true"]').forEach(el => {
      el.remove();
    });

    return clone.textContent?.trim().replace(/\s+/g, ' ') || '';
  }

  /**
   * Scrape tables
   */
  private scrapeTables(): ScrapedTable[] {
    const tables: ScrapedTable[] = [];

    document.querySelectorAll('table').forEach((table, index) => {
      const headers: string[] = [];
      const rows: string[][] = [];

      // Get headers
      table.querySelectorAll('thead th, thead td').forEach(th => {
        headers.push(th.textContent?.trim() || '');
      });

      // If no thead, try first row
      if (headers.length === 0) {
        const firstRow = table.querySelector('tr');
        firstRow?.querySelectorAll('th, td').forEach(cell => {
          headers.push(cell.textContent?.trim() || '');
        });
      }

      // Get rows
      table.querySelectorAll('tbody tr').forEach(tr => {
        const row: string[] = [];
        tr.querySelectorAll('td').forEach(td => {
          row.push(td.textContent?.trim() || '');
        });
        if (row.length > 0) {
          rows.push(row);
        }
      });

      // Generate a selector for the table
      const id = table.id ? `#${table.id}` : `table:nth-of-type(${index + 1})`;

      tables.push({
        headers,
        rows,
        selector: id
      });
    });

    return tables;
  }

  /**
   * Scrape forms
   */
  private scrapeForms(): ScrapedForm[] {
    const forms: ScrapedForm[] = [];

    document.querySelectorAll('form').forEach((form, index) => {
      const fields: ScrapedForm['fields'] = [];

      form.querySelectorAll('input, select, textarea').forEach(field => {
        const input = field as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
        const name = input.name || input.id || '';
        const type = input.type || field.tagName.toLowerCase();

        if (name && type !== 'hidden' && type !== 'submit') {
          fields.push({
            name,
            type,
            value: input.value || '',
            required: input.required
          });
        }
      });

      const id = form.id ? `#${form.id}` : `form:nth-of-type(${index + 1})`;

      forms.push({
        action: form.action || '',
        method: form.method || 'GET',
        fields,
        selector: id
      });
    });

    return forms;
  }

  /**
   * Scrape links
   */
  private scrapeLinks(): ScrapedLink[] {
    const links: ScrapedLink[] = [];
    const currentHost = window.location.host;

    document.querySelectorAll('a[href]').forEach(anchor => {
      const a = anchor as HTMLAnchorElement;
      const href = a.href;
      const text = a.textContent?.trim() || '';

      if (href && text && !href.startsWith('javascript:') && !href.startsWith('#')) {
        try {
          const url = new URL(href);
          links.push({
            text,
            href,
            external: url.host !== currentHost
          });
        } catch {
          // Invalid URL, skip
        }
      }
    });

    return links;
  }

  /**
   * Extract specific data using selector
   */
  extractBySelector(selector: string): string[] {
    const results: string[] = [];

    document.querySelectorAll(selector).forEach(el => {
      const text = el.textContent?.trim();
      if (text) {
        results.push(text);
      }
    });

    return results;
  }

  /**
   * Extract data using CSS selectors map
   */
  extractByMap(selectorMap: Record<string, string>): Record<string, string | null> {
    const result: Record<string, string | null> = {};

    for (const [key, selector] of Object.entries(selectorMap)) {
      const element = document.querySelector(selector);
      result[key] = element?.textContent?.trim() || null;
    }

    return result;
  }

  /**
   * Save scraped content to state
   */
  saveToState(key: string, result: ScrapeResult): void {
    StateManager.set('scraped', key, result);
    EventBus.emit('scraper:saved', { key, url: result.url });
  }

  /**
   * Get cached result
   */
  getCached(url: string): ScrapeResult | null {
    const cached = this.cache.get(url);
    if (cached && Date.now() - cached.timestamp < this.cacheExpiry) {
      return cached;
    }
    return null;
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache.clear();
    EventBus.emit('scraper:cache:cleared', {});
  }

  /**
   * Set cache expiry time
   */
  setCacheExpiry(ms: number): void {
    this.cacheExpiry = ms;
  }
}

// Export singleton instance
export const PageScraper = new PageScraperClass();

// Also export the class for testing
export { PageScraperClass };
