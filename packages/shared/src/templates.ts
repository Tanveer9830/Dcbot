import { ValidationError } from './errors.js';

/**
 * Safe template renderer.
 *
 * This is the ONLY templating mechanism allowed for user/owner supplied text
 * (global custom commands, welcome messages, branding responses). It performs a
 * single-pass variable substitution over a fixed allowlist. There is:
 *   - no eval / Function / vm usage,
 *   - no expression language,
 *   - no recursion into rendered values (so a value containing {{x}} is inert),
 *   - an optional escaper applied to every substituted value.
 */

export type TemplateVariables = Record<string, string | number | bigint | null | undefined>;

export interface RenderOptions {
  /** Reject templates that reference variables outside `variables`. Default true. */
  strict?: boolean;
  /** Escaper applied to each substituted value. */
  escape?: (value: string) => string;
  /** Hard limit on the final rendered length. */
  maxLength?: number;
}

export const TEMPLATE_VARIABLE_REGEX = /\{\{\s*([a-z0-9_.]+)\s*\}\}/gi;

/** Characters/patterns that have no business in a static template. */
const FORBIDDEN_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: 'script tag', pattern: /<\s*script[\s>]/i },
  { name: 'iframe tag', pattern: /<\s*iframe[\s>]/i },
  { name: 'javascript URI', pattern: /javascript\s*:/i },
  { name: 'data URI', pattern: /\bdata\s*:[^,]*base64/i },
  { name: 'at-everyone', pattern: /@(everyone|here)\b/i },
  { name: 'code fence', pattern: /```/ },
];

export function assertSafeTemplate(template: string, maxLength = 2000): void {
  if (typeof template !== 'string') {
    throw new ValidationError('Template must be a string.');
  }
  if (template.length > maxLength) {
    throw new ValidationError(`Template is too long (max ${maxLength} characters).`);
  }
  for (const { name, pattern } of FORBIDDEN_PATTERNS) {
    if (pattern.test(template)) {
      throw new ValidationError(`Template rejected: it contains a disallowed ${name}.`);
    }
  }
  // Reject malformed braces so authors notice typos instead of shipping junk.
  const opens = (template.match(/\{/g) ?? []).length;
  const closes = (template.match(/\}/g) ?? []).length;
  if (opens !== closes) {
    throw new ValidationError('Template has unbalanced braces.');
  }
}

/**
 * Renders `{{variable}}` placeholders. Unknown variables are either removed
 * (lenient) or raise a ValidationError (strict, the default).
 */
export function renderTemplate(
  template: string,
  variables: TemplateVariables,
  options: RenderOptions = {},
): string {
  const { strict = true, escape = (value) => value, maxLength = 4000 } = options;
  assertSafeTemplate(template, maxLength);

  const seenUnknown = new Set<string>();
  // Single pass: substituted values are never re-scanned.
  const rendered = template.replace(TEMPLATE_VARIABLE_REGEX, (match, rawName: string) => {
    const name = rawName.toLowerCase();
    if (!Object.hasOwn(variables, name)) {
      seenUnknown.add(name);
      return '';
    }
    const value = variables[name];
    if (value === null || value === undefined) return '';
    return escape(String(value));
  });

  if (strict && seenUnknown.size > 0) {
    throw new ValidationError(`Unknown template variable(s): ${[...seenUnknown].join(', ')}.`, [
      ...seenUnknown,
    ]);
  }
  if (rendered.length > maxLength) {
    throw new ValidationError(`Rendered output exceeds ${maxLength} characters.`);
  }
  return rendered;
}

/** Escapes Discord markdown so a value cannot break out of its formatting. */
export function escapeDiscordMarkdown(value: string): string {
  return value.replace(/([\\`*_~|>[\]()])/g, '\\$1');
}

/** Escapes HTML for the dashboard. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Variables available to every template in the project (documentation + validation). */
export const KNOWN_TEMPLATE_VARIABLES = [
  'user',
  'user.id',
  'user.tag',
  'author',
  'author.id',
  'guild',
  'guild.id',
  'channel',
  'channel.id',
  'member_count',
  'date',
  'timestamp',
  'content',
  'args',
  'response',
  'level',
  'xp',
  'balance',
  'currency',
  'reason',
  'case_id',
  'count',
] as const;

/** Validates that a template only references documented variables. */
export function findUnknownVariables(template: string): string[] {
  const known = new Set<string>(KNOWN_TEMPLATE_VARIABLES);
  const unknown = new Set<string>();
  for (const match of template.matchAll(TEMPLATE_VARIABLE_REGEX)) {
    const name = (match[1] ?? '').toLowerCase();
    if (name && !known.has(name)) unknown.add(name);
  }
  return [...unknown];
}
