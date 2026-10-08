import type { BotContext } from '../types.js';
import type { ModerationService } from './moderation.js';
import type { SecurityService } from './security.js';
import type { AutoModService } from './automod.js';
import type { TicketService } from './tickets.js';
import type { WelcomeService } from './welcome.js';
import type { EconomyService } from './economy.js';
import type { LevelingService } from './leveling.js';
import type { GiveawayService } from './giveaways.js';
import type { LoggingService } from './logging.js';
import type { BrandingService } from './branding.js';
import type { NoTagService } from '../security/noTag.js';
import type { NoPinService } from '../security/noPin.js';
import type { HealthService } from './health.js';
import type { MusicManager } from '../music/manager.js';
import type { CustomCommandService } from './customCommands.js';

/**
 * Service container. Services are constructed lazily so an optional subsystem
 * (music, database) failing to initialise cannot block the rest of the bot.
 */
export class ServiceRegistry {
  moderation?: ModerationService;
  security?: SecurityService;
  automod?: AutoModService;
  tickets?: TicketService;
  welcome?: WelcomeService;
  economy?: EconomyService;
  leveling?: LevelingService;
  giveaways?: GiveawayService;
  logging?: LoggingService;
  branding?: BrandingService;
  noTag?: NoTagService;
  noPin?: NoPinService;
  health?: HealthService;
  music?: MusicManager;
  customCommands?: CustomCommandService;

  /** Called during graceful shutdown. */
  async shutdown(context: BotContext): Promise<void> {
    await this.music?.destroyAll();
    context.logger.info('services shut down');
  }
}
