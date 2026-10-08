import { describe, expect, it } from 'vitest';
import {
  assertSafeTemplate,
  escapeDiscordMarkdown,
  escapeHtml,
  findUnknownVariables,
  KNOWN_TEMPLATE_VARIABLES,
  renderTemplate,
  ValidationError,
} from '@dcbot/shared';

describe('template rendering', () => {
  it('substitutes allowlisted variables', () => {
    expect(renderTemplate('Hi {{user}}, welcome to {{guild}}.', { user: 'Ada', guild: 'Lab' })).toBe(
      'Hi Ada, welcome to Lab.',
    );
    expect(renderTemplate('{{ member_count }} members', { member_count: 42 })).toBe('42 members');
  });

  it('is case insensitive and tolerates padding inside the braces', () => {
    expect(renderTemplate('{{ USER }}-{{user}}', { user: 'x' })).toBe('x-x');
  });

  it('refuses unknown variables in strict mode and lists them', () => {
    expect(() => renderTemplate('{{nope}}', { user: 'x' })).toThrow(ValidationError);
    try {
      renderTemplate('{{nope}} and {{also_nope}}', {});
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).issues).toEqual(['nope', 'also_nope']);
    }
  });

  it('drops unknown variables in lenient mode', () => {
    expect(renderTemplate('[{{nope}}]{{user}}', { user: 'x' }, { strict: false })).toBe('[]x');
  });

  it('never re-scans substituted values, so injected placeholders stay inert', () => {
    expect(renderTemplate('{{user}}', { user: '{{guild}}' })).toBe('{{guild}}');
  });

  it('is not an expression language: code is treated as literal text', () => {
    // There is no eval/Function/vm path, so this must come back verbatim.
    expect(renderTemplate('process.exit(1) {{user}} 1+1', { user: 'x' })).toBe('process.exit(1) x 1+1');
  });

  it('applies the escaper to values only', () => {
    const rendered = renderTemplate('**{{user}}**', { user: '*evil*' }, { escape: escapeDiscordMarkdown });
    expect(rendered).toBe('**\\*evil\\***');
  });

  it('enforces a maximum rendered length', () => {
    expect(() => renderTemplate('{{user}}', { user: 'a'.repeat(500) }, { maxLength: 100 })).toThrow(
      /exceeds 100 characters/,
    );
  });

  it('rejects dangerous templates outright', () => {
    for (const bad of [
      '<script>alert(1)</script>',
      '<iframe src="x"></iframe>',
      'javascript:alert(1)',
      'data:text/plain;base64,AAAA',
      '@everyone ping',
      '```code fence```',
    ]) {
      expect(() => assertSafeTemplate(bad), bad).toThrow(ValidationError);
    }
    expect(() => assertSafeTemplate('{{user')).toThrow(/unbalanced braces/);
    expect(() => assertSafeTemplate('a'.repeat(2001))).toThrow(/too long/);
    expect(() => assertSafeTemplate('plain text {{user}}')).not.toThrow();
  });

  it('documents every variable and finds the unknown ones', () => {
    expect(KNOWN_TEMPLATE_VARIABLES).toContain('user');
    expect(findUnknownVariables('{{user}} said {{made_up}} to {{guild}}')).toEqual(['made_up']);
    expect(findUnknownVariables('{{user}} {{guild}}')).toEqual([]);
  });

  it('escapes HTML for dashboard output', () => {
    expect(escapeHtml(`<img src=x onerror="alert('1')">`)).toBe(
      '&lt;img src=x onerror=&quot;alert(&#39;1&#39;)&quot;&gt;',
    );
  });
});
