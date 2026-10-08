/** Base class for every error this project throws deliberately. */
export class DcbotError extends Error {
  public readonly code: string;
  public readonly userFacing: boolean;

  constructor(message: string, code = 'DCBOT_ERROR', userFacing = false) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.userFacing = userFacing;
  }
}

/** Thrown when the caller lacks permission. Safe to show to end users. */
export class AuthorizationError extends DcbotError {
  constructor(message = 'You do not have permission to do that.', code = 'FORBIDDEN') {
    super(message, code, true);
  }
}

/** Thrown when owner-only functionality is used by a non-owner. */
export class OwnerOnlyError extends AuthorizationError {
  constructor(action = 'manage bot-owner resources') {
    super(
      `This action is restricted to the configured bot owners. You cannot ${action}.`,
      'OWNER_ONLY',
    );
    this.name = 'OwnerOnlyError';
  }
}

/** Thrown when input fails validation. Safe to show to end users. */
export class ValidationError extends DcbotError {
  public readonly issues: readonly string[];

  constructor(message: string, issues: readonly string[] = []) {
    super(message, 'VALIDATION_ERROR', true);
    this.issues = issues;
  }
}

/** Thrown for configuration problems. Never shown verbatim to users. */
export class ConfigurationError extends DcbotError {
  constructor(message: string) {
    super(message, 'CONFIGURATION_ERROR', false);
  }
}

/** Thrown when an operation targets something that does not exist. */
export class NotFoundError extends DcbotError {
  constructor(what: string) {
    super(`${what} was not found.`, 'NOT_FOUND', true);
  }
}

/** Thrown when an external dependency (Lavalink, Discord, ...) is unavailable. */
export class ServiceUnavailableError extends DcbotError {
  constructor(service: string, detail = '') {
    super(
      `${service} is currently unavailable.${detail ? ` ${detail}` : ''}`,
      'SERVICE_UNAVAILABLE',
      true,
    );
  }
}

/** Thrown when an economy operation would drive a balance below zero. */
export class InsufficientFundsError extends DcbotError {
  constructor(message = 'Not enough funds for that operation.') {
    super(message, 'INSUFFICIENT_FUNDS', true);
    this.name = 'InsufficientFundsError';
  }
}

/** Thrown when an idempotency key has already been consumed. */
export class DuplicateOperationError extends DcbotError {
  constructor(message = 'That operation was already performed.') {
    super(message, 'DUPLICATE_OPERATION', true);
    this.name = 'DuplicateOperationError';
  }
}

/** Thrown when a cooldown has not elapsed yet. */
export class CooldownError extends DcbotError {
  public readonly readyAt: Date;

  constructor(readyAt: Date, message?: string) {
    super(message ?? 'That action is still on cooldown.', 'COOLDOWN', true);
    this.name = 'CooldownError';
    this.readyAt = readyAt;
  }
}
