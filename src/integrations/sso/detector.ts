/**
 * SSO Detector
 *
 * DOM-based detection of SSO login pages and MFA prompts.
 * Identifies the SSO provider and current authentication state.
 */

import { EventBus } from '../../core/event-bus.js';
import type { SsoProvider, SsoDetectionResult, SsoProviderDefinition } from '../../types/integration.js';
import { SSO_PROVIDERS, matchUrlToProvider, getProvider } from './providers.js';

/** Detection options */
interface DetectionOptions {
  checkMfa?: boolean;
  checkErrors?: boolean;
  timeout?: number;
}

/**
 * SSO Detector class
 */
class SsoDetectorClass {
  private lastDetection: SsoDetectionResult | null = null;
  private observing = false;
  private observer: MutationObserver | null = null;

  /**
   * Detect SSO page from current URL and DOM
   */
  detect(options: DetectionOptions = {}): SsoDetectionResult {
    const url = window.location.href;
    const provider = matchUrlToProvider(url);

    const result: SsoDetectionResult = {
      isSsoPage: false,
      provider: null,
      pageType: null,
      confidence: 0
    };

    if (!provider) {
      this.lastDetection = result;
      return result;
    }

    const definition = getProvider(provider);
    result.provider = provider;

    // Check for login form
    const loginFormScore = this.checkSelectors(definition.selectors.loginForm);
    const usernameScore = this.checkSelectors(definition.selectors.usernameField);
    const passwordScore = this.checkSelectors(definition.selectors.passwordField);

    // Check for MFA prompt
    const mfaScore = options.checkMfa !== false
      ? this.checkSelectors(definition.selectors.mfaPrompt)
      : 0;

    // Check for errors
    const errorScore = options.checkErrors !== false
      ? this.checkSelectors(definition.selectors.errorMessage)
      : 0;

    // Determine page type and confidence
    if (mfaScore > 0) {
      result.isSsoPage = true;
      result.pageType = 'mfa';
      result.confidence = Math.min(0.9 + mfaScore * 0.1, 1);
      result.mfaType = this.detectMfaType(definition);
    } else if (loginFormScore > 0 || (usernameScore > 0 && passwordScore > 0)) {
      result.isSsoPage = true;
      result.pageType = 'login';
      result.confidence = Math.min(
        0.5 + loginFormScore * 0.2 + usernameScore * 0.15 + passwordScore * 0.15,
        1
      );
    } else if (usernameScore > 0) {
      result.isSsoPage = true;
      result.pageType = 'username';
      result.confidence = 0.6 + usernameScore * 0.2;
    } else if (passwordScore > 0) {
      result.isSsoPage = true;
      result.pageType = 'password';
      result.confidence = 0.6 + passwordScore * 0.2;
    }

    if (errorScore > 0) {
      result.hasError = true;
      result.errorMessage = this.extractErrorMessage(definition);
    }

    this.lastDetection = result;

    // Emit detection event
    if (result.isSsoPage) {
      EventBus.emit('sso:detected', result);
    }

    return result;
  }

  /**
   * Check if selectors exist in DOM
   * Returns count of matching elements
   */
  private checkSelectors(selectorString: string): number {
    const selectors = selectorString.split(',').map(s => s.trim());
    let count = 0;

    for (const selector of selectors) {
      try {
        const elements = document.querySelectorAll(selector);
        count += elements.length;
      } catch {
        // Invalid selector, skip
      }
    }

    return count;
  }

  /**
   * Detect MFA type from DOM
   */
  private detectMfaType(definition: SsoProviderDefinition): string | undefined {
    // Look for specific MFA indicators
    const bodyText = document.body.innerText.toLowerCase();

    if (bodyText.includes('push') || bodyText.includes('approve')) {
      return 'push';
    }
    if (bodyText.includes('authenticator') || bodyText.includes('totp') || bodyText.includes('6-digit')) {
      return 'totp';
    }
    if (bodyText.includes('sms') || bodyText.includes('text message')) {
      return 'sms';
    }
    if (bodyText.includes('email') || bodyText.includes('e-mail')) {
      return 'email';
    }
    if (bodyText.includes('security key') || bodyText.includes('webauthn') || bodyText.includes('fido')) {
      return 'webauthn';
    }

    // Return first available method as default
    return definition.mfaMethods?.[0];
  }

  /**
   * Extract error message from DOM
   */
  private extractErrorMessage(definition: SsoProviderDefinition): string | undefined {
    const selectors = definition.selectors.errorMessage.split(',').map(s => s.trim());

    for (const selector of selectors) {
      try {
        const element = document.querySelector(selector);
        if (element?.textContent?.trim()) {
          return element.textContent.trim();
        }
      } catch {
        // Invalid selector, skip
      }
    }

    return undefined;
  }

  /**
   * Get the last detection result
   */
  getLastDetection(): SsoDetectionResult | null {
    return this.lastDetection;
  }

  /**
   * Start observing DOM for SSO page changes
   */
  startObserving(callback?: (result: SsoDetectionResult) => void): void {
    if (this.observing) return;

    this.observer = new MutationObserver(() => {
      const result = this.detect();
      if (callback && result.isSsoPage) {
        callback(result);
      }
    });

    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'hidden']
    });

    this.observing = true;
    EventBus.emit('sso:observer:started', {});
  }

  /**
   * Stop observing DOM
   */
  stopObserving(): void {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    this.observing = false;
    EventBus.emit('sso:observer:stopped', {});
  }

  /**
   * Wait for SSO page to change (e.g., after login)
   */
  async waitForChange(
    timeout = 60000,
    pollInterval = 500
  ): Promise<SsoDetectionResult | null> {
    const initialResult = this.detect();
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      await new Promise(resolve => setTimeout(resolve, pollInterval));

      const currentResult = this.detect();

      // Check if page type changed
      if (currentResult.pageType !== initialResult.pageType) {
        return currentResult;
      }

      // Check if no longer SSO page
      if (!currentResult.isSsoPage && initialResult.isSsoPage) {
        return currentResult;
      }

      // Check URL change
      if (window.location.href !== initialResult.url) {
        return this.detect();
      }
    }

    return null; // Timeout
  }

  /**
   * Wait for SSO flow to complete (no longer on SSO page)
   */
  async waitForCompletion(timeout = 120000): Promise<boolean> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      await new Promise(resolve => setTimeout(resolve, 1000));

      const result = this.detect();
      if (!result.isSsoPage) {
        EventBus.emit('sso:flow:complete', { duration: Date.now() - startTime });
        return true;
      }
    }

    EventBus.emit('sso:flow:timeout', { timeout });
    return false;
  }

  /**
   * Check if currently on an SSO page
   */
  isOnSsoPage(): boolean {
    return this.detect().isSsoPage;
  }

  /**
   * Get current SSO provider
   */
  getCurrentProvider(): SsoProvider | null {
    return this.detect().provider;
  }

  /**
   * Check if MFA is required
   */
  isMfaRequired(): boolean {
    const result = this.detect({ checkMfa: true });
    return result.pageType === 'mfa';
  }
}

// Export singleton instance
export const SsoDetector = new SsoDetectorClass();

// Also export the class for testing
export { SsoDetectorClass };
