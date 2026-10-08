import type { BotContext } from '../types.js';

export interface JobHandle {
  stop: () => void;
}

/**
 * Background jobs.
 *
 * Each job runs on its own interval, is individually guarded, and can be
 * stopped for graceful shutdown. A failing job is logged (throttled) and never
 * cancels the others.
 */
export function startBackgroundJobs(ctx: BotContext): JobHandle {
  const timers: NodeJS.Timeout[] = [];
  const logger = ctx.logger.child({ scope: 'scheduler' });

  const every = (name: string, intervalMs: number, work: () => Promise<void>): void => {
    const timer = setInterval(async () => {
      try {
        await work();
      } catch (error) {
        logger.warn(`job failed: ${name}`, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }, intervalMs);
    timer.unref?.();
    timers.push(timer);
  };

  // Giveaways whose end time has passed.
  every('giveaways', 30_000, async () => {
    const service = ctx.services.giveaways;
    if (!service) return;
    const finished = await service.sweepDue((guildId) =>
      // The client is attached at bootstrap; without it there is nothing to announce to.
      (ctx as BotContext & { client?: { guilds: { cache: { get: (id: string) => unknown } } } }).client?.guilds.cache.get(
        guildId,
      ) as never,
    );
    if (finished > 0) logger.info('giveaways finished', { count: finished });
  });

  // Reminders that are due.
  every('reminders', 20_000, async () => {
    const repos = ctx.repos;
    if (!repos) return;
    const client = (ctx as BotContext & { client?: { channels: { cache: { get: (id: string) => { send: (o: unknown) => Promise<unknown> } } } } })
      .client;
    const due = await repos.community.dueReminders();
    for (const reminder of due) {
      const channel = client?.channels.cache.get(reminder.channelId);
      if (channel) {
        await channel
          .send({ content: `⏰ <@${reminder.userId}> ${reminder.content}` })
          .catch(() => undefined);
      }
      await repos.community.markReminderSent(reminder.id);
    }
  });

  // Cooldown state eviction.
  every('cooldown-sweep', 5 * 60_000, async () => {
    const cooldowns = (ctx as BotContext & { cooldowns?: { sweep: () => number } }).cooldowns;
    const removed = cooldowns?.sweep() ?? 0;
    if (removed > 0) logger.debug('cooldown buckets swept', { removed });
  });

  // Housekeeping: expired sessions, completed tasks, old logs.
  every('housekeeping', 6 * 60 * 60 * 1000, async () => {
    const repos = ctx.repos;
    if (!repos) return;
    const sessions = await repos.sessions.purgeExpired();
    const tasks = await repos.scheduler.pruneCompleted(7);
    const logs = await repos.audit.prune(90);
    const security = await repos.security.pruneOldRows(90);
    logger.info('housekeeping complete', { sessions, tasks, logs, ...security });
  });

  return {
    stop: () => {
      for (const timer of timers) clearInterval(timer);
      timers.length = 0;
    },
  };
}
