import { AuthorizationError, OwnerOnlyError } from './errors.js';
import { isSnowflake, maskId, parseIdList } from './ids.js';

export interface OwnerPolicyOptions {
  /** Raw BOT_OWNER_IDS value. */
  raw: string | undefined | null;
  /**
   * When true the policy refuses to construct with an empty/invalid owner list.
   * Production uses true; tests may pass false to exercise the non-owner path.
   */
  strict?: boolean;
}

/**
 * The single source of truth for "is this user a bot owner".
 *
 * Rules implemented here (and nowhere else in the codebase):
 *  - Every configured owner ID has identical privileges.
 *  - Guild Administrator permission NEVER implies bot ownership.
 *  - An empty owner list denies everyone when strict.
 *  - Owner checks are constant time with respect to list order (Set lookup).
 */
export class OwnerPolicy {
  private readonly owners: ReadonlySet<string>;
  public readonly strict: boolean;

  constructor(options: OwnerPolicyOptions) {
    const { ids, invalid } = parseIdList(options.raw);
    this.strict = options.strict ?? true;
    if (invalid.length > 0) {
      throw new Error(
        `BOT_OWNER_IDS contains invalid entries: ${invalid.map(maskId).join(', ')}. ` +
          'Each entry must be a numeric Discord snowflake.',
      );
    }
    if (this.strict && ids.length === 0) {
      throw new Error('BOT_OWNER_IDS must contain at least one valid owner ID.');
    }
    this.owners = new Set(ids);
  }

  /** True only for the explicitly configured owner IDs. */
  isOwner(userId: string | null | undefined): boolean {
    if (!userId) return false;
    if (!isSnowflake(userId)) return false;
    return this.owners.has(userId);
  }

  /** Number of configured owners. */
  get count(): number {
    return this.owners.size;
  }

  /** Masked owner IDs, safe for logs and dashboard display. */
  listMasked(): string[] {
    return [...this.owners].map(maskId);
  }

  /** Returns `true` for owners, otherwise throws OwnerOnlyError. */
  requireOwner(userId: string | null | undefined, action = 'manage bot-owner resources'): true {
    if (!this.isOwner(userId)) throw new OwnerOnlyError(action);
    return true;
  }

  /** Owner gate that throws a generic AuthorizationError instead of OwnerOnlyError. */
  requireOwnerSilently(userId: string | null | undefined): true {
    if (!this.isOwner(userId)) throw new AuthorizationError();
    return true;
  }
}

/**
 * Convenience helper for contexts that already hold a session object
 * (dashboard route handlers).
 */
export function assertOwner(
  session: { userId?: string | null } | null | undefined,
  action = 'access the owner panel',
): void {
  if (!session?.userId) throw new AuthorizationError('Sign in to continue.');
  // The dashboard uses the same policy semantics: only configured owners pass.
  const raw = process.env.BOT_OWNER_IDS;
  const policy = new OwnerPolicy({ raw, strict: false });
  policy.requireOwner(session.userId, action);
}
