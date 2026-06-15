/**
 * Platform detection helper for MCP configuration import.
 * Detects current platform and provides platform-specific candidate
 * MCP config paths (mcp.json / settings.json from common MCP clients).
 */

export type SupportedPlatform = 'macOS' | 'Windows' | 'Linux'

export interface PlatformInfo {
  platform: SupportedPlatform
  isSupported: boolean
  mcpConfigPath: string // Legacy single path for backward compatibility
  mcpConfigPaths: string[] // New multi-path support
  displayName: string
}

/**
 * Candidate MCP configuration file paths for different platforms (prioritized order)
 */
const WINDOWS_MCP_CONFIG_PATHS = [
  // 1. Standard version (highest priority)
  '%APPDATA%\\Code\\User\\mcp.json',

  // 2. Insiders version
  '%APPDATA%\\Code - Insiders\\User\\mcp.json',

  // 3. OSS open source version
  '%APPDATA%\\Code - OSS\\User\\mcp.json',

  // 4. Portable installation (relative to client install dir)
  '.\\data\\user-data\\User\\mcp.json',

  // 5. Custom data directory
  '%VSCODE_APPDATA%\\User\\mcp.json',

  // 6. System-level installation
  '%PROGRAMDATA%\\Code\\User\\mcp.json'
]

const MACOS_MCP_CONFIG_PATHS = [
  // 1. Standard installation - mcp.json priority
  '~/Library/Application Support/Code/User/mcp.json',
  '~/Library/Application Support/Code/User/settings.json',

  // 2. Insiders version
  '~/Library/Application Support/Code - Insiders/User/mcp.json',
  '~/Library/Application Support/Code - Insiders/User/settings.json',

  // 3. OSS version
  '~/Library/Application Support/Code - OSS/User/mcp.json',
  '~/Library/Application Support/Code - OSS/User/settings.json',

  // 4. Homebrew installation path
  '/usr/local/var/vscode/User/mcp.json',
  '/usr/local/var/vscode/User/settings.json'
]

const LINUX_MCP_CONFIG_PATHS = [
  '~/.config/Code/User/settings.json',
  '~/.config/Code - Insiders/User/settings.json',
  '~/.config/Code - OSS/User/settings.json'
]

/**
 * Single legacy default MCP configuration path for each platform
 */
const MCP_CONFIG_PATHS_LEGACY = {
  macOS: MACOS_MCP_CONFIG_PATHS[0], // First path for backward compatibility
  Windows: WINDOWS_MCP_CONFIG_PATHS[0], // First path for backward compatibility
  Linux: LINUX_MCP_CONFIG_PATHS[0]
}

/**
 * Platform display names
 */
const PLATFORM_DISPLAY_NAMES = {
  macOS: 'macOS',
  Windows: 'Windows',
  Linux: 'Linux'
}

/**
 * Detect the current platform based on user agent and navigator properties
 */
export function getCurrentPlatform(): SupportedPlatform {
  const userAgent = navigator.userAgent.toLowerCase()
  const platform = navigator.platform.toLowerCase()

  // Check for macOS
  if (platform.includes('mac') || userAgent.includes('mac os')) {
    return 'macOS'
  }

  // Check for Windows
  if (platform.includes('win') || userAgent.includes('windows')) {
    return 'Windows'
  }

  // Check for Linux
  if (platform.includes('linux') || userAgent.includes('linux')) {
    return 'Linux'
  }

  // Default to macOS if unable to detect (since we're primarily targeting macOS/Windows)
  return 'macOS'
}

/**
 * Get all candidate MCP configuration file paths for the current platform (prioritized)
 */
export function getMcpConfigPaths(platform?: SupportedPlatform): string[] {
  const currentPlatform = platform || getCurrentPlatform()

  switch (currentPlatform) {
    case 'Windows':
      return WINDOWS_MCP_CONFIG_PATHS
    case 'macOS':
      return MACOS_MCP_CONFIG_PATHS
    case 'Linux':
      return LINUX_MCP_CONFIG_PATHS
    default:
      return []
  }
}

/**
 * Get the default MCP configuration file path for the current platform (legacy compatibility)
 */
export function getMcpConfigPath(platform?: SupportedPlatform): string {
  const currentPlatform = platform || getCurrentPlatform()
  return MCP_CONFIG_PATHS_LEGACY[currentPlatform]
}

/**
 * Get the expanded default MCP configuration file path (resolve environment variables)
 */
export function getExpandedMcpConfigPath(platform?: SupportedPlatform): string {
  const currentPlatform = platform || getCurrentPlatform()
  const configPath = MCP_CONFIG_PATHS_LEGACY[currentPlatform]

  // For renderer process, we can't directly access environment variables
  // The actual path expansion will be handled by the main process
  // Here we return the template path for display purposes
  return configPath
}

/**
 * Check whether the current platform is supported for MCP config import
 */
export function isPlatformSupported(platform?: SupportedPlatform): boolean {
  const currentPlatform = platform || getCurrentPlatform()
  // Currently supporting macOS and Windows, Linux is reserved for future
  return currentPlatform === 'macOS' || currentPlatform === 'Windows'
}

/**
 * Get comprehensive platform information
 */
export function getPlatformInfo(platform?: SupportedPlatform): PlatformInfo {
  const currentPlatform = platform || getCurrentPlatform()

  return {
    platform: currentPlatform,
    isSupported: isPlatformSupported(currentPlatform),
    mcpConfigPath: getMcpConfigPath(currentPlatform),
    mcpConfigPaths: getMcpConfigPaths(currentPlatform),
    displayName: PLATFORM_DISPLAY_NAMES[currentPlatform]
  }
}

/**
 * Get all supported platforms information
 */
export function getAllSupportedPlatforms(): PlatformInfo[] {
  return (['macOS', 'Windows'] as SupportedPlatform[]).map(platform => getPlatformInfo(platform))
}

/**
 * Get platform-specific file patterns for file dialogs
 */
export function getPlatformFilePatterns(platform?: SupportedPlatform): { name: string; extensions: string[] }[] {
  const currentPlatform = platform || getCurrentPlatform()

  switch (currentPlatform) {
    case 'macOS':
      return [
        { name: 'MCP Configuration', extensions: ['json'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    case 'Windows':
      return [
        { name: 'MCP Configuration', extensions: ['json'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    case 'Linux':
      return [
        { name: 'MCP Configuration', extensions: ['json'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    default:
      return [
        { name: 'JSON Files', extensions: ['json'] },
        { name: 'All Files', extensions: ['*'] }
      ]
  }
}

/**
 * Platform-specific constants for different operating systems
 */
export const PLATFORM_CONSTANTS = {
  macOS: {
    configPath: MCP_CONFIG_PATHS_LEGACY.macOS,
    configType: 'settings.json with mcp section',
    homePrefix: '~/',
    pathSeparator: '/',
    supportedMcpFormats: ['settings.json with mcp.servers section']
  },
  Windows: {
    configPath: MCP_CONFIG_PATHS_LEGACY.Windows,
    configType: 'standalone mcp.json file',
    homePrefix: '%APPDATA%/',
    pathSeparator: '\\',
    supportedMcpFormats: ['standalone mcp.json with servers section']
  },
  Linux: {
    configPath: MCP_CONFIG_PATHS_LEGACY.Linux,
    configType: 'settings.json with mcp section',
    homePrefix: '~/',
    pathSeparator: '/',
    supportedMcpFormats: ['settings.json with mcp.servers section']
  }
} as const