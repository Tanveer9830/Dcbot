import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  EmbedBuilder,
  type Interaction,
  type ButtonInteraction,
  type InteractionCollector,
  type Message,
} from 'discord.js';

export interface Page {
  title: string;
  lines: string[];
}

/** Splits items into fixed-size pages. */
export function paginate<T>(items: readonly T[], perPage: number): T[][] {
  if (perPage <= 0) throw new RangeError('perPage must be positive');
  const pages: T[][] = [];
  for (let i = 0; i < items.length; i += perPage) {
    pages.push(items.slice(i, i + perPage));
  }
  return pages.length > 0 ? pages : [[]];
}

export function buildPageEmbed(page: Page, index: number, total: number, color = 0x5865f2): EmbedBuilder {
  const embed = new EmbedBuilder().setTitle(page.title).setColor(color);
  const body = page.lines.length > 0 ? page.lines.join('\n') : '_Nothing to show yet._';
  embed.setDescription(body.length > 4000 ? `${body.slice(0, 3997)}…` : body);
  if (total > 1) embed.setFooter({ text: `Page ${index + 1} of ${total}` });
  return embed;
}

/**
 * Sends a paginated embed with Prev/Next buttons and wires a component
 * collector. Returns the message; the collector stops on timeout.
 */
export async function sendPaginated(
  interaction: Interaction,
  pages: Page[],
  options: { timeoutMs?: number; ephemeral?: boolean; color?: number } = {},
): Promise<Message | null> {
  if (!interaction.isChatInputCommand() && !interaction.isButton() && !interaction.isSelectMenu()) {
    return null;
  }
  let index = 0;
  const total = pages.length;
  const timeoutMs = options.timeoutMs ?? 120_000;

  const row = () =>
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId('page_prev')
        .setLabel('Previous')
        .setEmoji('⬅️')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(index === 0),
      new ButtonBuilder()
        .setCustomId('page_next')
        .setLabel('Next')
        .setEmoji('➡️')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(index >= total - 1),
    );

  const payload = {
    embeds: [buildPageEmbed(pages[index]!, index, total, options.color)],
    components: total > 1 ? [row()] : [],
    ephemeral: options.ephemeral ?? false,
  };

  let message: Message;
  if (interaction.deferred || interaction.replied) {
    message = await interaction.editReply(payload);
  } else {
    message = (await interaction.reply({ ...payload, fetchReply: true })) as Message;
  }
  if (total <= 1) return message;

  const collector: InteractionCollector<ButtonInteraction> = message.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: timeoutMs,
    filter: (component) => component.user.id === interaction.user.id,
  });

  collector.on('collect', async (component) => {
    if (component.customId === 'page_prev') index = Math.max(0, index - 1);
    if (component.customId === 'page_next') index = Math.min(total - 1, index + 1);
    await component.update({
      embeds: [buildPageEmbed(pages[index]!, index, total, options.color)],
      components: [row()],
    });
  });
  collector.on('end', () => {
    message
      .edit({ components: [] })
      .catch(() => {
        /* message may be gone */
      });
  });
  return message;
}
