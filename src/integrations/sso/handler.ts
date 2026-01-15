/**
 * SSO Handler
 *
 * Manages SSO authentication flows with human-in-the-loop support.
 * Coordinates between detector and workflow engine.
 */

import { EventBus } from '../../core/event-bus.js';
import { StateManager } from '../../core/state-manager.js';
import { SsoDetector } from './detector.js';
import type { SsoProvider, SsoFlowState, SsoDetectionResult } from '../../types/integration.js';

/** SSO handler options */
interface SsoHandlerOptions {
  /** Auto-detect SSO pages */
  autoDetect?: boolean;
  /** Timeout for SSO flow completion (ms) */
  timeout?: number;
  /** Poll interval for checking completion (ms) */
  pollInterval?: number;
  /** Show UI notification for MFA */
  notifyOnMfa?: boolean;
}

/** Human action required notification */
interface HumanActionRequired {
  type: 'login' | 'mfa' | 'consent' | 'error';
  provider: SsoProvider;
  message: string;
  instructions?: string[];
  timeout?: number;
}

/**
 * SSO Handler class
 */
class SsoHandlerClass {
  private flowState: SsoFlowState = { active: false, provider: null };
  private options: SsoHandlerOptions = {
    autoDetect: true,
    timeout: 120000,
    pollInterval: 1000,
    notifyOnMfa: true
  };
  private pendingPromise: {
    resolve: (success: boolean) => void;
    reject: (error: Error) => void;
  } | null = null;

  /**
   * Configure handler options
   */
  configure(options: Partial<SsoHandlerOptions>): void {
    this.options = { ...this.options, ...options };
  }

  /**
   * Start handling SSO flow
   * Call this when SSO is detected to pause workflow and wait for human
   */
  async handleSsoFlow(detection?: SsoDetectionResult): Promise<boolean> {
    const result = detection || SsoDetector.detect();

    if (!result.isSsoPage || !result.provider) {
      return true; // Not an SSO page, continue workflow
    }

    // Update flow state
    this.flowState = {
      active: true,
      provider: result.provider,
      startedAt: Date.now(),
      pageType: result.pageType || undefined,
      requiresMfa: result.pageType === 'mfa'
    };

    // Persist state
    StateManager.set('sso', 'flowState', this.flowState);

    // Emit event
    EventBus.emit('sso:flow:started', {
      provider: result.provider,
      pageType: result.pageType
    });

    // Request human action
    this.requestHumanAction({
      type: result.pageType === 'mfa' ? 'mfa' : 'login',
      provider: result.provider,
      message: this.getHumanMessage(result),
      instructions: this.getInstructions(result),
      timeout: this.options.timeout
    });

    // Wait for flow to complete
    return new Promise((resolve, reject) => {
      this.pendingPromise = { resolve, reject };

      // Start polling for completion
      this.pollForCompletion();

      // Set timeout
      setTimeout(() => {
        if (this.pendingPromise) {
          this.pendingPromise.reject(new Error('SSO flow timeout'));
          this.pendingPromise = null;
          this.endFlow(false);
        }
      }, this.options.timeout);
    });
  }

  /**
   * Poll for SSO flow completion
   */
  private async pollForCompletion(): Promise<void> {
    while (this.flowState.active && this.pendingPromise) {
      await new Promise(resolve => setTimeout(resolve, this.options.pollInterval));

      const result = SsoDetector.detect();

      // Check for page type change (e.g., login -> mfa)
      if (result.pageType !== this.flowState.pageType) {
        this.flowState.pageType = result.pageType || undefined;
        this.flowState.requiresMfa = result.pageType === 'mfa';

        if (result.pageType === 'mfa') {
          EventBus.emit('sso:mfa:required', {
            provider: result.provider,
            mfaType: result.mfaType
          });

          this.requestHumanAction({
            type: 'mfa',
            provider: result.provider!,
            message: 'Multi-factor authentication required',
            instructions: this.getMfaInstructions(result.mfaType)
          });
        }
      }

      // Check for errors
      if (result.hasError) {
        EventBus.emit('sso:error', {
          provider: result.provider,
          message: result.errorMessage
        });
      }

      // Check if SSO completed (no longer on SSO page)
      if (!result.isSsoPage) {
        this.endFlow(true);
        break;
      }
    }
  }

  /**
   * End SSO flow
   */
  private endFlow(success: boolean): void {
    const duration = this.flowState.startedAt
      ? Date.now() - this.flowState.startedAt
      : 0;

    EventBus.emit('sso:flow:ended', {
      provider: this.flowState.provider,
      success,
      duration
    });

    if (this.pendingPromise) {
      this.pendingPromise.resolve(success);
      this.pendingPromise = null;
    }

    this.flowState = { active: false, provider: null };
    StateManager.remove('sso', 'flowState');
  }

  /**
   * Manually signal SSO completion
   * Call this if polling doesn't detect completion
   */
  signalComplete(): void {
    if (this.flowState.active) {
      this.endFlow(true);
    }
  }

  /**
   * Manually signal SSO failure
   */
  signalFailure(error?: string): void {
    if (this.flowState.active) {
      EventBus.emit('sso:flow:failed', { error });
      this.endFlow(false);
    }
  }

  /**
   * Request human action (shows notification)
   */
  private requestHumanAction(action: HumanActionRequired): void {
    EventBus.emit('sso:human:required', action);

    // Show visual notification
    this.showNotification(action);
  }

  /**
   * Show notification to user
   */
  private showNotification(action: HumanActionRequired): void {
    // Create notification element
    const notification = document.createElement('div');
    notification.id = 'agentos-sso-notification';
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: #1a1a2e;
      color: #eee;
      padding: 16px 20px;
      border-radius: 8px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.3);
      z-index: 999999;
      max-width: 350px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 14px;
      border-left: 4px solid ${action.type === 'mfa' ? '#f39c12' : '#3498db'};
    `;

    const icon = action.type === 'mfa' ? '🔐' : '🔑';
    notification.innerHTML = `
      <div style="display: flex; align-items: flex-start; gap: 12px;">
        <span style="font-size: 24px;">${icon}</span>
        <div>
          <div style="font-weight: 600; margin-bottom: 4px;">AgentOS: ${action.message}</div>
          <div style="color: #aaa; font-size: 12px;">
            ${action.instructions?.join('<br>') || 'Complete authentication to continue workflow'}
          </div>
        </div>
      </div>
    `;

    // Remove existing notification
    const existing = document.getElementById('agentos-sso-notification');
    if (existing) existing.remove();

    document.body.appendChild(notification);

    // Auto-remove after flow completes
    const removeNotification = () => {
      notification.remove();
      EventBus.off('sso:flow:ended');
    };

    EventBus.once('sso:flow:ended', removeNotification);
  }

  /**
   * Get human-readable message for SSO state
   */
  private getHumanMessage(result: SsoDetectionResult): string {
    const providerName = result.provider
      ? result.provider.charAt(0).toUpperCase() + result.provider.slice(1)
      : 'SSO';

    switch (result.pageType) {
      case 'mfa':
        return `${providerName} MFA Required`;
      case 'login':
        return `${providerName} Login Required`;
      case 'username':
        return `Enter ${providerName} Username`;
      case 'password':
        return `Enter ${providerName} Password`;
      default:
        return `${providerName} Authentication Required`;
    }
  }

  /**
   * Get instructions for user
   */
  private getInstructions(result: SsoDetectionResult): string[] {
    const instructions: string[] = [];

    switch (result.pageType) {
      case 'login':
        instructions.push('Enter your credentials');
        instructions.push('Workflow will resume automatically after login');
        break;
      case 'username':
        instructions.push('Enter your username or email');
        break;
      case 'password':
        instructions.push('Enter your password');
        break;
      case 'mfa':
        instructions.push(...this.getMfaInstructions(result.mfaType));
        break;
    }

    return instructions;
  }

  /**
   * Get MFA-specific instructions
   */
  private getMfaInstructions(mfaType?: string): string[] {
    switch (mfaType) {
      case 'push':
        return ['Approve the push notification on your device'];
      case 'totp':
        return ['Enter the 6-digit code from your authenticator app'];
      case 'sms':
        return ['Enter the code sent to your phone'];
      case 'email':
        return ['Enter the code sent to your email'];
      case 'webauthn':
        return ['Use your security key to authenticate'];
      default:
        return ['Complete the multi-factor authentication'];
    }
  }

  /**
   * Get current flow state
   */
  getFlowState(): SsoFlowState {
    return { ...this.flowState };
  }

  /**
   * Check if SSO flow is active
   */
  isFlowActive(): boolean {
    return this.flowState.active;
  }

  /**
   * Resume flow from saved state (e.g., after page reload)
   */
  resumeFlow(): boolean {
    const savedState = StateManager.get<SsoFlowState>('sso', 'flowState');

    if (savedState?.active) {
      this.flowState = savedState;

      // Check if still on SSO page
      const result = SsoDetector.detect();
      if (result.isSsoPage) {
        EventBus.emit('sso:flow:resumed', { provider: savedState.provider });
        return true;
      } else {
        // Flow completed while we were away
        this.endFlow(true);
      }
    }

    return false;
  }
}

// Export singleton instance
export const SsoHandler = new SsoHandlerClass();

// Also export the class for testing
export { SsoHandlerClass };
