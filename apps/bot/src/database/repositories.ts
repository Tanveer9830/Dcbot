import {
  AuditRepository,
  CommunityRepository,
  CustomCommandRepository,
  EconomyRepository,
  GuildRepository,
  LevelingRepository,
  ModerationRepository,
  OverviewRepository,
  SchedulerRepository,
  SecurityRepository,
  SessionRepository,
  TicketRepository,
  type Database,
  type Transactional,
} from '@dcbot/database';
import type { OwnerPolicy } from '@dcbot/shared';

/** All repositories, constructed once at startup and shared across commands. */
export class Repositories {
  readonly guilds: GuildRepository;
  readonly moderation: ModerationRepository;
  readonly security: SecurityRepository;
  readonly economy: EconomyRepository;
  readonly leveling: LevelingRepository;
  readonly tickets: TicketRepository;
  readonly customCommands: CustomCommandRepository;
  readonly community: CommunityRepository;
  readonly audit: AuditRepository;
  readonly scheduler: SchedulerRepository;
  readonly sessions: SessionRepository;
  readonly overview: OverviewRepository;

  constructor(db: Database & Transactional, owners: OwnerPolicy, startingBalance = 500) {
    this.guilds = new GuildRepository(db);
    this.moderation = new ModerationRepository(db);
    this.security = new SecurityRepository(db);
    this.economy = new EconomyRepository(db, startingBalance);
    this.leveling = new LevelingRepository(db);
    this.tickets = new TicketRepository(db);
    this.customCommands = new CustomCommandRepository(db, owners);
    this.community = new CommunityRepository(db);
    this.audit = new AuditRepository(db);
    this.scheduler = new SchedulerRepository(db);
    this.sessions = new SessionRepository(db);
    this.overview = new OverviewRepository(db);
  }
}
