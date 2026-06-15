import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as https from 'https';
import { execSync } from 'child_process';
import StreamZip from 'node-stream-zip';
import type { ZipEntry } from 'node-stream-zip';
import { log } from '@main/log';

const logger = log;

/**
 * Direct main-process installation methods. They run in the main process
 * (not via `spawn(process.execPath, …)`) because in packaged Electron apps
 * `process.execPath` points at the Electron binary, not Node.js.
 *
 * All functions take `binPath` (`{userData}/bin/`) explicitly so this module
 * stays free of singleton coupling.
 */

/**
 * Downloads a file from URL with redirect handling. Streams to disk, deletes
 * the destination on error.
 */
export function downloadWithRedirects(url: string, destinationPath: string): Promise<void> {
  const { promise, resolve, reject } = Promise.withResolvers<void>();

  const request = (downloadUrl: string) => {
    logger.debug({ msg: `[FRE] Downloading from: ${downloadUrl}`, mod: 'RuntimeManager' });

    https.get(downloadUrl, (response) => {
      if (response.statusCode === 301 || response.statusCode === 302) {
        const redirectUrl = response.headers.location;
        if (redirectUrl) {
          request(redirectUrl);
        } else {
          reject(new Error('Redirect without location header'));
        }
        return;
      }

      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download: ${response.statusCode} ${response.statusMessage}`));
        return;
      }

      const file = fs.createWriteStream(destinationPath);
      response.pipe(file);

      file.on('finish', () => {
        file.close(() => resolve());
      });

      file.on('error', (err) => {
        fs.unlink(destinationPath, () => reject(err));
      });
    }).on('error', (err) => {
      fs.unlink(destinationPath, () => reject(err));
    });
  };

  request(url);
  return promise;
}

const BUN_RELEASE_BASE_URL = 'https://github.com/oven-sh/bun/releases/download';

const BUN_PACKAGES: Record<string, string> = {
  'darwin-arm64': 'bun-darwin-aarch64.zip',
  'darwin-x64': 'bun-darwin-x64.zip',
  'win32-x64': 'bun-windows-x64.zip',
  'win32-arm64': 'bun-windows-x64.zip',
  'linux-x64': 'bun-linux-x64.zip',
  'linux-arm64': 'bun-linux-aarch64.zip',
};

/**
 * Installs Bun directly into `binPath`. Downloads the platform-specific zip
 * from GitHub Releases, extracts only the `bun` / `bun.exe` binary, sets
 * exec permissions on Unix, and verifies the binary lands.
 */
export async function installBunDirectly(binPath: string, version: string): Promise<void> {
  const platform = os.platform();
  const arch = os.arch();
  const platformKey = `${platform}-${arch}`;

  logger.info({ msg: `[FRE] Installing Bun ${version} for ${platformKey}`, mod: 'RuntimeManager' });

  const packageName = BUN_PACKAGES[platformKey];
  if (!packageName) {
    throw new Error(`Unsupported platform/architecture: ${platformKey}`);
  }

  const downloadUrl = `${BUN_RELEASE_BASE_URL}/bun-v${version}/${packageName}`;
  const tempDir = os.tmpdir();
  const tempFilename = path.join(tempDir, packageName);

  try {
    logger.info({ msg: `[FRE] Downloading Bun from ${downloadUrl}`, mod: 'RuntimeManager' });
    await downloadWithRedirects(downloadUrl, tempFilename);

    logger.info({ msg: `[FRE] Extracting ${packageName}`, mod: 'RuntimeManager' });
    const zip = new StreamZip.async({ file: tempFilename });
    const entries: Record<string, ZipEntry> = await zip.entries();

    for (const entry of Object.values(entries)) {
      if (!entry.isDirectory) {
        const filename = path.basename(entry.name);

        // Only extract the bun binary
        if (filename === 'bun' || filename === 'bun.exe') {
          const outputPath = path.join(binPath, filename);
          logger.debug({ msg: `[FRE] Extracting ${entry.name} -> ${outputPath}`, mod: 'RuntimeManager' });
          await zip.extract(entry.name, outputPath);

          if (platform !== 'win32') {
            fs.chmodSync(outputPath, 0o755);
          }
        }
      }
    }

    await zip.close();

    // Verify installation
    const binaryName = platform === 'win32' ? 'bun.exe' : 'bun';
    const finalPath = path.join(binPath, binaryName);

    if (fs.existsSync(finalPath)) {
      logger.info({ msg: `[FRE] Successfully installed Bun at ${finalPath}`, mod: 'RuntimeManager' });
    } else {
      throw new Error('Bun binary not found after extraction');
    }

    // Clean up temp file
    try { fs.unlinkSync(tempFilename); } catch { /* ignore */ }

  } catch (error) {
    // Clean up temp file on error
    try { if (fs.existsSync(tempFilename)) fs.unlinkSync(tempFilename); } catch { /* ignore */ }
    throw error;
  }
}

const UV_RELEASE_BASE_URL = 'https://github.com/astral-sh/uv/releases/download';

const UV_PACKAGES: Record<string, string> = {
  'darwin-arm64': 'uv-aarch64-apple-darwin.tar.gz',
  'darwin-x64': 'uv-x86_64-apple-darwin.tar.gz',
  'win32-arm64': 'uv-aarch64-pc-windows-msvc.zip',
  'win32-ia32': 'uv-i686-pc-windows-msvc.zip',
  'win32-x64': 'uv-x86_64-pc-windows-msvc.zip',
  'linux-arm64': 'uv-aarch64-unknown-linux-gnu.tar.gz',
  'linux-ia32': 'uv-i686-unknown-linux-gnu.tar.gz',
  'linux-x64': 'uv-x86_64-unknown-linux-gnu.tar.gz',
};

/**
 * Installs uv directly into `binPath`. Tar.gz archives are extracted with
 * the system `tar`; Windows zip archives use StreamZip. Only `uv` and `uvx`
 * binaries are copied out of the archive.
 */
export async function installUvDirectly(binPath: string, version: string): Promise<void> {
  const platform = os.platform();
  const arch = os.arch();
  const platformKey = `${platform}-${arch}`;

  logger.info({ msg: `[FRE] Installing uv ${version} for ${platformKey}`, mod: 'RuntimeManager' });

  const packageName = UV_PACKAGES[platformKey];
  if (!packageName) {
    throw new Error(`Unsupported platform/architecture: ${platformKey}`);
  }

  const downloadUrl = `${UV_RELEASE_BASE_URL}/${version}/${packageName}`;
  const tempDir = os.tmpdir();
  const tempFilename = path.join(tempDir, packageName);
  const isTarGz = packageName.endsWith('.tar.gz');

  try {
    logger.info({ msg: `[FRE] Downloading uv from ${downloadUrl}`, mod: 'RuntimeManager' });
    await downloadWithRedirects(downloadUrl, tempFilename);

    logger.info({ msg: `[FRE] Extracting ${packageName}`, mod: 'RuntimeManager' });

    if (isTarGz) {
      // Use system tar for tar.gz
      const tempExtractDir = path.join(tempDir, `uv-extract-${Date.now()}`);
      fs.mkdirSync(tempExtractDir, { recursive: true });

      try {
        execSync(`tar -xzf "${tempFilename}" -C "${tempExtractDir}"`, { stdio: 'pipe' });

        // Find binary in extracted structure and move to binPath
        const findAndMoveFiles = (dir: string) => {
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
              findAndMoveFiles(fullPath);
            } else {
              const filename = entry.name;
              if (filename === 'uv' || filename === 'uvx') {
                const outputPath = path.join(binPath, filename);
                fs.copyFileSync(fullPath, outputPath, fs.constants.COPYFILE_FICLONE);
                fs.chmodSync(outputPath, 0o755);
                logger.info({ msg: `[FRE] Installed ${filename}`, mod: 'RuntimeManager' });
              }
            }
          }
        };
        findAndMoveFiles(tempExtractDir);
      } finally {
        try { fs.rmSync(tempExtractDir, { recursive: true, force: true }); } catch { /* ignore */ }
      }
    } else {
      // Use StreamZip for zip (Windows)
      const zip = new StreamZip.async({ file: tempFilename });
      const entries: Record<string, ZipEntry> = await zip.entries();

      for (const entry of Object.values(entries)) {
        if (!entry.isDirectory) {
          const filename = path.basename(entry.name);
          if (filename === 'uv.exe' || filename === 'uvx.exe') {
            const outputPath = path.join(binPath, filename);
            await zip.extract(entry.name, outputPath);
            logger.info({ msg: `[FRE] Installed ${filename}`, mod: 'RuntimeManager' });
          }
        }
      }
      await zip.close();
    }

    // Verify installation
    const uvBinaryName = platform === 'win32' ? 'uv.exe' : 'uv';
    const finalPath = path.join(binPath, uvBinaryName);

    if (fs.existsSync(finalPath)) {
      logger.info({ msg: `[FRE] Successfully installed uv at ${finalPath}`, mod: 'RuntimeManager' });
    } else {
      throw new Error('uv binary not found after extraction');
    }

    // Clean up temp file
    try { fs.unlinkSync(tempFilename); } catch { /* ignore */ }

  } catch (error) {
    // Clean up temp file on error
    try { if (fs.existsSync(tempFilename)) fs.unlinkSync(tempFilename); } catch { /* ignore */ }
    throw error;
  }
}
