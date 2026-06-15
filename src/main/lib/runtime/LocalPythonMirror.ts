import * as http from 'http';
import * as path from 'path';
import * as fs from 'fs';
import { app } from 'electron';
import { log } from '@main/log';
import { AddressInfo } from 'net';

const logger = log;

/**
 * `UV_PYTHON_INSTALL_MIRROR` 后端：拦截 uv 的 python tarball 下载请求。
 *
 * 仓库不再随源码携带 cpython tarball（v0.1.0 起）。该 mirror 现在的角色：
 * 1. 若 `resources/python/<tag>/<filename>` 存在 —— 例如用户/CI 主动放的离线
 *    缓存 —— 直接走本地 stream，**避免每次重装重复下载**；
 * 2. 否则 302 重定向到 `github.com/astral-sh/python-build-standalone/releases`，
 *    由 uv 自己跟随重定向完成下载。**这是默认路径**。
 *
 * 因此对开源 fork 用户：什么都不配置即可工作，第一次 MCP 触发 python 安装时
 * 自动拉镜像。想加速可在 `resources/python/<tag>/<filename>` 放置同名 tarball。
 */
export class LocalPythonMirror {
  private static instance: LocalPythonMirror;
  private server: http.Server | null = null;
  private port: number = 0;
  private resourcesPath: string;

  private constructor() {
    this.resourcesPath = app.isPackaged
      ? path.join(process.resourcesPath, 'python')
      : path.join(process.cwd(), 'resources', 'python');

    logger.debug({ msg: `[LocalPythonMirror] Initialized with resources path: ${this.resourcesPath}`, mod: 'RuntimeManager' });
  }

  public static getInstance(): LocalPythonMirror {
    if (!LocalPythonMirror.instance) {
      LocalPythonMirror.instance = new LocalPythonMirror();
    }
    return LocalPythonMirror.instance;
  }

  public async start(): Promise<string> {
    if (this.server) {
        return this.getBaseUrl();
    }

    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        this.handleRequest(req, res);
      });

      // Listen on random port on localhost
      this.server.listen(0, '127.0.0.1', () => {
        const address = this.server?.address() as AddressInfo;
        this.port = address.port;
        logger.info({ msg: `[LocalPythonMirror] Started on port ${this.port}`, mod: 'RuntimeManager' });
        resolve(this.getBaseUrl());
      });

      this.server.on('error', (err) => {
        logger.error({ msg: `[LocalPythonMirror] Server error`, mod: 'RuntimeManager', err: err });
        // If we haven't resolved yet (startup error), we should probably reject
        if (this.port === 0) {
            reject(err);
        }
      });
    });
  }

  public getBaseUrl(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  public getBaseUrlIfRunning(): string | null {
      if (this.server && this.port > 0) {
          return `http://127.0.0.1:${this.port}`;
      }
      return null;
  }

  public stop() {
    if (this.server) {
      this.server.close();
      this.server = null;
      this.port = 0;
      logger.info({ msg: `[LocalPythonMirror] Stopped`, mod: 'RuntimeManager' });
    }
  }

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
    // Expected format: /TAG/FILENAME
    // e.g. /20240106/cpython-3.12.1+20240106-x86_64-pc-windows-msvc-install_only.tar.gz
    logger.debug({ msg: `[LocalPythonMirror] Received request: ${req.url}`, mod: 'RuntimeManager' });
    try {
        const decodedUrl = req.url ? decodeURIComponent(req.url) : '';
        const urlParts = decodedUrl.split('/').filter(Boolean);
        if (urlParts.length < 2) {
            res.statusCode = 400;
            res.end('Invalid request format');
            return;
        }

        // uv uses {MIRROR}/{TAG}/{FILENAME}
        const tag = urlParts[urlParts.length - 2];
        const filename = urlParts[urlParts.length - 1];

        // Check local file
        const localFilePath = path.join(this.resourcesPath, tag, filename);

        if (fs.existsSync(localFilePath)) {
            logger.info({ msg: `[LocalPythonMirror] Serving local file: ${filename}`, mod: 'RuntimeManager' });
            try {
                const stat = fs.statSync(localFilePath);
                res.writeHead(200, {
                    'Content-Type': 'application/gzip',
                    'Content-Length': stat.size
                });
                const readStream = fs.createReadStream(localFilePath);
                readStream.pipe(res);
            } catch (fileErr) {
                 logger.error({ msg: `[LocalPythonMirror] Error reading file: ${filename}`, mod: 'RuntimeManager', err: fileErr });
                 res.statusCode = 500;
                 res.end('Error reading local file');
            }
        } else {
            // Redirect to GitHub
            const githubUrl = `https://github.com/astral-sh/python-build-standalone/releases/download/${tag}/${filename}`;
            logger.info({ msg: `[LocalPythonMirror] File not found locally (${filename}), redirecting to: ${githubUrl}`, mod: 'RuntimeManager' });
            res.writeHead(302, { 'Location': githubUrl });
            res.end();
        }
    } catch (error) {
        logger.error({ msg: `[LocalPythonMirror] Request handling error`, mod: 'RuntimeManager', err: error });
        res.statusCode = 500;
        res.end('Internal Server Error');
    }
  }
}
