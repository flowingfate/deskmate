// src/main/lib/utilities/errors.ts
// Error classes for main process

export class GhcApiError extends Error {
  public statusCode: number;

  constructor(message: string, statusCode: number = 500) {
    super(message);
    this.name = 'GhcApiError';
    this.statusCode = statusCode;

    // Maintain prototype chain
    Object.setPrototypeOf(this, GhcApiError.prototype);
  }
}

export class AuthenticationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthenticationError';
    Object.setPrototypeOf(this, AuthenticationError.prototype);
  }
}

export class NetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NetworkError';
    Object.setPrototypeOf(this, NetworkError.prototype);
  }
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
    Object.setPrototypeOf(this, ValidationError.prototype);
  }
}

export class CancellationError extends Error {
  constructor(message: string = 'Operation was cancelled') {
    super(message);
    this.name = 'CancellationError';
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, CancellationError);
    }
  }
}

export function isCancellationError(error: unknown): error is CancellationError {
  return error instanceof CancellationError ||
         (error instanceof Error && error.name === 'CancellationError');
}