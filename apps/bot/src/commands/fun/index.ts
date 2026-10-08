import { SlashCommandBuilder } from 'discord.js';
import { defineCommand } from '../helpers.js';

/** Fair, seeded choices - no money involved, no payout. */
const coinflip = defineCommand({
  data: new SlashCommandBuilder().setName('coinflip').setDescription('Flips a coin.'),
  description: 'Flips a coin.',
  guildOnly: false,
  requiresDatabase: false,
  cooldownMs: 2000,
  async execute(ctx) {
    await ctx.reply({ content: Math.random() < 0.5 ? '🪙 Heads.' : '🪙 Tails.' });
  },
});

const dice = defineCommand({
  data: new SlashCommandBuilder()
    .setName('dice')
    .setDescription('Rolls dice, e.g. 2d6.')
    .addStringOption((option) =>
      option.setName('roll').setDescription('Format: NdS (default 1d6)'),
    ),
  description: 'Rolls dice.',
  guildOnly: false,
  requiresDatabase: false,
  cooldownMs: 2000,
  async execute(ctx) {
    const input = ctx.interaction.options.getString('roll') ?? '1d6';
    const match = /^(\d{1,2})d(\d{1,3})$/i.exec(input.trim());
    if (!match) {
      await ctx.reply({ content: 'Use the format `2d6`.', ephemeral: true });
      return;
    }
    const count = Math.min(20, Number(match[1]));
    const sides = Math.min(1000, Number(match[2]));
    const rolls = Array.from({ length: count }, () => 1 + Math.floor(Math.random() * sides));
    const total = rolls.reduce((sum, value) => sum + value, 0);
    await ctx.reply({ content: `🎲 ${input}: ${rolls.join(', ')} = **${total}**` });
  },
});

const rps = defineCommand({
  data: new SlashCommandBuilder()
    .setName('rps')
    .setDescription('Plays rock-paper-scissors against the bot.')
    .addStringOption((option) =>
      option
        .setName('choice')
        .setDescription('Your choice')
        .addChoices(
          { name: 'rock', value: 'rock' },
          { name: 'paper', value: 'paper' },
          { name: 'scissors', value: 'scissors' },
        )
        .setRequired(true),
    ),
  description: 'Plays rock-paper-scissors against the bot.',
  guildOnly: false,
  requiresDatabase: false,
  cooldownMs: 2000,
  async execute(ctx) {
    const moves = ['rock', 'paper', 'scissors'] as const;
    const player = ctx.interaction.options.getString('choice', true) as (typeof moves)[number];
    const bot = moves[Math.floor(Math.random() * 3)]!;
    const outcomes: Record<string, number> = { rock: 0, paper: 1, scissors: 2 };
    const diff = (outcomes[player]! - outcomes[bot]! + 3) % 3;
    const result = diff === 0 ? "It's a tie." : diff === 1 ? 'You win.' : 'You lose.';
    const emoji = { rock: '🪨', paper: '📄', scissors: '✂️' } as const;
    await ctx.reply({ content: `${emoji[player]} vs ${emoji[bot]} - ${result}` });
  },
});

export default [coinflip, dice, rps];
