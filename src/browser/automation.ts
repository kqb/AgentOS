/**
 * Browser Automation
 *
 * Provides browser control capabilities:
 * - Tab management
 * - DOM interaction
 * - Navigation
 * - Wait utilities
 */

import { EventBus } from '../core/event-bus.js';

/** Click options */
export interface ClickOptions {
  button?: 'left' | 'right' | 'middle';
  clickCount?: number;
  delay?: number;
}

/** Type options */
export interface TypeOptions {
  delay?: number;
  clearFirst?: boolean;
}

/** Wait options */
export interface WaitOptions {
  timeout?: number;
  visible?: boolean;
  hidden?: boolean;
}

/**
 * Browser Automation class
 */
class BrowserAutomationClass {
  private debugMode = false;

  /**
   * Navigate to a URL
   */
  async navigate(url: string): Promise<boolean> {
    if (this.debugMode) {
      console.log(`[Browser] Navigating to: ${url}`);
    }

    try {
      window.location.href = url;
      EventBus.emit('browser:navigated', { url });
      return true;
    } catch (error) {
      EventBus.emit('browser:navigate:error', { url, error });
      return false;
    }
  }

  /**
   * Wait for navigation to complete
   */
  async waitForNavigation(timeout = 30000): Promise<boolean> {
    return new Promise((resolve) => {
      const startTime = Date.now();

      const checkReady = () => {
        if (document.readyState === 'complete') {
          EventBus.emit('browser:navigation:complete', {});
          resolve(true);
        } else if (Date.now() - startTime > timeout) {
          EventBus.emit('browser:navigation:timeout', {});
          resolve(false);
        } else {
          requestAnimationFrame(checkReady);
        }
      };

      checkReady();
    });
  }

  /**
   * Wait for a selector to appear
   */
  async waitForSelector(
    selector: string,
    options: WaitOptions = {}
  ): Promise<Element | null> {
    const { timeout = 30000, visible = true, hidden = false } = options;
    const startTime = Date.now();

    if (this.debugMode) {
      console.log(`[Browser] Waiting for selector: ${selector}`);
    }

    return new Promise((resolve) => {
      const check = () => {
        const element = document.querySelector(selector);

        if (element) {
          const isVisible = this.isElementVisible(element);

          if (hidden && !isVisible) {
            resolve(element);
            return;
          }

          if (visible && isVisible) {
            resolve(element);
            return;
          }

          if (!visible && !hidden) {
            resolve(element);
            return;
          }
        }

        if (Date.now() - startTime > timeout) {
          resolve(null);
          return;
        }

        requestAnimationFrame(check);
      };

      check();
    });
  }

  /**
   * Wait for multiple selectors (any)
   */
  async waitForAny(
    selectors: string[],
    timeout = 30000
  ): Promise<{ selector: string; element: Element } | null> {
    const startTime = Date.now();

    return new Promise((resolve) => {
      const check = () => {
        for (const selector of selectors) {
          const element = document.querySelector(selector);
          if (element && this.isElementVisible(element)) {
            resolve({ selector, element });
            return;
          }
        }

        if (Date.now() - startTime > timeout) {
          resolve(null);
          return;
        }

        requestAnimationFrame(check);
      };

      check();
    });
  }

  /**
   * Click an element
   */
  async click(
    selector: string,
    options: ClickOptions = {}
  ): Promise<boolean> {
    const element = await this.waitForSelector(selector);
    if (!element) {
      if (this.debugMode) {
        console.log(`[Browser] Click failed - element not found: ${selector}`);
      }
      return false;
    }

    if (this.debugMode) {
      console.log(`[Browser] Clicking: ${selector}`);
    }

    try {
      if (options.delay) {
        await this.sleep(options.delay);
      }

      const clickEvent = new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        button: options.button === 'right' ? 2 : options.button === 'middle' ? 1 : 0
      });

      const clickCount = options.clickCount || 1;
      for (let i = 0; i < clickCount; i++) {
        element.dispatchEvent(clickEvent);
      }

      EventBus.emit('browser:clicked', { selector });
      return true;
    } catch (error) {
      EventBus.emit('browser:click:error', { selector, error });
      return false;
    }
  }

  /**
   * Type text into an element
   */
  async type(
    selector: string,
    text: string,
    options: TypeOptions = {}
  ): Promise<boolean> {
    const element = await this.waitForSelector(selector) as HTMLInputElement | HTMLTextAreaElement | null;
    if (!element) {
      return false;
    }

    if (this.debugMode) {
      console.log(`[Browser] Typing into: ${selector}`);
    }

    try {
      // Focus the element
      element.focus();

      // Clear if requested
      if (options.clearFirst) {
        element.value = '';
        element.dispatchEvent(new Event('input', { bubbles: true }));
      }

      // Type character by character if delay specified
      if (options.delay) {
        for (const char of text) {
          element.value += char;
          element.dispatchEvent(new Event('input', { bubbles: true }));
          await this.sleep(options.delay);
        }
      } else {
        element.value += text;
        element.dispatchEvent(new Event('input', { bubbles: true }));
      }

      EventBus.emit('browser:typed', { selector, length: text.length });
      return true;
    } catch (error) {
      EventBus.emit('browser:type:error', { selector, error });
      return false;
    }
  }

  /**
   * Get element text content
   */
  async getText(selector: string): Promise<string | null> {
    const element = await this.waitForSelector(selector, { timeout: 5000 });
    return element?.textContent?.trim() || null;
  }

  /**
   * Get element attribute
   */
  async getAttribute(selector: string, attribute: string): Promise<string | null> {
    const element = await this.waitForSelector(selector, { timeout: 5000 });
    return element?.getAttribute(attribute) || null;
  }

  /**
   * Check if element exists
   */
  exists(selector: string): boolean {
    return document.querySelector(selector) !== null;
  }

  /**
   * Check if element is visible
   */
  isVisible(selector: string): boolean {
    const element = document.querySelector(selector);
    return element ? this.isElementVisible(element) : false;
  }

  /**
   * Check element visibility
   */
  private isElementVisible(element: Element): boolean {
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();

    return (
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      parseFloat(style.opacity) > 0 &&
      rect.width > 0 &&
      rect.height > 0
    );
  }

  /**
   * Scroll to element
   */
  async scrollTo(selector: string): Promise<boolean> {
    const element = document.querySelector(selector);
    if (!element) return false;

    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await this.sleep(300); // Wait for scroll animation
    return true;
  }

  /**
   * Execute JavaScript in page context
   */
  evaluate<T>(fn: () => T): T {
    return fn();
  }

  /**
   * Take a screenshot (data URL)
   */
  async screenshot(): Promise<string | null> {
    // Note: Full screenshot requires canvas manipulation
    // This is a simplified version that captures visible area
    try {
      const canvas = document.createElement('canvas');
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;

      // This won't capture the actual page due to security restrictions
      // In a real implementation, you'd need different approaches
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Get current URL
   */
  getUrl(): string {
    return window.location.href;
  }

  /**
   * Get page title
   */
  getTitle(): string {
    return document.title;
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Enable debug mode
   */
  enableDebug(): void {
    this.debugMode = true;
  }

  /**
   * Disable debug mode
   */
  disableDebug(): void {
    this.debugMode = false;
  }
}

// Export singleton instance
export const BrowserAutomation = new BrowserAutomationClass();

// Also export the class for testing
export { BrowserAutomationClass };
