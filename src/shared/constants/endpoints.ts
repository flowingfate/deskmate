/**
 * Centralized Service Endpoints
 *
 * All remote URLs (CDN, relay services, etc.) live here so we can swap domains
 * in one place instead of grepping the codebase.
 */

const isDev = process.env.NODE_ENV === 'development';

/**
 * Base CDN URL for asset libraries (agents, MCP, skills), updater binaries,
 * release manifests, and the like.
 */
export const BASE_CDN_URL: string = isDev
  ? 'https://cdn.deskmate.top/dev'
  : 'https://cdn.deskmate.top';

/**
 * Production release CDN. Used by the auto-update CDN checker.
 */
export const RELEASE_CDN_URL: string = `${BASE_CDN_URL}/releases`;

/**
 * Relay service URL — backend that proxies GitHub Issue creation, etc.
 */
export const RELAY_SERVICE_URL: string = isDev
  ? 'https://relay-test.deskmate.top'
  : 'https://relay.deskmate.top';

/**
 * Default quick-start image shown in chat zero state.
 */
export const QUICK_START_IMAGE_URL: string = `${BASE_CDN_URL}/images/deskmate-quick-start-default-image.png`;
