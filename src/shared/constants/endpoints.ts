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


export const ONELINE_API_URL_BASE = "https://api.deskmate.top";
export const GIT_REPO_URL_BASE = "https://github.com/flowingfate/deskmate";
export const GIT_REPO_API_URL_BASE = "https://api.github.com/repos/flowingfate/deskmate";