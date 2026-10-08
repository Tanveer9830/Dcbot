import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { defineCommand, COLORS, ValidationError } from '../helpers.js';
import { discordTimestamp, formatDuration, parseDuration } from '../../utils/format.js';

const timestamp = defineCommand({
  data: new SlashCommandBuilder()
    .setName('timestamp')
    .setDescription('Converts a duration into a Discord timestamp.')
    .addStringOption((option) =>
      option.setName('in').setDescription('Duration from now, e.g. 30m, 2h, 1d').setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName('style')
        .setDescription('Discord timestamp style')
        .addChoices(
          { name: 'Relative (R)', value: 'R' },
          { name: 'Short time (t)', value: 't' },
          { name: 'Long time (T)', value: 'T' },
          { name: 'Short date (d)', value: 'd' },
          { name: 'Long date (D)', value: 'D' },
          { name: 'Long date/time (F)', value: 'F' },
        ),
    ),
  description: 'Converts a duration into a Discord timestamp.',
  guildOnly: false,
  requiresDatabase: false,
  cooldownMs: 3000,
  async execute(ctx) {
    const input = ctx.interaction.options.getString('in', true);
    const style = (ctx.interaction.options.getString('style') ?? 'R') as
      'R' | 't' | 'T' | 'd' | 'D' | 'F';
    const ms = parseDuration(input);
    if (ms === null)
      throw new ValidationError('Could not read that duration. Try `30m`, `2h` or `1d`.');
    const when = new Date(Date.now() + ms);
    await ctx.reply(
      `${formatDuration(ms)} from now is ${discordTimestamp(when, style)} (\`${when.toISOString()}\`).`,
    );
  },
});

const calculator = defineCommand({
  data: new SlashCommandBuilder()
    .setName('calculator')
    .setDescription('Evaluates a basic arithmetic expression (no code execution).')
    .addStringOption((option) =>
      option.setName('expression').setDescription('e.g. (12 + 7) * 3 / 4').setRequired(true),
    ),
  description: 'Evaluates a basic arithmetic expression (no code execution).',
  guildOnly: false,
  requiresDatabase: false,
  cooldownMs: 3000,
  async execute(ctx) {
    const expression = ctx.interaction.options.getString('expression', true);
    const result = safeEvaluate(expression);
    if (result === null) {
      throw new ValidationError('Only digits, spaces, . + - * / % ( ) are allowed.');
    }
    await ctx.reply(`\`${expression}\` = **${result}**`);
  },
});

export default [timestamp, calculator];

/**
 * A hand-written arithmetic evaluator.
 *
 * Deliberately NOT eval/Function: user input never becomes code. Supports
 * + - * / % and parentheses with correct precedence, unary minus, and decimals.
 */
/**
 * Thrown for the one arithmetic problem worth naming: the expression parsed
 * correctly, so "only digits and operators are allowed" would be a lie.
 */
class DivisionByZeroError extends ValidationError {}

export function safeEvaluate(input: string): number | null {
  const cleaned = input.replace(/\s+/g, '');
  if (!cleaned || cleaned.length > 200) return null;
  if (!/^[0-9+\-*/%.()]+$/.test(cleaned)) return null;

  let position = 0;

  function parseExpression(): number {
    let value = parseTerm();
    while (position < cleaned.length) {
      const operator = cleaned[position];
      if (operator === '+') {
        position += 1;
        value += parseTerm();
      } else if (operator === '-') {
        position += 1;
        value -= parseTerm();
      } else {
        break;
      }
    }
    return value;
  }

  function parseTerm(): number {
    let value = parseFactor();
    while (position < cleaned.length) {
      const operator = cleaned[position];
      if (operator === '*') {
        position += 1;
        value *= parseFactor();
      } else if (operator === '/') {
        position += 1;
        const divisor = parseFactor();
        if (divisor === 0) throw new DivisionByZeroError('Division by zero.');
        value /= divisor;
      } else if (operator === '%') {
        position += 1;
        const divisor = parseFactor();
        if (divisor === 0) throw new DivisionByZeroError('Division by zero.');
        value %= divisor;
      } else {
        break;
      }
    }
    return value;
  }

  function parseFactor(): number {
    if (cleaned[position] === '(') {
      position += 1;
      const value = parseExpression();
      if (cleaned[position] !== ')') throw new ValidationError('Unbalanced parentheses.');
      position += 1;
      return value;
    }
    if (cleaned[position] === '-') {
      position += 1;
      return -parseFactor();
    }
    if (cleaned[position] === '+') {
      position += 1;
      return parseFactor();
    }
    const start = position;
    while (position < cleaned.length && /[0-9.]/.test(cleaned[position]!)) position += 1;
    const literal = cleaned.slice(start, position);
    if (!literal) throw new ValidationError('Expected a number.');
    const value = Number(literal);
    if (!Number.isFinite(value))
      throw new ValidationError('That expression is not a finite number.');
    return value;
  }

  try {
    const value = parseExpression();
    if (position !== cleaned.length) return null;
    if (!Number.isFinite(value)) return null;
    return Math.round(value * 1e6) / 1e6;
  } catch (error) {
    // Unparseable input returns null so the command can give its generic "only
    // digits and operators" hint. A diagnosed arithmetic error keeps its message.
    if (error instanceof DivisionByZeroError) throw error;
    return null;
  }
}

export const calculatorEmbed = new EmbedBuilder().setColor(COLORS.neutral);
