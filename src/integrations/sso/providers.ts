/**
 * SSO Provider Definitions
 *
 * Defines detection patterns and selectors for various SSO providers:
 * - Okta
 * - Azure AD / Microsoft
 * - Ping Identity
 * - Google Workspace
 * - OneLogin
 * - Auth0
 */

import type { SsoProvider, SsoProviderDefinition } from '../../types/integration.js';

/**
 * SSO Provider definitions with detection patterns
 */
export const SSO_PROVIDERS: Record<SsoProvider, SsoProviderDefinition> = {
  okta: {
    name: 'Okta',
    urlPatterns: [
      /\.okta\.com/i,
      /\.oktapreview\.com/i,
      /okta-emea\.com/i
    ],
    selectors: {
      loginForm: '#okta-sign-in, form[data-se="o-form"]',
      usernameField: 'input[name="identifier"], input[name="username"]',
      passwordField: 'input[name="credentials.passcode"], input[type="password"]',
      submitButton: 'input[type="submit"], button[type="submit"]',
      mfaPrompt: '.mfa-verify, .authenticator-verify-list, [data-se="factor-list"]',
      errorMessage: '.o-form-error-container, [data-se="o-form-error-container"]'
    },
    mfaMethods: ['push', 'totp', 'sms', 'email', 'webauthn']
  },

  azure: {
    name: 'Microsoft Azure AD',
    urlPatterns: [
      /login\.microsoftonline\.com/i,
      /login\.microsoft\.com/i,
      /login\.live\.com/i,
      /sts\.windows\.net/i
    ],
    selectors: {
      loginForm: '#lightbox, form[name="f1"]',
      usernameField: 'input[name="loginfmt"], input[type="email"]',
      passwordField: 'input[name="passwd"], input[type="password"]',
      submitButton: 'input[type="submit"], button[type="submit"]',
      mfaPrompt: '#idDiv_SAOTCS_Proofs, .tile-container, #idDiv_SAOTCAS_Description',
      errorMessage: '#passwordError, #usernameError, .alert-error'
    },
    mfaMethods: ['authenticator', 'phone', 'email', 'fido2']
  },

  ping: {
    name: 'Ping Identity',
    urlPatterns: [
      /\.pingidentity\.com/i,
      /\.pingone\.com/i,
      /sso\.connect\.pingidentity\.com/i
    ],
    selectors: {
      loginForm: '.ping-form, form.login-form',
      usernameField: 'input[name="pf.username"], input#username',
      passwordField: 'input[name="pf.pass"], input#password',
      submitButton: 'a.ping-button, button[type="submit"]',
      mfaPrompt: '.mfa-container, .device-selection',
      errorMessage: '.ping-error, .error-message'
    },
    mfaMethods: ['push', 'totp', 'sms', 'email']
  },

  google: {
    name: 'Google Workspace',
    urlPatterns: [
      /accounts\.google\.com/i,
      /accounts\.youtube\.com/i
    ],
    selectors: {
      loginForm: '#gaia_loginform, form[action*="signin"]',
      usernameField: 'input[type="email"], input#identifierId',
      passwordField: 'input[type="password"], input[name="Passwd"]',
      submitButton: '#identifierNext, #passwordNext, button[type="submit"]',
      mfaPrompt: '[data-challengetype], .challenge-form',
      errorMessage: '.o6cuMc, [aria-live="assertive"]'
    },
    mfaMethods: ['push', 'totp', 'phone', 'security_key']
  },

  onelogin: {
    name: 'OneLogin',
    urlPatterns: [
      /\.onelogin\.com/i,
      /app\.onelogin\.com/i
    ],
    selectors: {
      loginForm: '#login-form, form[action*="login"]',
      usernameField: 'input#username, input[name="username"]',
      passwordField: 'input#password, input[name="password"]',
      submitButton: 'button[type="submit"], input[type="submit"]',
      mfaPrompt: '.mfa-container, #mfa-form',
      errorMessage: '.error-message, .alert-danger'
    },
    mfaMethods: ['push', 'totp', 'sms', 'voice']
  },

  auth0: {
    name: 'Auth0',
    urlPatterns: [
      /\.auth0\.com/i,
      /\.us\.auth0\.com/i,
      /\.eu\.auth0\.com/i,
      /\.au\.auth0\.com/i
    ],
    selectors: {
      loginForm: '.auth0-lock-widget, form.auth0-lock-form',
      usernameField: 'input[name="email"], input[name="username"]',
      passwordField: 'input[name="password"]',
      submitButton: 'button[name="submit"], button.auth0-lock-submit',
      mfaPrompt: '.auth0-lock-mfa-code, .mfa-code-container',
      errorMessage: '.auth0-global-message-error, .auth0-lock-error-msg'
    },
    mfaMethods: ['push', 'totp', 'sms', 'email', 'webauthn']
  },

  generic: {
    name: 'Generic SSO',
    urlPatterns: [
      /\/sso\//i,
      /\/saml\//i,
      /\/oauth\//i,
      /\/auth\//i,
      /login\./i,
      /signin\./i
    ],
    selectors: {
      loginForm: 'form[action*="login"], form[action*="signin"], form[action*="auth"]',
      usernameField: 'input[type="email"], input[name*="user"], input[name*="email"], input#username',
      passwordField: 'input[type="password"]',
      submitButton: 'button[type="submit"], input[type="submit"]',
      mfaPrompt: '[class*="mfa"], [class*="2fa"], [class*="otp"], [id*="mfa"]',
      errorMessage: '.error, .alert-error, .alert-danger, [role="alert"]'
    },
    mfaMethods: ['totp', 'sms', 'email']
  }
};

/**
 * Get provider definition by name
 */
export function getProvider(provider: SsoProvider): SsoProviderDefinition {
  return SSO_PROVIDERS[provider];
}

/**
 * Get all provider names
 */
export function getProviderNames(): SsoProvider[] {
  return Object.keys(SSO_PROVIDERS) as SsoProvider[];
}

/**
 * Check if a URL matches any provider pattern
 */
export function matchUrlToProvider(url: string): SsoProvider | null {
  for (const [provider, definition] of Object.entries(SSO_PROVIDERS)) {
    if (provider === 'generic') continue; // Skip generic for URL matching

    for (const pattern of definition.urlPatterns) {
      if (pattern.test(url)) {
        return provider as SsoProvider;
      }
    }
  }

  // Check generic patterns as fallback
  for (const pattern of SSO_PROVIDERS.generic.urlPatterns) {
    if (pattern.test(url)) {
      return 'generic';
    }
  }

  return null;
}
