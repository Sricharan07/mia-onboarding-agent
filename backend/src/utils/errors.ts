export class AppError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly details?: unknown;

  constructor(code: string, message: string, statusCode = 400, details?: unknown) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

export class ConfigError extends AppError {
  constructor(message: string, details?: unknown) {
    super("CONFIG_ERROR", message, 500, details);
  }
}

export class NotFoundError extends AppError {
  constructor(message: string, details?: unknown) {
    super("NOT_FOUND", message, 404, details);
  }
}

export class ValidationAppError extends AppError {
  constructor(message: string, details?: unknown) {
    super("VALIDATION_ERROR", message, 400, details);
  }
}
