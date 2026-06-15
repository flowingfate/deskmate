// src/renderer/lib/utilities/imageCompression.ts
// Image compression utility — contains all image compression related functionality

/**
 * CSP compatibility detection result
 */
export interface CSPCompatibilityResult {
  supportsBlobURL: boolean;
  supportsDataURL: boolean;
  error?: string;
}

/**
 * Image compression options
 */
export interface ImageCompressionOptions {
  maxWidth?: number;
  maxHeight?: number;
  quality?: number;
  outputFormat?: 'image/jpeg' | 'image/png' | 'image/webp';
}

/**
 * Image compression result
 */
export interface ImageCompressionResult {
  compressedFile: File;
  originalSize: number;
  compressedSize: number;
  compressionRatio: number;
  wasCompressed: boolean;
}

// Image processing limits aligned with the OpenAI vision token-cost guidance.
export const IMAGE_COMPRESSION_LIMITS = {
  // Maximum image size is 5MB.
  MAX_SIZE_MB: 5,
  MAX_SIZE_BYTES: 5 * 1024 * 1024, // 5MB in bytes

  // 🔥 New: Strict limits for GitHub Copilot API
  // Prevents 413 Request Entity Too Large errors
  STRICT_MAX_SIZE_MB: 1, // Strict limit: single image must not exceed 1MB
  STRICT_MAX_SIZE_BYTES: 1 * 1024 * 1024, // 1MB in bytes

  // Compression parameters aligned with OpenAI's image processing algorithm.
  // Based on: https://platform.openai.com/docs/guides/vision#calculating-costs
  MAX_DIMENSION: 2048, // Maximum dimension limit
  SCALE_TARGET_DIMENSION: 768, // Scale target dimension
  DEFAULT_QUALITY: 0.8,

  // 🔥 New: More aggressive compression settings to prevent API requests from being too large
  AGGRESSIVE_QUALITY: 0.6, // Lower quality to reduce file size
  AGGRESSIVE_TARGET_DIMENSION: 512 // Smaller target dimension
} as const;

/**
 * Detect CSP compatibility of the current environment
 */
export async function detectCSPCompatibility(): Promise<CSPCompatibilityResult> {
  const result: CSPCompatibilityResult = {
    supportsBlobURL: false,
    supportsDataURL: false
  };

  // Test Data URL support
  try {
    const img = new Image();
    const testDataURL = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

    await new Promise<void>((resolve, reject) => {
      img.onload = () => {
        result.supportsDataURL = true;
        resolve();
      };
      img.onerror = () => reject(new Error('Data URL not supported'));
      img.src = testDataURL;

      // Set timeout
      setTimeout(() => reject(new Error('Data URL test timed out')), 2000);
    });
  } catch (error) {
    result.error = error instanceof Error ? error.message : 'Unknown error';
  }

  // Test Blob URL support
  try {
    const blob = new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], { type: 'image/png' });
    const url = URL.createObjectURL(blob);
    const img = new Image();

    await new Promise<void>((resolve, reject) => {
      img.onload = () => {
        result.supportsBlobURL = true;
        URL.revokeObjectURL(url);
        resolve();
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Blob URL not supported'));
      };
      img.src = url;

      // Set timeout
      setTimeout(() => {
        URL.revokeObjectURL(url);
        reject(new Error('Blob URL test timed out'));
      }, 2000);
    });
  } catch (error) {
  }

  return result;
}

/**
 * Detect image dimensions
 */
export function getImageDimensions(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        resolve({ width: img.width, height: img.height });
      };
      img.onerror = reject;
      img.src = reader.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * Image resizer aligned with OpenAI's vision token-cost guidance:
 * https://platform.openai.com/docs/guides/vision#calculating-costs
 *
 * Note: Uses OR (||) condition, not AND (&&)
 */
export async function resizeImageForLLM(data: Uint8Array | File, mimeType?: string): Promise<Uint8Array> {
  const isGif = mimeType === 'image/gif';

  let fileData: Uint8Array;
  if (data instanceof File) {
    fileData = new Uint8Array(await data.arrayBuffer());
    mimeType = data.type;
  } else {
    fileData = data;
  }

  return new Promise((resolve, reject) => {
    const blob = new Blob([new Uint8Array(fileData)], { type: mimeType });
    const reader = new FileReader();

    reader.onload = () => {
      const img = new Image();
      const dataUrl = reader.result as string;
      img.src = dataUrl;

      img.onload = () => {
      let { width, height } = img;


      // Skip compression if either dimension ≤ 768px and the image is not a GIF.
      if ((width <= 768 || height <= 768) && !isGif) {
        resolve(fileData);
        return;
      }


      // Two-phase compression algorithm.
      // Phase 1: If larger than 2048px, scale down to within 2048px first
      if (width > 2048 || height > 2048) {
        const scaleFactor = 2048 / Math.max(width, height);
        width = Math.round(width * scaleFactor);
        height = Math.round(height * scaleFactor);
      }

      // Phase 2: Scale short side to 768px
      const scaleFactor = 768 / Math.min(width, height);
      width = Math.round(width * scaleFactor);
      height = Math.round(height * scaleFactor);

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');

      if (!ctx) {
        reject(new Error('Failed to get canvas context'));
        return;
      }

      ctx.drawImage(img, 0, 0, width, height);

      // Format handling.
      const jpegTypes = ['image/jpeg', 'image/jpg'];
      const outputMimeType = mimeType && jpegTypes.includes(mimeType) ? 'image/jpeg' : 'image/png';

      canvas.toBlob(blob => {
        if (blob) {
          const reader = new FileReader();
          reader.onload = () => {
            resolve(new Uint8Array(reader.result as ArrayBuffer));
          };
          reader.onerror = (error) => reject(error);
          reader.readAsArrayBuffer(blob);
        } else {
          reject(new Error('Failed to create blob from canvas'));
        }
      }, outputMimeType);
      };

      img.onerror = (error) => {
        reject(error);
      };
    };

    reader.onerror = (error) => {
      reject(error);
    };

    reader.readAsDataURL(blob);
  });
}

/**
 * Smart compression — wrapper function.
 */
export async function smartCompressImage(file: File): Promise<ImageCompressionResult> {
  const originalSize = file.size;


  try {
    const compressedData = await resizeImageForLLM(file, file.type);

    // Determine output format
    const jpegTypes = ['image/jpeg', 'image/jpg'];
    const outputMimeType = jpegTypes.includes(file.type) ? 'image/jpeg' : 'image/png';
    const outputExtension = outputMimeType === 'image/jpeg' ? '.jpg' : '.png';

    // Create the compressed file
    const compressedFileName = file.name.replace(/\.[^/.]+$/, '') + outputExtension;
    const compressedFile = new File([new Uint8Array(compressedData)], compressedFileName, {
      type: outputMimeType,
      lastModified: Date.now()
    });

    const compressedSize = compressedFile.size;
    const compressionRatio = compressedSize / originalSize;
    const wasCompressed = compressedSize < originalSize;


    return {
      compressedFile,
      originalSize,
      compressedSize,
      compressionRatio,
      wasCompressed
    };

  } catch (error) {
    throw new Error(`Image compression failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Compression condition check.
 */
export async function shouldCompressImageBySize(file: File): Promise<boolean> {
  // File size check.
  if (file.size > 5 * 1024 * 1024) { // 5MB
    return true;
  }

  try {
    // Get image dimensions
    const dimensions = await getImageDimensions(file);
    const isGif = file.type === 'image/gif';

    // Compress if either dimension > 768px or if the image is a GIF.
    const needsCompression = (dimensions.width > 768 || dimensions.height > 768) || isGif;


    return needsCompression;
  } catch (error) {
    return false;
  }
}

/**
 * Image resizer (returns Uint8Array) using the same scaling rules as the
 * size-based path. See https://platform.openai.com/docs/guides/vision#calculating-costs.
 */
export async function resizeImageWithMode(
  data: Uint8Array | File,
  mimeType?: string
): Promise<Uint8Array> {
  const isGif = mimeType === 'image/gif';

  let fileData: Uint8Array;
  if (data instanceof File) {
    fileData = new Uint8Array(await data.arrayBuffer());
    mimeType = data.type;
  } else {
    fileData = data;
  }

  return new Promise((resolve, reject) => {
    try {
      const blob = new Blob([new Uint8Array(fileData)], { type: mimeType });
      const reader = new FileReader();


      reader.onload = () => {
        try {
          const img = new Image();
          const dataUrl = reader.result as string;
          img.src = dataUrl;

          img.onload = () => {
            try {
          let { width, height } = img;


          // Skip compression when both dimensions are ≤ 768px and the image is not a GIF.
          if ((width <= IMAGE_COMPRESSION_LIMITS.SCALE_TARGET_DIMENSION &&
               height <= IMAGE_COMPRESSION_LIMITS.SCALE_TARGET_DIMENSION) && !isGif) {
            resolve(fileData);
            return;
          }


          // Step 1: ensure neither dimension exceeds 2048px.
          if (width > IMAGE_COMPRESSION_LIMITS.MAX_DIMENSION ||
              height > IMAGE_COMPRESSION_LIMITS.MAX_DIMENSION) {
            const scaleFactor = IMAGE_COMPRESSION_LIMITS.MAX_DIMENSION / Math.max(width, height);
            width = Math.round(width * scaleFactor);
            height = Math.round(height * scaleFactor);
          }

          // Step 2: scale the short side down to 768px.
          const shortSide = Math.min(width, height);
          if (shortSide > IMAGE_COMPRESSION_LIMITS.SCALE_TARGET_DIMENSION) {
            const scaleFactor = IMAGE_COMPRESSION_LIMITS.SCALE_TARGET_DIMENSION / shortSide;
            width = Math.round(width * scaleFactor);
            height = Math.round(height * scaleFactor);
          }

          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');

          if (!ctx) {
            reject(new Error('Cannot get Canvas 2D context; browser may not support it'));
            return;
          }


          // Optimize large image handling: use more conservative rendering quality for better performance
          ctx.imageSmoothingEnabled = true;

          // Dynamically adjust rendering quality based on image size
          const pixelCount = width * height;
          if (pixelCount > 2000000) { // Use medium quality for images over 2M pixels
            ctx.imageSmoothingQuality = 'medium';
          } else {
            ctx.imageSmoothingQuality = 'high';
          }

          // Add Canvas drawing performance monitoring
          const drawStartTime = performance.now();

          try {
            ctx.drawImage(img, 0, 0, width, height);
            const drawEndTime = performance.now();
          } catch (error) {
            reject(new Error(`Canvas drawing failed: ${error instanceof Error ? error.message : 'Unknown error'}`));
            return;
          }

          // Format conversion.
          const jpegTypes = ['image/jpeg', 'image/jpg'];
          const outputMimeType = mimeType && jpegTypes.includes(mimeType) ?
            'image/jpeg' : 'image/png';


          // Use more efficient compression quality settings, optimized for large images
          const quality = outputMimeType === 'image/jpeg' ? IMAGE_COMPRESSION_LIMITS.DEFAULT_QUALITY : 0.9;

          // Add performance monitoring
          const blobStartTime = performance.now();

          canvas.toBlob(blob => {
            try {
              const blobEndTime = performance.now();

              if (!blob) {
                reject(new Error('Canvas to Blob conversion failed; image may be too large or format unsupported'));
                return;
              }


              // Use more efficient ArrayBuffer reading
              const reader = new FileReader();
              const readerStartTime = performance.now();

              reader.onload = () => {
                try {
                  const readerEndTime = performance.now();

                  const result = reader.result as ArrayBuffer;
                  if (!result) {
                    reject(new Error('FileReader result is empty'));
                    return;
                  }
                  resolve(new Uint8Array(result));
                } catch (error) {
                  reject(new Error(`FileReader processing failed: ${error instanceof Error ? error.message : 'Unknown error'}`));
                }
              };

              reader.onerror = (error) => {
                reject(new Error(`FileReader read failed: ${error}`));
              };

              // Add FileReader timeout handling
              const readerTimeout = setTimeout(() => {
                reject(new Error('FileReader timed out; file may be too large'));
              }, 30000);

              reader.addEventListener('loadend', () => {
                clearTimeout(readerTimeout);
              });

              reader.readAsArrayBuffer(blob);
            } catch (error) {
              reject(new Error(`Blob processing failed: ${error instanceof Error ? error.message : 'Unknown error'}`));
            }
          }, outputMimeType, quality);
            } catch (error) {
              reject(new Error(`Image processing failed: ${error instanceof Error ? error.message : 'Unknown error'}`));
            }
          };

          img.onerror = (error) => {
            reject(new Error(`Image failed to load; file may be corrupted or format unsupported: ${error}`));
          };
        } catch (error) {
          reject(new Error(`Image processing failed: ${error instanceof Error ? error.message : 'Unknown error'}`));
        }
      };

      reader.onerror = (error) => {
        reject(new Error(`File read failed; file may be corrupted: ${error}`));
      };

      reader.readAsDataURL(blob);
    } catch (error) {
      reject(new Error(`Compression initialization failed: ${error instanceof Error ? error.message : 'Unknown error'}`));
    }
  });
}

/**
 * 🔥 New: Aggressive compression mode — prevents GitHub Copilot API 413 errors
 * Uses smaller dimensions and lower quality to ensure file size stays within limits
 */
async function resizeImageAggressively(
  data: Uint8Array | File,
  mimeType?: string
): Promise<Uint8Array> {
  const isGif = mimeType === 'image/gif';

  let fileData: Uint8Array;
  if (data instanceof File) {
    fileData = new Uint8Array(await data.arrayBuffer());
    mimeType = data.type;
  } else {
    fileData = data;
  }

  return new Promise((resolve, reject) => {
    try {
      const blob = new Blob([new Uint8Array(fileData)], { type: mimeType });
      const reader = new FileReader();


      reader.onload = () => {
        try {
          const img = new Image();
          const dataUrl = reader.result as string;
          img.src = dataUrl;

          img.onload = () => {
            try {
              let { width, height } = img;


              // 🔥 Aggressive mode: scale directly to 512px (short side)
              const targetDimension = IMAGE_COMPRESSION_LIMITS.AGGRESSIVE_TARGET_DIMENSION;

              // Step 1: Ensure image does not exceed 1024px
              if (width > 1024 || height > 1024) {
                const scaleFactor = 1024 / Math.max(width, height);
                width = Math.round(width * scaleFactor);
                height = Math.round(height * scaleFactor);
              }

              // Step 2: Scale short side to 512px
              const shortSide = Math.min(width, height);
              if (shortSide > targetDimension) {
                const scaleFactor = targetDimension / shortSide;
                width = Math.round(width * scaleFactor);
                height = Math.round(height * scaleFactor);
              }

              const canvas = document.createElement('canvas');
              canvas.width = width;
              canvas.height = height;
              const ctx = canvas.getContext('2d');

              if (!ctx) {
                reject(new Error('Cannot get Canvas 2D context'));
                return;
              }


              // Use low quality settings for faster compression
              ctx.imageSmoothingEnabled = true;
              ctx.imageSmoothingQuality = 'low';

              try {
                ctx.drawImage(img, 0, 0, width, height);
              } catch (error) {
                reject(new Error(`Canvas drawing failed: ${error instanceof Error ? error.message : 'Unknown error'}`));
                return;
              }

              // 🔥 Force JPEG format and low quality for maximum compression
              const outputMimeType = 'image/jpeg';
              const quality = IMAGE_COMPRESSION_LIMITS.AGGRESSIVE_QUALITY; // 0.6


              canvas.toBlob(blob => {
                try {
                  if (!blob) {
                    reject(new Error('Aggressive compression: Canvas to Blob conversion failed'));
                    return;
                  }


                  const reader = new FileReader();

                  reader.onload = () => {
                    try {
                      const result = reader.result as ArrayBuffer;
                      if (!result) {
                        reject(new Error('Aggressive compression: FileReader result is empty'));
                        return;
                      }


                      resolve(new Uint8Array(result));
                    } catch (error) {
                      reject(new Error(`Aggressive compression FileReader processing failed: ${error instanceof Error ? error.message : 'Unknown error'}`));
                    }
                  };

                  reader.onerror = (error) => {
                    reject(new Error(`Aggressive compression FileReader read failed: ${error}`));
                  };

                  reader.readAsArrayBuffer(blob);
                } catch (error) {
                  reject(new Error(`Aggressive compression Blob processing failed: ${error instanceof Error ? error.message : 'Unknown error'}`));
                }
              }, outputMimeType, quality);
            } catch (error) {
              reject(new Error(`Aggressive compression image processing failed: ${error instanceof Error ? error.message : 'Unknown error'}`));
            }
          };

          img.onerror = (error) => {
            reject(new Error(`Aggressive compression image load failed: ${error}`));
          };
        } catch (error) {
          reject(new Error(`Aggressive compression image processing failed: ${error instanceof Error ? error.message : 'Unknown error'}`));
        }
      };

      reader.onerror = (error) => {
        reject(new Error(`Aggressive compression file read failed: ${error}`));
      };

      reader.readAsDataURL(blob);
    } catch (error) {
      reject(new Error(`Aggressive compression initialization failed: ${error instanceof Error ? error.message : 'Unknown error'}`));
    }
  });
}

/**
 * Check whether an image needs compression based on dimensions / GIF flag.
 */
export async function shouldCompressImageByMode(file: File): Promise<boolean> {
  // 1. Check whether file size exceeds the 5MB limit
  if (file.size > IMAGE_COMPRESSION_LIMITS.MAX_SIZE_BYTES) {
    return true;
  }

  // 2. Check image dimensions for compression conditions.
  try {
    const dimensions = await getImageDimensions(file);
    const isGif = file.type === 'image/gif';

    // Compress if image is larger than 768px or is a GIF.
    const needsCompression = (
      dimensions.width > IMAGE_COMPRESSION_LIMITS.SCALE_TARGET_DIMENSION &&
      dimensions.height > IMAGE_COMPRESSION_LIMITS.SCALE_TARGET_DIMENSION
    ) || isGif;


    return needsCompression;
  } catch (error) {
    return false;
  }
}

/**
 * Smart image compression with explicit mode selection.
 */
export async function smartCompressImageWithMode(file: File): Promise<ImageCompressionResult> {
  const originalSize = file.size;


  try {
    // 🔥 New: Check whether aggressive compression mode is needed
    const needsAggressiveCompression = originalSize > IMAGE_COMPRESSION_LIMITS.STRICT_MAX_SIZE_BYTES;

    if (needsAggressiveCompression) {

      // Use more aggressive compression parameters
      const aggressiveCompressedData = await resizeImageAggressively(file, file.type);

      // Determine output format — prefer JPEG to reduce file size
      const outputMimeType = 'image/jpeg'; // Force JPEG format
      const outputExtension = '.jpg';

      // Create the compressed file
      const compressedFileName = file.name.replace(/\.[^/.]+$/, '') + outputExtension;
      const compressedFile = new File([new Uint8Array(aggressiveCompressedData)], compressedFileName, {
        type: outputMimeType,
        lastModified: Date.now()
      });

      const compressedSize = compressedFile.size;
      const compressionRatio = compressedSize / originalSize;
      const wasCompressed = compressedSize < originalSize;


      // 🔥 Strict check: throw error if still too large after compression
      if (compressedSize > IMAGE_COMPRESSION_LIMITS.STRICT_MAX_SIZE_BYTES) {
        const compressedSizeMB = Math.round(compressedSize / (1024 * 1024) * 100) / 100;
        throw new Error(`Image is still too large (${compressedSizeMB}MB) even after aggressive compression and cannot be sent to the GitHub Copilot API. Please use a smaller source image.`);
      }

      return {
        compressedFile,
        originalSize,
        compressedSize,
        compressionRatio,
        wasCompressed
      };
    } else {
      // Use the standard compression algorithm.
      const compressedData = await resizeImageWithMode(file, file.type);

      // Determine output format.
      const jpegTypes = ['image/jpeg', 'image/jpg'];
      const outputMimeType = jpegTypes.includes(file.type) ? 'image/jpeg' : 'image/png';
      const outputExtension = outputMimeType === 'image/jpeg' ? '.jpg' : '.png';

      // Create the compressed file
      const compressedFileName = file.name.replace(/\.[^/.]+$/, '') + outputExtension;
      const compressedFile = new File([new Uint8Array(compressedData)], compressedFileName, {
        type: outputMimeType,
        lastModified: Date.now()
      });

      const compressedSize = compressedFile.size;
      const compressionRatio = compressedSize / originalSize;
      const wasCompressed = compressedSize < originalSize;


      return {
        compressedFile,
        originalSize,
        compressedSize,
        compressionRatio,
        wasCompressed
      };
    }

  } catch (error) {

    // Provide detailed error message and suggested solution
    let errorMessage = 'Image compression failed';
    let suggestedSolution = '';

    if (error instanceof Error) {
      if (error.message.includes('Canvas') || error.message.includes('canvas')) {
        errorMessage = 'Image compression failed: browser Canvas processing error';
        suggestedSolution = 'Possible cause: image too large or special format. Suggestion: use a smaller image or PNG/JPEG format';
      } else if (error.message.includes('Blob') || error.message.includes('blob')) {
        errorMessage = 'Image compression failed: image format conversion error';
        suggestedSolution = 'Suggestion: try a PNG or JPEG image';
      } else if (error.message.includes('FileReader') || error.message.includes('file read failed')) {
        errorMessage = 'Image compression failed: file read error';
        suggestedSolution = 'Suggestion: check if the image file is intact, or try resaving the image';
      } else if (error.message.includes('Image failed to load')) {
        errorMessage = 'Image compression failed: image cannot be loaded';
        suggestedSolution = 'Possible cause: corrupted file, unsupported format, or CSP restriction. Suggestion: use standard PNG/JPEG format';
      } else if (error.message.includes('Compression initialization failed')) {
        errorMessage = 'Image compression failed: initialization error';
        suggestedSolution = 'Suggestion: refresh the page and try again';
      } else if (error.message.includes('Content Security Policy') || error.message.includes('CSP')) {
        errorMessage = 'Image compression failed: security policy restriction';
        suggestedSolution = 'This error has been fixed by using data URLs. If it persists, please contact technical support';
      } else {
        errorMessage = `Image compression failed: ${error.message}`;
        suggestedSolution = 'Suggestion: try a smaller image file or a different image format';
      }
    } else {
      errorMessage = `Image compression failed: unknown error type (${typeof error})`;
      suggestedSolution = 'Suggestion: try a smaller image file; PNG or JPEG format is recommended';
    }

    const finalErrorMessage = suggestedSolution ?
      `${errorMessage}. ${suggestedSolution}` : errorMessage;

    throw new Error(finalErrorMessage);
  }
}

/**
 * Validate whether image file size is within the configured limits.
 */
export function validateImageFileSize(file: File): { isValid: boolean; error?: string } {
  if (file.size > IMAGE_COMPRESSION_LIMITS.MAX_SIZE_BYTES) {
    const fileSizeMB = Math.round(file.size / (1024 * 1024) * 10) / 10;
    return {
      isValid: false,
      error: `Image file too large (${fileSizeMB}MB); exceeds the ${IMAGE_COMPRESSION_LIMITS.MAX_SIZE_MB}MB limit.`
    };
  }
  return { isValid: true };
}

/**
 * Check whether a file needs compression — simplified backwards-compatible version
 */
export function shouldCompressImage(file: File): boolean {
  // Simplified version; primarily checks file size
  const sizeKB = Math.round(file.size / 1024);
  const sizeMB = Math.round(file.size / (1024 * 1024) * 10) / 10;


  // Recommend compression if file exceeds 2MB
  return sizeMB > 2;
}

/**
 * Estimate base64 size (for pre-flight checks)
 */
export function estimateBase64Size(fileSizeBytes: number): number {
  // Base64 encoding increases size by approximately 33%
  return Math.round(fileSizeBytes * 1.33);
}

// Backwards-compatible exports
export const GITHUB_COPILOT_IMAGE_LIMITS = IMAGE_COMPRESSION_LIMITS;
export const shouldCompressImageAdvanced = shouldCompressImageByMode;