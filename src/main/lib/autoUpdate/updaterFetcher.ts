import * as https from 'https';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { log } from '@main/log';
import { appendCacheBustingTimestamp } from '../utilities/urlUtils';
import { BASE_CDN_URL } from '@shared/constants/endpoints';
import { getAppJsonPath, getUpdaterDir as resolveUpdaterDir } from '@main/persist/lib/path';

export interface UpdatersInfo {
  latest: string; // remote latest version number
  downloadUrls: {
    [platformKey: string]: string; // format: "darwin-arm64" -> "updater-mac-arm64"
  };
}

export interface AppConfig {
  updaterVersion?: string; // local updater version number
  [key: string]: any; // allow additional fields
}

export interface UpdaterCheckResult {
  exists: boolean;
  updaterPath: string;
  needsDownload: boolean;
  localVersion?: string; // local version number
}

export interface UpdaterFetchProgress {
  percent: number;
  transferred: string;
  total: string;
}

/**
 * UpdaterFetcher - responsible for checking and downloading the updater executable.
 * Ensures a correct local updater is present before performing a version check.
 */
export class UpdaterFetcher {
  private logger = log;
  private baseUrl: string;

  constructor() {
    // Get the base CDN URL based on environment
    const isDevelopment = process.env.NODE_ENV === 'development';
    this.baseUrl = BASE_CDN_URL;

    this.logger.info({ msg: 'UpdaterFetcher initialized', mod: 'UpdaterFetcher', isDevelopment, baseUrl: this.baseUrl });
  }

  /**
   * Returns the current platform identifier.
   */
  private getCurrentPlatformKey(): string {
    const platform = process.platform;
    const arch = process.arch;
    return `${platform}-${arch}`;
  }

  /**
   * Returns the local storage path for the updater executable.
   */
  private getUpdaterLocalPath(): string {
    const platform = process.platform;
    const arch = process.arch;

    const updaterName = platform === 'win32'
      ? `updater-win-${arch}.exe`
      : `updater-mac-${arch}`;

    return path.join(resolveUpdaterDir(), updaterName);
  }

  /**
   * Returns the updater directory path.
   */
  private getUpdaterDir(): string {
    return resolveUpdaterDir();
  }

  /**
   * Returns the app.json configuration file path.
   */
  private getAppConfigPath(): string {
    return getAppJsonPath();
  }

  /**
   * Read app.json configuration.
   */
  private readAppConfig(): AppConfig {
    try {
      const configPath = this.getAppConfigPath();
      if (fs.existsSync(configPath)) {
        const content = fs.readFileSync(configPath, 'utf8');
        return JSON.parse(content);
      }
    } catch (error) {
      this.logger.warn({ msg: 'Failed to read app.json', mod: 'UpdaterFetcher', err: error });
    }
    return {};
  }

  /**
   * Write app.json configuration.
   */
  private writeAppConfig(config: AppConfig): void {
    try {
      const configPath = this.getAppConfigPath();
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
      this.logger.info({ msg: 'app.json configuration updated', mod: 'UpdaterFetcher', configPath });
    } catch (error) {
      this.logger.error({ msg: 'Failed to write app.json', mod: 'UpdaterFetcher', err: error });
    }
  }

  /**
   * Returns the local updater version number.
   * Read from the updaterVersion field in app.json.
   * Returns "0.0.0" if app.json or the field does not exist.
   */
  public getLocalUpdaterVersion(): string {
    const config = this.readAppConfig();
    return config.updaterVersion || '0.0.0';
  }

  /**
   * Update the local updater version number.
   * Writes to the updaterVersion field in app.json.
   */
  public setLocalUpdaterVersion(version: string): void {
    const config = this.readAppConfig();
    config.updaterVersion = version;
    this.writeAppConfig(config);
    this.logger.info({ msg: 'Local updater version updated', mod: 'UpdaterFetcher', version });
  }

  /**
   * Compare version strings.
   * Returns: -1 (v1 < v2), 0 (v1 == v2), 1 (v1 > v2)
   */
  private compareVersions(v1: string, v2: string): number {
    const parts1 = v1.split('.').map(Number);
    const parts2 = v2.split('.').map(Number);

    const maxLen = Math.max(parts1.length, parts2.length);

    for (let i = 0; i < maxLen; i++) {
      const num1 = parts1[i] || 0;
      const num2 = parts2[i] || 0;

      if (num1 < num2) return -1;
      if (num1 > num2) return 1;
    }

    return 0;
  }

  /**
   * Check whether a local updater exists.
   */
  public checkLocalUpdater(): UpdaterCheckResult {
    const updaterPath = this.getUpdaterLocalPath();
    const localVersion = this.getLocalUpdaterVersion();

    this.logger.info({ msg: 'Checking local updater', mod: 'UpdaterFetcher', updaterPath, localVersion });

    try {
      if (fs.existsSync(updaterPath)) {
        // Check whether the file is valid (non-empty, executable)
        const stats = fs.statSync(updaterPath);
        if (stats.size > 0) {
          this.logger.info({ msg: 'Local updater exists and is valid', mod: 'UpdaterFetcher', updaterPath, size: stats.size, localVersion });
          return {
            exists: true,
            updaterPath,
            needsDownload: false,
            localVersion
          };
        } else {
          this.logger.warn({ msg: 'Local updater file is empty, re-download required', mod: 'UpdaterFetcher', updaterPath });
          // Delete the empty file
          fs.unlinkSync(updaterPath);
        }
      }

      this.logger.info({ msg: 'Local updater not found, download required', mod: 'UpdaterFetcher', updaterPath });
      return {
        exists: false,
        updaterPath,
        needsDownload: true,
        localVersion
      };
    } catch (error) {
      this.logger.error({ msg: 'Failed to check local updater', mod: 'UpdaterFetcher', updaterPath, err: error });
      return {
        exists: false,
        updaterPath,
        needsDownload: true,
        localVersion
      };
    }
  }

  /**
   * Fetch updaters.json from the CDN.
   */
  private async fetchUpdatersInfo(): Promise<UpdatersInfo | null> {
    // Add timestamp to bypass CDN cache
    const updatersUrl = appendCacheBustingTimestamp(`${this.baseUrl}/updaters/updaters.json`);

    this.logger.info({ msg: 'Fetching updaters.json', mod: 'UpdaterFetcher', updatersUrl });

    try {
      const response = await this.httpGet(updatersUrl);
      const updatersInfo: UpdatersInfo = JSON.parse(response);

      this.logger.info({ msg: 'Successfully fetched updaters.json', mod: 'UpdaterFetcher', latestVersion: updatersInfo.latest, availablePlatforms: Object.keys(updatersInfo.downloadUrls) });

      return updatersInfo;
    } catch (error) {
      this.logger.error({ msg: 'Failed to fetch updaters.json', mod: 'UpdaterFetcher', url: updatersUrl, err: error });
      return null;
    }
  }

  /**
   * Returns the remote latest updater version number.
   */
  public async getRemoteUpdaterVersion(): Promise<string | null> {
    const updatersInfo = await this.fetchUpdatersInfo();
    if (updatersInfo && updatersInfo.latest) {
      return updatersInfo.latest;
    }
    return null;
  }

  /**
   * Check whether the updater needs to be updated.
   * Compares local version against remote version.
   */
  public async checkUpdaterNeedsUpdate(): Promise<{
    needsUpdate: boolean;
    localVersion: string;
    remoteVersion: string | null;
  }> {
    const localVersion = this.getLocalUpdaterVersion();
    const remoteVersion = await this.getRemoteUpdaterVersion();

    if (!remoteVersion) {
      this.logger.warn({ msg: 'Unable to fetch remote version number', mod: 'UpdaterFetcher' });
      return {
        needsUpdate: false,
        localVersion,
        remoteVersion: null
      };
    }

    const comparison = this.compareVersions(localVersion, remoteVersion);
    const needsUpdate = comparison < 0;

    this.logger.info({ msg: 'Version comparison result', mod: 'UpdaterFetcher', localVersion, remoteVersion, needsUpdate });

    return {
      needsUpdate,
      localVersion,
      remoteVersion
    };
  }

  /**
   * Download the updater executable.
   */
  public async downloadUpdater(
    onProgress?: (progress: UpdaterFetchProgress) => void
  ): Promise<{ success: boolean; updaterPath?: string; error?: string; version?: string }> {
    try {
      // 1. Fetch updaters.json
      const updatersInfo = await this.fetchUpdatersInfo();
      if (!updatersInfo) {
        return { success: false, error: 'Failed to fetch updaters.json' };
      }

      // 2. Get the updater filename for the current platform
      const platformKey = this.getCurrentPlatformKey();
      const updaterFileName = updatersInfo.downloadUrls[platformKey];

      if (!updaterFileName) {
        const error = `Unsupported platform: ${platformKey}`;
        this.logger.error({ msg: error, mod: 'UpdaterFetcher', platformKey, availablePlatforms: Object.keys(updatersInfo.downloadUrls) });
        return { success: false, error };
      }

      // 3. Build the download URL
      const downloadUrl = `${this.baseUrl}/updaters/${updaterFileName}`;
      const updaterPath = this.getUpdaterLocalPath();
      const updaterDir = this.getUpdaterDir();

      this.logger.info({ msg: 'Starting updater download', mod: 'UpdaterFetcher', downloadUrl, updaterPath, updaterDir, version: updatersInfo.latest });

      // 4. Ensure the directory exists
      if (!fs.existsSync(updaterDir)) {
        fs.mkdirSync(updaterDir, { recursive: true });
        this.logger.info({ msg: 'Created updater directory', mod: 'UpdaterFetcher', updaterDir });
      }

      // 5. Download the file
      await this.downloadFile(downloadUrl, updaterPath, onProgress);

      // 6. Set execute permissions (macOS/Linux only)
      if (process.platform !== 'win32') {
        try {
          fs.chmodSync(updaterPath, 0o755);
          this.logger.info({ msg: 'Set updater execute permissions', mod: 'UpdaterFetcher', updaterPath });
        } catch (chmodError) {
          this.logger.warn({ msg: 'Failed to set execute permissions', mod: 'UpdaterFetcher', updaterPath, err: chmodError });
        }
      }

      // 7. Update local version number in app.json
      this.setLocalUpdaterVersion(updatersInfo.latest);

      this.logger.info({ msg: 'Updater download completed', mod: 'UpdaterFetcher', updaterPath, version: updatersInfo.latest });
      return { success: true, updaterPath, version: updatersInfo.latest };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error({ msg: 'Failed to download updater', mod: 'UpdaterFetcher', err: error });
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Ensure the updater exists and is up to date.
   * Full flow:
   * 1. Check whether a local updater executable exists.
   * 2. If not, download it directly and update updaterVersion in app.json.
   * 3. If it exists, compare local version against remote version.
   * 4. If local version < remote version, download the latest and overwrite local, update app.json.
   */
  public async ensureUpdater(
    onProgress?: (progress: UpdaterFetchProgress) => void
  ): Promise<{ success: boolean; updaterPath?: string; error?: string; downloaded: boolean; version?: string }> {
    // 1. Check whether the local updater exists
    const checkResult = this.checkLocalUpdater();

    if (!checkResult.exists) {
      // No local updater — download it
      this.logger.info({ msg: 'Local updater not found, starting download', mod: 'UpdaterFetcher' });
      const downloadResult = await this.downloadUpdater(onProgress);

      return {
        success: downloadResult.success,
        updaterPath: downloadResult.updaterPath,
        error: downloadResult.error,
        downloaded: downloadResult.success,
        version: downloadResult.version
      };
    }

    // 2. Local updater found — check whether an update is needed
    this.logger.info({ msg: 'Local updater found, checking version', mod: 'UpdaterFetcher', updaterPath: checkResult.updaterPath, localVersion: checkResult.localVersion });

    const versionCheck = await this.checkUpdaterNeedsUpdate();

    if (!versionCheck.needsUpdate) {
      // Local version is already up to date — no download needed
      this.logger.info({ msg: 'Local updater is already up to date, no download needed', mod: 'UpdaterFetcher', updaterPath: checkResult.updaterPath, localVersion: versionCheck.localVersion, remoteVersion: versionCheck.remoteVersion });
      return {
        success: true,
        updaterPath: checkResult.updaterPath,
        downloaded: false,
        version: versionCheck.localVersion
      };
    }

    // 3. Local version is older than remote — download the update
    this.logger.info({ msg: 'Local updater version is outdated, starting update', mod: 'UpdaterFetcher', localVersion: versionCheck.localVersion, remoteVersion: versionCheck.remoteVersion });

    const downloadResult = await this.downloadUpdater(onProgress);

    return {
      success: downloadResult.success,
      updaterPath: downloadResult.updaterPath,
      error: downloadResult.error,
      downloaded: downloadResult.success,
      version: downloadResult.version
    };
  }

  /**
   * HTTP GET request.
   */
  private httpGet(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const urlObj = new URL(url);
      const isHttps = urlObj.protocol === 'https:';
      const httpModule = isHttps ? https : http;

      httpModule.get(url, (res) => {
        // Use Buffer array to properly handle multi-byte UTF-8 characters
        const chunks: Buffer[] = [];

        res.on('data', (chunk: Buffer) => {
          chunks.push(chunk);
        });

        res.on('end', () => {
          // Concatenate all chunks and decode as UTF-8
          const data = Buffer.concat(chunks).toString('utf-8');
          if (res.statusCode === 200) {
            resolve(data);
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
          }
        });
      }).on('error', (error) => {
        reject(error);
      });
    });
  }

  /**
   * Download a file.
   */
  private downloadFile(
    url: string,
    filePath: string,
    onProgress?: (progress: UpdaterFetchProgress) => void
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const urlObj = new URL(url);
      const isHttps = urlObj.protocol === 'https:';
      const httpModule = isHttps ? https : http;

      const request = httpModule.get(url, (response) => {
        if (response.statusCode !== 200) {
          reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
          return;
        }

        const totalSize = parseInt(response.headers['content-length'] || '0', 10);
        let downloadedSize = 0;
        let lastProgressTime = Date.now();

        // Create write stream
        const fileStream = fs.createWriteStream(filePath);

        response.on('data', (chunk) => {
          downloadedSize += chunk.length;
          fileStream.write(chunk);

          // Throttle progress updates (at most once per 100 ms)
          const now = Date.now();
          if (onProgress && now - lastProgressTime > 100) {
            const percent = totalSize > 0 ? Math.round((downloadedSize / totalSize) * 100) : 0;
            onProgress({
              percent,
              transferred: this.formatBytes(downloadedSize),
              total: this.formatBytes(totalSize)
            });
            lastProgressTime = now;
          }
        });

        response.on('end', () => {
          fileStream.end();

          // Send final progress
          if (onProgress) {
            onProgress({
              percent: 100,
              transferred: this.formatBytes(downloadedSize),
              total: this.formatBytes(totalSize)
            });
          }

          resolve();
        });

        response.on('error', (error) => {
          fileStream.destroy();
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
          }
          reject(error);
        });
      });

      request.on('error', (error) => {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
        reject(error);
      });

      request.setTimeout(120000, () => { // 2-minute timeout
        request.destroy();
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
        reject(new Error('Download timeout'));
      });
    });
  }

  /**
   * Format byte count as a human-readable string.
   */
  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
}