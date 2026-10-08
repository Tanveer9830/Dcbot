import { describe, expect, it } from 'vitest';
import { ValidationError } from '@dcbot/shared';
import { safeEvaluate } from '../../apps/bot/src/commands/utility/tools.js';

describe('calculator (safeEvaluate)', () => {
  it('handles precedence, parentheses and unary minus', () => {
    expect(safeEvaluate('2 + 3 * 4')).toBe(14);
    expect(safeEvaluate('(2 + 3) * 4')).toBe(20);
    expect(safeEvaluate('-5 + 3')).toBe(-2);
    expect(safeEvaluate('-(2 + 3)')).toBe(-5);
    expect(safeEvaluate('2 * -3')).toBe(-6);
    expect(safeEvaluate('10 / 4')).toBe(2.5);
    expect(safeEvaluate('10 % 3')).toBe(1);
    expect(safeEvaluate('1.5 * 2')).toBe(3);
    expect(safeEvaluate('  7  -  2  ')).toBe(5);
  });

  it('refuses to evaluate anything that is not arithmetic', () => {
    for (const input of [
      'alert(1)',
      'process.exit(1)',
      'require("fs")',
      'console.log(1)',
      '2 ** 10',
      '2; DROP TABLE users',
      '',
      '   ',
      '1 + ',
      '(1 + 2',
      'a + b',
    ]) {
      expect(safeEvaluate(input), input).toBeNull();
    }
  });

  it('rejects input that is too long', () => {
    expect(safeEvaluate('1+'.repeat(200))).toBeNull();
  });

  it('reports division by zero instead of returning Infinity', () => {
    expect(() => safeEvaluate('1 / 0')).toThrow(ValidationError);
    expect(() => safeEvaluate('5 % 0')).toThrow(ValidationError);
    expect(() => safeEvaluate('1 / (3 - 3)')).toThrow(ValidationError);
  });

  it('reports division by zero for a syntactically valid expression only', () => {
    expect(() => safeEvaluate('2 / 0 * 5')).toThrow(ValidationError);
    // Malformed input stays a plain null, which the command turns into its
    // "only digits and operators are allowed" hint.
    expect(safeEvaluate('(1 + 2')).toBeNull();
  });
});
