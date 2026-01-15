/**
 * ContextExtractor - Meaningful data extraction from pages
 *
 * Extracts structured data:
 * - Ticket information
 * - PR details
 * - User info
 * - Table data
 */

import { EventBus } from '../core/event-bus.js';
import { SemanticAnalyzer, PageType } from './semantic.js';

/** Ticket information */
export interface TicketInfo {
  id: string;
  title: string;
  status: string;
  assignee?: string;
  priority?: string;
  labels?: string[];
  description?: string;
  url: string;
  source: 'jira' | 'github' | 'linear' | 'unknown';
}

/** PR information */
export interface PRInfo {
  id: string;
  title: string;
  status: 'open' | 'merged' | 'closed' | 'draft';
  author: string;
  reviewers?: string[];
  branch: string;
  baseBranch: string;
  additions?: number;
  deletions?: number;
  url: string;
}

/** User information */
export interface UserInfo {
  id?: string;
  name: string;
  email?: string;
  avatar?: string;
  role?: string;
}

/** Table data */
export interface TableData {
  headers: string[];
  rows: string[][];
  caption?: string;
  element: HTMLTableElement;
}

/** Page context */
export interface PageContext {
  url: string;
  title: string;
  type: PageType;
  ticket?: TicketInfo;
  pr?: PRInfo;
  user?: UserInfo;
  tables: TableData[];
  metadata: Record<string, string>;
}

/** Context extractor singleton */
class ContextExtractorClass {
  /**
   * Extract ticket information
   */
  extractTicketInfo(doc: Document = document): TicketInfo | null {
    const url = doc.location?.href || '';

    // Jira
    if (/atlassian\.net|jira/i.test(url)) {
      return this.extractJiraTicket(doc);
    }

    // GitHub Issues
    if (/github\.com.*\/issues\//i.test(url)) {
      return this.extractGitHubIssue(doc);
    }

    // Linear
    if (/linear\.app/i.test(url)) {
      return this.extractLinearTicket(doc);
    }

    return null;
  }

  /**
   * Extract Jira ticket
   */
  private extractJiraTicket(doc: Document): TicketInfo | null {
    try {
      const id = doc.querySelector('[data-testid="issue.views.issue-base.foundation.breadcrumbs.current-issue.item"] span, .issue-link')?.textContent?.trim();
      const title = doc.querySelector('[data-testid="issue.views.issue-base.foundation.summary.heading"], #summary-val')?.textContent?.trim();
      const status = doc.querySelector('[data-testid="issue.views.issue-base.foundation.status.status-field-wrapper"] span, #status-val')?.textContent?.trim();
      const assignee = doc.querySelector('[data-testid="issue.views.field.user.assignee"] span, #assignee-val')?.textContent?.trim();
      const priority = doc.querySelector('[data-testid="issue.views.field.priority"] span, #priority-val')?.textContent?.trim();

      if (!id) return null;

      return {
        id,
        title: title || 'Untitled',
        status: status || 'unknown',
        assignee: assignee || undefined,
        priority: priority || undefined,
        url: doc.location.href,
        source: 'jira'
      };
    } catch {
      return null;
    }
  }

  /**
   * Extract GitHub issue
   */
  private extractGitHubIssue(doc: Document): TicketInfo | null {
    try {
      const titleEl = doc.querySelector('.js-issue-title, .gh-header-title');
      const title = titleEl?.textContent?.trim();

      const match = doc.location.href.match(/\/issues\/(\d+)/);
      const id = match ? `#${match[1]}` : '';

      const statusEl = doc.querySelector('.State, .IssueLabel--green, .IssueLabel--purple');
      const status = statusEl?.textContent?.trim() || 'open';

      const assigneeEl = doc.querySelector('.assignee .assignee-avatar, [data-hovercard-type="user"]');
      const assignee = assigneeEl?.getAttribute('alt') || assigneeEl?.textContent?.trim();

      const labels = Array.from(doc.querySelectorAll('.IssueLabel, .labels .label'))
        .map(el => el.textContent?.trim())
        .filter(Boolean) as string[];

      if (!id) return null;

      return {
        id,
        title: title || 'Untitled',
        status,
        assignee: assignee || undefined,
        labels,
        url: doc.location.href,
        source: 'github'
      };
    } catch {
      return null;
    }
  }

  /**
   * Extract Linear ticket
   */
  private extractLinearTicket(doc: Document): TicketInfo | null {
    try {
      const titleEl = doc.querySelector('[data-testid="issue-title"], h1');
      const title = titleEl?.textContent?.trim();

      const idEl = doc.querySelector('[data-testid="issue-identifier"]');
      const id = idEl?.textContent?.trim() || '';

      if (!id) return null;

      return {
        id,
        title: title || 'Untitled',
        status: 'unknown',
        url: doc.location.href,
        source: 'linear'
      };
    } catch {
      return null;
    }
  }

  /**
   * Extract PR information
   */
  extractPRInfo(doc: Document = document): PRInfo | null {
    const url = doc.location?.href || '';

    // GitHub PR
    if (/github\.com.*\/pull\//i.test(url)) {
      return this.extractGitHubPR(doc);
    }

    return null;
  }

  /**
   * Extract GitHub PR
   */
  private extractGitHubPR(doc: Document): PRInfo | null {
    try {
      const titleEl = doc.querySelector('.js-issue-title, .gh-header-title');
      const title = titleEl?.textContent?.trim();

      const match = doc.location.href.match(/\/pull\/(\d+)/);
      const id = match ? `#${match[1]}` : '';

      const statusEl = doc.querySelector('.State');
      const statusText = statusEl?.textContent?.trim()?.toLowerCase() || 'open';

      let status: 'open' | 'merged' | 'closed' | 'draft' = 'open';
      if (statusText.includes('merged')) status = 'merged';
      else if (statusText.includes('closed')) status = 'closed';
      else if (statusText.includes('draft')) status = 'draft';

      const authorEl = doc.querySelector('.author, .pull-header-username');
      const author = authorEl?.textContent?.trim() || 'unknown';

      const branchEl = doc.querySelector('.commit-ref.head-ref, .head-ref');
      const branch = branchEl?.textContent?.trim() || '';

      const baseEl = doc.querySelector('.commit-ref.base-ref, .base-ref');
      const baseBranch = baseEl?.textContent?.trim() || 'main';

      const additionsEl = doc.querySelector('.additions, .text-green');
      const deletionsEl = doc.querySelector('.deletions, .text-red');

      const additions = parseInt(additionsEl?.textContent?.replace(/\D/g, '') || '0', 10);
      const deletions = parseInt(deletionsEl?.textContent?.replace(/\D/g, '') || '0', 10);

      if (!id) return null;

      return {
        id,
        title: title || 'Untitled',
        status,
        author,
        branch,
        baseBranch,
        additions,
        deletions,
        url: doc.location.href
      };
    } catch {
      return null;
    }
  }

  /**
   * Extract user information
   */
  extractUserInfo(doc: Document = document): UserInfo | null {
    try {
      // Try common user profile patterns
      const nameEl = doc.querySelector('.user-name, .username, [data-testid="user-name"], .profile-name');
      const name = nameEl?.textContent?.trim();

      if (!name) return null;

      const emailEl = doc.querySelector('.user-email, [data-testid="user-email"], input[type="email"]');
      const email = emailEl?.textContent?.trim() || (emailEl as HTMLInputElement)?.value;

      const avatarEl = doc.querySelector('.avatar, .user-avatar, img[alt*="avatar"]');
      const avatar = (avatarEl as HTMLImageElement)?.src;

      const roleEl = doc.querySelector('.user-role, [data-testid="user-role"]');
      const role = roleEl?.textContent?.trim();

      return {
        name,
        email: email || undefined,
        avatar: avatar || undefined,
        role: role || undefined
      };
    } catch {
      return null;
    }
  }

  /**
   * Extract table data
   */
  extractTableData(doc: Document = document): TableData[] {
    const tables: TableData[] = [];

    doc.querySelectorAll('table').forEach(table => {
      const headers: string[] = [];
      const rows: string[][] = [];

      // Extract headers
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

      // Extract rows
      table.querySelectorAll('tbody tr, tr').forEach((tr, idx) => {
        // Skip header row if we used it
        if (idx === 0 && headers.length > 0) return;

        const row: string[] = [];
        tr.querySelectorAll('td, th').forEach(cell => {
          row.push(cell.textContent?.trim() || '');
        });

        if (row.length > 0) {
          rows.push(row);
        }
      });

      const captionEl = table.querySelector('caption');
      const caption = captionEl?.textContent?.trim();

      tables.push({
        headers,
        rows,
        caption,
        element: table
      });
    });

    return tables;
  }

  /**
   * Build complete page context
   */
  buildPageContext(doc: Document = document): PageContext {
    const context: PageContext = {
      url: doc.location?.href || '',
      title: doc.title || '',
      type: SemanticAnalyzer.identifyPageType(doc),
      tables: this.extractTableData(doc),
      metadata: this.extractMetadata(doc)
    };

    // Try to extract structured data
    const ticket = this.extractTicketInfo(doc);
    if (ticket) context.ticket = ticket;

    const pr = this.extractPRInfo(doc);
    if (pr) context.pr = pr;

    const user = this.extractUserInfo(doc);
    if (user) context.user = user;

    EventBus.emit('context:extracted', {
      url: context.url,
      type: context.type,
      hasTicket: !!ticket,
      hasPR: !!pr
    });

    return context;
  }

  /**
   * Extract page metadata
   */
  private extractMetadata(doc: Document): Record<string, string> {
    const metadata: Record<string, string> = {};

    // Meta tags
    doc.querySelectorAll('meta[name], meta[property]').forEach(meta => {
      const name = meta.getAttribute('name') || meta.getAttribute('property');
      const content = meta.getAttribute('content');

      if (name && content) {
        metadata[name] = content;
      }
    });

    // Open Graph
    doc.querySelectorAll('meta[property^="og:"]').forEach(meta => {
      const property = meta.getAttribute('property');
      const content = meta.getAttribute('content');

      if (property && content) {
        metadata[property] = content;
      }
    });

    return metadata;
  }
}

// Export singleton
export const ContextExtractor = new ContextExtractorClass();

// Export class for testing
export { ContextExtractorClass };
