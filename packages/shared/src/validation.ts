import { z } from 'zod';
import { CUSTOM_COMMAND_NAME_REGEX, DISCORD_LIMITS } from './constants.js';

const snowflake = z.string().regex(/^[0-9]{15,25}$/, 'must be a Discord snowflake');

/** Reason text attached to moderation actions. */
export const reasonSchema = z
  .string()
  .trim()
  .min(1, 'A reason is required.')
  .max(500, 'Reason must be 500 characters or fewer.');

export const optionalReasonSchema = reasonSchema.optional();

/** Custom command definitions (global and guild scoped). */
export const customCommandNameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(CUSTOM_COMMAND_NAME_REGEX, 'Use 2-32 lowercase letters, numbers, dashes or underscores.');

export const customCommandContentSchema = z
  .string()
  .trim()
  .min(1, 'Response content is required.')
  .max(DISCORD_LIMITS.MAX_MESSAGE_CONTENT, `Response must be ${DISCORD_LIMITS.MAX_MESSAGE_CONTENT} characters or fewer.`);

export const embedFieldSchema = z.object({
  name: z.string().trim().min(1).max(256),
  value: z.string().trim().min(1).max(1024),
  inline: z.boolean().optional().default(false),
});

export const embedSchema = z.object({
  title: z.string().trim().max(DISCORD_LIMITS.MAX_EMBED_TITLE).optional(),
  description: z.string().trim().max(DISCORD_LIMITS.MAX_EMBED_DESCRIPTION).optional(),
  color: z.number().int().min(0).max(0xffffff).optional(),
  fields: z.array(embedFieldSchema).max(DISCORD_LIMITS.MAX_EMBED_FIELDS).optional(),
  footer: z.string().trim().max(2048).optional(),
  thumbnail: z.string().url().optional(),
});

export const customCommandSchema = z
  .object({
    name: customCommandNameSchema,
    description: z.string().trim().min(1).max(DISCORD_LIMITS.MAX_DESCRIPTION_LENGTH),
    responseType: z.enum(['text', 'embed']),
    content: customCommandContentSchema.optional(),
    embed: embedSchema.optional(),
    ephemeral: z.boolean().optional().default(false),
    deleteInvocation: z.boolean().optional().default(false),
    enabled: z.boolean().optional().default(true),
  })
  .refine((value) => value.responseType !== 'text' || Boolean(value.content), {
    message: 'content is required when responseType is "text".',
    path: ['content'],
  })
  .refine((value) => value.responseType !== 'embed' || Boolean(value.embed), {
    message: 'embed is required when responseType is "embed".',
    path: ['embed'],
  });

/** Guild settings patch coming from the dashboard. */
export const channelIdSchema = snowflake.or(z.literal(''));
export const roleIdSchema = snowflake.or(z.literal(''));

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(20),
});

export const amountSchema = z.coerce
  .number()
  .int('Amount must be a whole number.')
  .positive('Amount must be greater than zero.')
  .max(1_000_000_000, 'Amount is too large.');

export const guildIdSchema = snowflake;
export const userIdSchema = snowflake;

export { snowflake };
