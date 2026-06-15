/**
 * Main-process image storage compression utilities.
 * Uses the sharp library to process images in the Node.js environment.
 *
 * 这个文件曾经长达 350 行，里面有一堆围绕老 `chatTypes.ImageContentPart` 形态的
 * `compressImagePartForStorage` / `compressMessageImagesForStorage` /
 * `compressImageForStorage` 入口。Phase 5 全仓 grep 显示这些都没有任何调用方,
 * 仅 `compressImageFirstPass` 还服役 doctor 的截图压缩链路。整批死代码删掉,
 * 顺手也撤掉对 `chatTypes.ImageContentPart` 的依赖。
 */

import sharp from 'sharp';
import { log } from '@main/log';

const logger = log;

/** Max raw image size accepted for inline embedding (data URI in LLM message). */
export const MAX_IMAGE_BYTES_FOR_INLINE = 10 * 1024 * 1024;
/** Max post-compression image size accepted for inline embedding. Beyond this, drop the image. */
export const MAX_COMPRESSED_IMAGE_BYTES_FOR_INLINE = 4 * 1024 * 1024;

/**
 * First-pass compression config for images uploaded via the User Agent flow.
 * The frontend handles the first pass via the Canvas API, but the main-process Node.js environment
 * cannot use that, so the same logic is implemented here.
 * Based on the OpenAI Vision algorithm: https://platform.openai.com/docs/guides/vision#calculating-costs
 */
export interface FirstPassCompressionConfig {
  maxDimension: number;        // Max dimension cap (default 2048px)
  targetShortSide: number;     // Target short-side size (default 768px)
  quality: number;             // JPEG quality (default 80)
  format: 'jpeg' | 'webp';     // Default output format for non-JPEG inputs
}

const DEFAULT_FIRST_PASS_CONFIG: FirstPassCompressionConfig = {
  maxDimension: 2048,          // First ensure no side exceeds 2048px
  targetShortSide: 768,        // Scale the short side to 768px
  quality: 80,                 // 0.8 JPEG quality
  format: 'jpeg'
};

/**
 * Algorithm:
 * 1. If both sides are <= 768px, do not compress.
 * 2. If either side > 2048px, first scale it down within 2048px.
 * 3. Scale the short side down to 768px.
 */
export async function compressImageFirstPass(
  base64Data: string,
  mimeType: string,
  config: Partial<FirstPassCompressionConfig> = {}
): Promise<{
  base64Data: string;
  mimeType: string;
  width: number;
  height: number;
  originalSize: number;
  compressedSize: number;
  wasCompressed: boolean;
}> {
  const finalConfig = { ...DEFAULT_FIRST_PASS_CONFIG, ...config };

  try {
    const buffer = Buffer.from(base64Data, 'base64');
    const originalSize = buffer.length;

    // Use sharp to read metadata
    let sharpInstance = sharp(buffer);
    const metadata = await sharpInstance.metadata();
    let { width, height } = metadata;

    if (!width || !height) {
      throw new Error('Unable to get image dimensions');
    }

    const originalWidth = width;
    const originalHeight = height;

    // Core rule: if both sides are <= 768px, do not compress.
    if (width <= finalConfig.targetShortSide && height <= finalConfig.targetShortSide) {
      logger.info({ msg: '[First Pass Compression] Image small enough, skipping compression', mod: 'compressImageFirstPass', width, height, targetShortSide: finalConfig.targetShortSide });

      return {
        base64Data,
        mimeType,
        width,
        height,
        originalSize,
        compressedSize: originalSize,
        wasCompressed: false
      };
    }

    // Step 1: if either side > 2048px, scale it down within 2048px
    if (width > finalConfig.maxDimension || height > finalConfig.maxDimension) {
      const scaleFactor = finalConfig.maxDimension / Math.max(width, height);
      width = Math.round(width * scaleFactor);
      height = Math.round(height * scaleFactor);

      logger.info({ msg: '[First Pass Compression] Step 1: Scaling to max dimension', mod: 'compressImageFirstPass', originalWidth, originalHeight, newWidth: width, newHeight: height, maxDimension: finalConfig.maxDimension });
    }

    // Step 2: scale the short side down to 768px
    const shortSide = Math.min(width, height);
    if (shortSide > finalConfig.targetShortSide) {
      const scaleFactor = finalConfig.targetShortSide / shortSide;
      width = Math.round(width * scaleFactor);
      height = Math.round(height * scaleFactor);

      logger.info({ msg: '[First Pass Compression] Step 2: Scaling short side to target', mod: 'compressImageFirstPass', shortSide, targetShortSide: finalConfig.targetShortSide, newWidth: width, newHeight: height });
    }

    // Perform the resize
    sharpInstance = sharp(buffer).resize(width, height, {
      fit: 'inside',
      withoutEnlargement: true
    });

    // Pick the output format based on the original mimeType
    const jpegTypes = ['image/jpeg', 'image/jpg'];
    let compressedBuffer: Buffer;
    let outputMimeType: string;

    if (jpegTypes.includes(mimeType)) {
      compressedBuffer = await sharpInstance.jpeg({
        quality: finalConfig.quality,
        progressive: true
      }).toBuffer();
      outputMimeType = 'image/jpeg';
    } else {
      // Default screenshot inputs to a lossy format to avoid an oversized PNG/base64 payload
      if (finalConfig.format === 'webp') {
        compressedBuffer = await sharpInstance.webp({
          quality: finalConfig.quality,
          effort: 4
        }).toBuffer();
        outputMimeType = 'image/webp';
      } else {
        compressedBuffer = await sharpInstance.flatten({
          background: '#ffffff'
        }).jpeg({
          quality: finalConfig.quality,
          progressive: true
        }).toBuffer();
        outputMimeType = 'image/jpeg';
      }
    }

    const compressedSize = compressedBuffer.length;
    const compressedBase64 = compressedBuffer.toString('base64');

    logger.info({ msg: '[First Pass Compression] Compression completed', mod: 'compressImageFirstPass', originalWidth, originalHeight, finalWidth: width, finalHeight: height, originalSize, compressedSize, compressionRatio: (compressedSize / originalSize * 100).toFixed(1) + '%' });

    return {
      base64Data: compressedBase64,
      mimeType: outputMimeType,
      width,
      height,
      originalSize,
      compressedSize,
      wasCompressed: true
    };

  } catch (error) {
    logger.error({ msg: '[First Pass Compression] Compression failed', mod: 'compressImageFirstPass', err: error });
    throw error;
  }
}
