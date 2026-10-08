# Command reference

Generated from the live registry by `npm run docs:commands` — **do not edit by hand**. 53 top-level commands are registered, inside Discord's limit of 100 per scope.

## Access levels

| Level | Who | How it is decided |
| --- | --- | --- |
| Bot owner | The IDs in `BOT_OWNER_IDS` | `OwnerPolicy` — a guild Administrator is **never** a bot owner |
| Server staff | Manage Server, Ban Members, a configured staff role, or a trusted user | `isGuildStaff` |
| Everyone | Any member who can see the channel | Discord permissions only |

## Summary

| Command | Description | Access | Cooldown |
| --- | --- | --- | --- |
| `/announce` | Sends an announcement embed. | Server staff + Manage Messages | default |
| `/automod` | Configures automatic message filtering. | Server staff + Manage Server | default |
| `/avatar` | Shows a user's avatar. | Everyone | 5s |
| `/ban` | Bans a member. | Server staff + Ban Members | 3s |
| `/birthday` | Birthday announcements. | Everyone | default |
| `/botinfo` | Shows bot status, uptime and system usage. | Everyone | 10s |
| `/branding` | [Owner] Optional branded responses. | Bot owner | default |
| `/calculator` | Evaluates a basic arithmetic expression (no code execution). | Everyone | 3s |
| `/cases` | Shows and manages moderation history. | Server staff + Moderate Members | default |
| `/channelinfo` | Shows information about a channel. | Everyone | 5s |
| `/coinflip` | Flips a coin. | Everyone | 2s |
| `/config` | Views and edits this server's configuration. | Server staff + Manage Server | default |
| `/dice` | Rolls dice. | Everyone | 2s |
| `/economy` | Virtual server economy. | Everyone | default |
| `/embed` | Builds a custom embed. | Server staff + Manage Messages | default |
| `/giveaway` | Runs giveaways. | Everyone | default |
| `/globalcommand` | [Owner] Manage global custom commands. | Bot owner | default |
| `/guilds` | [Owner] Lists the servers this bot is in. | Bot owner | default |
| `/health` | [Owner] Shows live process and dependency health. | Bot owner | default |
| `/help` | Lists every command, or shows details for one. | Everyone | 5s |
| `/kick` | Kicks a member. | Server staff + Kick Members | default |
| `/leaderboard` | Shows the XP leaderboard. | Everyone | 5s |
| `/leveling` | Configures XP and level rewards. | Server staff + Manage Server | default |
| `/lock` | Locks or unlocks channels. | Server staff + Manage Channels | default |
| `/logs` | Configures logging. | Server staff + Manage Server | default |
| `/music` | Music playback. | Everyone | 2s |
| `/nickname` | Changes or clears a member's nickname. | Server staff + Manage Roles | default |
| `/nopin` | Monitors pin and unpin activity. | Server staff + Manage Server | default |
| `/notag` | Protect users from unwanted mentions. | Everyone | default |
| `/permissions` | Inspects the effective permissions of a member or the bot. | Everyone | 5s |
| `/ping` | Shows gateway latency and database reachability. | Everyone | 5s |
| `/poll` | Creates and manages polls. | Everyone | default |
| `/purge` | Bulk deletes recent messages in this channel. | Server staff + Manage Messages | 10s |
| `/rank` | Shows your level and XP progress. | Everyone | 5s |
| `/reactionrole` | Reaction-based role assignment. | Server staff + Manage Roles | default |
| `/reminder` | Reminds you about something later. | Everyone | default |
| `/role` | Manages member roles. | Server staff + Manage Roles | default |
| `/roleinfo` | Shows information about a role. | Everyone | 5s |
| `/rps` | Plays rock-paper-scissors against the bot. | Everyone | 2s |
| `/security` | Server security configuration and monitoring. | Server staff + Manage Server | default |
| `/serverinfo` | Shows information about this server. | Everyone | 5s |
| `/slowmode` | Sets the slowmode delay for a channel. | Server staff + Manage Channels | default |
| `/starboard` | Configures the starboard. | Server staff + Manage Server | default |
| `/suggest` | Suggestion system. | Everyone | default |
| `/ticket` | Support ticket system. | Everyone | default |
| `/timeout` | Times a member out, or removes their timeout. | Server staff + Moderate Members | default |
| `/timestamp` | Converts a duration into a Discord timestamp. | Everyone | 3s |
| `/unban` | Revokes a ban by user ID. | Server staff + Ban Members | default |
| `/userinfo` | Shows information about a member. | Everyone | 5s |
| `/verify` | Configures the verification role. | Everyone | default |
| `/warn` | Records a formal warning against a member. | Server staff + Moderate Members | default |
| `/warnings` | Lists warnings for a member. | Server staff + Moderate Members | default |
| `/welcome` | Configures welcome behaviour. | Server staff + Manage Server | default |

## Owner-only commands (4)

- `/branding` — [Owner] Optional branded responses.
- `/globalcommand` — [Owner] Manage global custom commands.
- `/guilds` — [Owner] Lists the servers this bot is in.
- `/health` — [Owner] Shows live process and dependency health.

## Staff-only commands (23)

- `/announce` — Sends an announcement embed.
- `/automod` — Configures automatic message filtering.
- `/ban` — Bans a member.
- `/cases` — Shows and manages moderation history.
- `/config` — Views and edits this server's configuration.
- `/embed` — Builds a custom embed.
- `/kick` — Kicks a member.
- `/leveling` — Configures XP and level rewards.
- `/lock` — Locks or unlocks channels.
- `/logs` — Configures logging.
- `/nickname` — Changes or clears a member's nickname.
- `/nopin` — Monitors pin and unpin activity.
- `/purge` — Bulk deletes recent messages in this channel.
- `/reactionrole` — Reaction-based role assignment.
- `/role` — Manages member roles.
- `/security` — Server security configuration and monitoring.
- `/slowmode` — Sets the slowmode delay for a channel.
- `/starboard` — Configures the starboard.
- `/timeout` — Times a member out, or removes their timeout.
- `/unban` — Revokes a ban by user ID.
- `/warn` — Records a formal warning against a member.
- `/warnings` — Lists warnings for a member.
- `/welcome` — Configures welcome behaviour.

## Open commands (26)

- `/avatar` — Shows a user's avatar.
- `/birthday` — Birthday announcements.
- `/botinfo` — Shows bot status, uptime and system usage.
- `/calculator` — Evaluates a basic arithmetic expression (no code execution).
- `/channelinfo` — Shows information about a channel.
- `/coinflip` — Flips a coin.
- `/dice` — Rolls dice.
- `/economy` — Virtual server economy.
- `/giveaway` — Runs giveaways.
- `/help` — Lists every command, or shows details for one.
- `/leaderboard` — Shows the XP leaderboard.
- `/music` — Music playback.
- `/notag` — Protect users from unwanted mentions.
- `/permissions` — Inspects the effective permissions of a member or the bot.
- `/ping` — Shows gateway latency and database reachability.
- `/poll` — Creates and manages polls.
- `/rank` — Shows your level and XP progress.
- `/reminder` — Reminds you about something later.
- `/roleinfo` — Shows information about a role.
- `/rps` — Plays rock-paper-scissors against the bot.
- `/serverinfo` — Shows information about this server.
- `/suggest` — Suggestion system.
- `/ticket` — Support ticket system.
- `/timestamp` — Converts a duration into a Discord timestamp.
- `/userinfo` — Shows information about a member.
- `/verify` — Configures the verification role.

## Options

### `/announce`

Sends an announcement embed.


- `message` (text) **(required)** — Announcement text
- `channel` (channel) — Channel (defaults to this one)

### `/automod`

Configures automatic message filtering.


- `status` (subcommand) — Shows the current AutoMod configuration.
- `enable` (subcommand) — Enables or disables AutoMod.
  - `enabled` (boolean) **(required)** — Enabled
- `rule` (subcommand) — Toggles an individual filter.
  - `rule` (text) **(required)** — Filter
  - `enabled` (boolean) **(required)** — Enabled
- `blockedword` (subcommand) — Adds or removes a blocked word.
  - `word` (text) **(required)** — Word or phrase
  - `remove` (boolean) — Remove instead of add
- `exempt` (subcommand) — Exempts a role or channel from filtering.
  - `role` (role) — Role to exempt
  - `channel` (channel) — Channel to exempt
  - `remove` (boolean) — Remove the exemption
- `action` (subcommand) — Sets what happens when a rule triggers.
  - `action` (text) **(required)** — Action

### `/avatar`

Shows a user's avatar.


- `user` (user) — User whose avatar to show

### `/ban`

Bans a member.

Bot needs: Ban Members.

- `user` (user) **(required)** — Member to ban
- `reason` (text) **(required)** — Reason recorded in the mod log

### `/birthday`

Birthday announcements.


- `set` (subcommand) — Sets your birthday.
  - `month` (integer) **(required)** — 1-12
  - `day` (integer) **(required)** — 1-31
- `upcoming` (subcommand) — Shows upcoming birthdays this month.

### `/botinfo`

Shows bot status, uptime and system usage.


_No options._

### `/branding`

[Owner] Optional branded responses.


- `status` (subcommand) — Shows the current branding configuration.
- `enable` (subcommand) — Enables or disables branding in this server.
  - `enabled` (boolean) **(required)** — Enabled
- `template` (subcommand) — Sets the response template.
  - `text` (text) **(required)** — Template text
- `channel` (subcommand) — Adds or removes a channel where branding may respond.
  - `channel` (channel) **(required)** — Channel
  - `remove` (boolean) — Remove instead of add
- `interval` (subcommand) — Sets the minimum seconds between responses.
  - `seconds` (integer) **(required)** — 5-3600

### `/calculator`

Evaluates a basic arithmetic expression (no code execution).


- `expression` (text) **(required)** — e.g. (12 + 7) * 3 / 4

### `/cases`

Shows and manages moderation history.


- `user` (subcommand) — History for a member.
  - `user` (user) **(required)** — Member
- `moderator` (subcommand) — Actions taken by a moderator.
  - `user` (user) **(required)** — Moderator
- `revoke` (subcommand) — Marks a case as revoked.
  - `case` (integer) **(required)** — Case number

### `/channelinfo`

Shows information about a channel.


- `channel` (channel) — Channel to inspect

### `/coinflip`

Flips a coin.


_No options._

### `/config`

Views and edits this server's configuration.


- `view` (subcommand) — Shows the current configuration.
- `export` (subcommand) — Exports the configuration as JSON (no secrets are stored here).
- `reset` (subcommand) — Resets one configuration group to defaults.
  - `group` (text) **(required)** — Group

### `/dice`

Rolls dice.


- `roll` (text) — Format: NdS (default 1d6)

### `/economy`

Virtual server economy.


- `balance` (subcommand) — Shows a balance.
  - `user` (user) — User (defaults to you)
- `daily` (subcommand) — Claims your daily reward.
- `weekly` (subcommand) — Claims your weekly reward.
- `work` (subcommand) — Works for a small reward.
- `pay` (subcommand) — Sends coins to another member.
  - `user` (user) **(required)** — Recipient
  - `amount` (integer) **(required)** — Amount
  - `memo` (text) — Optional note
- `deposit` (subcommand) — Moves coins from wallet to bank.
  - `amount` (integer) **(required)** — Amount
- `withdraw` (subcommand) — Moves coins from bank to wallet.
  - `amount` (integer) **(required)** — Amount
- `leaderboard` (subcommand) — Shows the richest members.
- `history` (subcommand) — Shows your recent transactions.
- `admin` (subcommand) — Adjusts a balance (staff only, always logged).
  - `user` (user) **(required)** — User
  - `amount` (integer) **(required)** — Positive to add, negative to remove
  - `reason` (text) **(required)** — Reason

### `/embed`

Builds a custom embed.


- `title` (text) — Title
- `description` (text) **(required)** — Body
- `color` (text) — Hex colour, e.g. 5865f2

### `/giveaway`

Runs giveaways.


- `start` (subcommand) — Starts a giveaway in this channel.
  - `prize` (text) **(required)** — What is being given away
  - `duration` (text) **(required)** — e.g. 1h, 30m, 2d
  - `winners` (integer) — Winner count
- `end` (subcommand) — Ends a giveaway now.
  - `message_id` (text) **(required)** — Giveaway message ID
- `list` (subcommand) — Lists active giveaways.

### `/globalcommand`

[Owner] Manage global custom commands.

Requires the database.

- `create` (subcommand) — Creates a global custom command.
  - `name` (text) **(required)** — 2-32 lowercase letters/numbers/_-
  - `description` (text) **(required)** — Shown in the command list
  - `type` (text) — Response type
  - `content` (text) — Text response (supports {{variables}})
- `edit` (subcommand) — Edits an existing global command.
  - `name` (text) **(required)** — Command name
  - `content` (text) — New text response
  - `description` (text) — New description
- `delete` (subcommand) — Deletes a global command.
  - `name` (text) **(required)** — Command name
- `list` (subcommand) — Lists global commands.
- `publish` (subcommand) — Enables a global command.
  - `name` (text) **(required)** — Command name
- `disable` (subcommand) — Disables a global command.
  - `name` (text) **(required)** — Command name
- `preview` (subcommand) — Renders a command without publishing it.
  - `name` (text) **(required)** — Command name

### `/guilds`

[Owner] Lists the servers this bot is in.


_No options._

### `/health`

[Owner] Shows live process and dependency health.


_No options._

### `/help`

Lists every command, or shows details for one.


- `command` (text) — Command to inspect

### `/kick`

Kicks a member.

Bot needs: Kick Members.

- `user` (user) **(required)** — Member to kick
- `reason` (text) **(required)** — Reason recorded in the mod log

### `/leaderboard`

Shows the XP leaderboard.


_No options._

### `/leveling`

Configures XP and level rewards.


- `status` (subcommand) — Shows the current configuration.
- `enable` (subcommand) — Enables or disables leveling.
  - `enabled` (boolean) **(required)** — Enabled
- `multiplier` (subcommand) — Sets the XP multiplier.
  - `value` (number) **(required)** — 0.1 - 10
- `reward` (subcommand) — Grants a role at a level.
  - `level` (integer) **(required)** — Level
  - `role` (role) **(required)** — Role
- `setxp` (subcommand) — Sets a member's XP directly (logged).
  - `user` (user) **(required)** — User
  - `xp` (integer) **(required)** — Total XP

### `/lock`

Locks or unlocks channels.

Bot needs: Manage Channels.

- `channel` (subcommand) — Locks or unlocks a single channel.
  - `state` (text) **(required)** — Lock or unlock
  - `channel` (channel) — Channel (defaults to this one)
- `server` (subcommand) — Emergency: locks every text channel for @everyone.
- `release` (subcommand) — Releases an emergency server lockdown.

### `/logs`

Configures logging.


- `channel` (subcommand) — Sets the channel for a log type.
  - `type` (text) **(required)** — Log type
  - `channel` (channel) **(required)** — Channel
- `event` (subcommand) — Enables or disables a logged event.
  - `event` (text) **(required)** — Event
  - `enabled` (boolean) **(required)** — Enabled
- `enable` (subcommand) — Turns logging on or off.
  - `enabled` (boolean) **(required)** — Enabled
- `status` (subcommand) — Shows the logging configuration.

### `/music`

Music playback.

Bot needs: Connect, Speak.

- `play` (subcommand) — Plays a URL or searches by name.
  - `query` (text) **(required)** — YouTube URL, Spotify link, or search text
- `pause` (subcommand) — Pauses playback.
- `resume` (subcommand) — Resumes playback.
- `skip` (subcommand) — Skips the current track.
- `previous` (subcommand) — Goes back to the previous track.
- `stop` (subcommand) — Stops playback and clears the queue.
- `queue` (subcommand) — Shows the upcoming queue.
- `nowplaying` (subcommand) — Shows the current track.
- `volume` (subcommand) — Sets the player volume.
  - `percent` (integer) **(required)** — 0-150
- `seek` (subcommand) — Seeks to a position.
  - `position` (text) **(required)** — e.g. 1m30s
- `loop` (subcommand) — Sets the loop mode.
  - `mode` (text) **(required)** — Mode
- `shuffle` (subcommand) — Shuffles the queue.
- `remove` (subcommand) — Removes a track from the queue.
  - `index` (integer) **(required)** — Queue position (1-based)
- `clear` (subcommand) — Clears the upcoming queue.
- `status` (subcommand) — Shows the music backend health.

### `/nickname`

Changes or clears a member's nickname.

Bot needs: Manage Roles.

- `user` (user) **(required)** — Member
- `nickname` (text) — New nickname (leave empty to clear)

### `/nopin`

Monitors pin and unpin activity.


- `setup` (subcommand) — Enables pin monitoring.
  - `enabled` (boolean) **(required)** — Enabled
  - `mode` (text) — Response
- `exempt` (subcommand) — Exempts a user or role.
  - `user` (user) — User
  - `role` (role) — Role
  - `remove` (boolean) — Remove the exemption
- `status` (subcommand) — Shows the current configuration.
- `logs` (subcommand) — Shows recent pin activity.

### `/notag`

Protect users from unwanted mentions.


- `setup` (subcommand) — Enables mention protection for this server.
  - `enabled` (boolean) **(required)** — Enabled
- `protect` (subcommand) — Protects yourself, or another user if you are staff.
  - `user` (user) — User (defaults to you)
  - `mode` (text) — What to do
- `unprotect` (subcommand) — Removes protection.
  - `user` (user) — User (defaults to you)
- `status` (subcommand) — Shows your protection state.
- `list` (subcommand) — Lists all protected users (staff only).
- `exempt` (subcommand) — Adds an exemption for a user or role (staff only).
  - `protected` (user) **(required)** — Protected user
  - `user` (user) — Exempt user
  - `role` (role) — Exempt role
  - `remove` (boolean) — Remove the exemption
- `logs` (subcommand) — Shows recent violations (staff only).

### `/permissions`

Inspects the effective permissions of a member or the bot.


- `user` (user) — Member to inspect
- `channel` (channel) — Channel context

### `/ping`

Shows gateway latency and database reachability.


_No options._

### `/poll`

Creates and manages polls.


- `create` (subcommand) — Creates a poll.
  - `question` (text) **(required)** — Question
  - `options` (text) **(required)** — Comma separated options
  - `multi` (boolean) — Allow multiple votes
- `vote` (subcommand) — Votes on the poll in this channel.
  - `option` (integer) **(required)** — Option number (1-based)
- `results` (subcommand) — Shows the current results.
- `close` (subcommand) — Closes the poll.

### `/purge`

Bulk deletes recent messages in this channel.

Bot needs: Manage Messages.

- `amount` (integer) **(required)** — How many messages (1-100)
- `user` (user) — Only delete messages from this member

### `/rank`

Shows your level and XP progress.


- `user` (user) — User (defaults to you)

### `/reactionrole`

Reaction-based role assignment.

Bot needs: Manage Roles.

- `add` (subcommand) — Binds an emoji on a message to a role.
  - `message_id` (text) **(required)** — Message ID
  - `emoji` (text) **(required)** — Emoji
  - `role` (role) **(required)** — Role
- `remove` (subcommand) — Removes a binding.
  - `message_id` (text) **(required)** — Message ID
  - `emoji` (text) **(required)** — Emoji
- `list` (subcommand) — Lists bindings.

### `/reminder`

Reminds you about something later.


- `create` (subcommand) — Creates a reminder.
  - `in` (text) **(required)** — e.g. 30m, 2h, 1d
  - `about` (text) **(required)** — What to be reminded about
- `list` (subcommand) — Lists your pending reminders.
- `cancel` (subcommand) — Cancels a reminder by ID.
  - `id` (integer) **(required)** — Reminder ID

### `/role`

Manages member roles.

Bot needs: Manage Roles.

- `add` (subcommand) — Adds a role.
  - `user` (user) **(required)** — Member
  - `role` (role) **(required)** — Role
- `remove` (subcommand) — Removes a role.
  - `user` (user) **(required)** — Member
  - `role` (role) **(required)** — Role
- `list` (subcommand) — Lists this server's roles and member counts.

### `/roleinfo`

Shows information about a role.


- `role` (role) **(required)** — Role to inspect

### `/rps`

Plays rock-paper-scissors against the bot.


- `choice` (text) **(required)** — Your choice

### `/security`

Server security configuration and monitoring.


- `status` (subcommand) — Shows the current security configuration and recent events.
- `trust` (subcommand) — Marks a user or role as trusted (exempt from automated responses).
  - `user` (user) — User to trust
  - `role` (role) — Role to trust
  - `reason` (text) — Why
- `untrust` (subcommand) — Removes a trust entry.
  - `user` (user) — User
  - `role` (role) — Role
- `thresholds` (subcommand) — Sets anti-raid and anti-spam thresholds.
  - `joins` (integer) — Joins allowed in the window
  - `join_window_s` (integer) — Window in seconds
  - `messages` (integer) — Messages allowed in the window
  - `message_window_s` (integer) — Window in seconds
- `toggle` (subcommand) — Enables or disables a protection module.
  - `module` (text) **(required)** — Module
  - `enabled` (boolean) **(required)** — Enabled
- `events` (subcommand) — Shows the most recent security events.
- `alerts` (subcommand) — Sets the channel used for security alerts.
  - `channel` (channel) — Channel (leave empty to clear)

### `/serverinfo`

Shows information about this server.


_No options._

### `/slowmode`

Sets the slowmode delay for a channel.

Bot needs: Manage Channels.

- `seconds` (integer) **(required)** — Delay in seconds (0 disables)
- `channel` (channel) — Channel (defaults to this one)

### `/starboard`

Configures the starboard.


- `setup` (subcommand) — Sets the starboard channel and threshold.
  - `channel` (channel) **(required)** — Channel
  - `stars` (integer) — Stars required
- `status` (subcommand) — Shows the current configuration.

### `/suggest`

Suggestion system.


- `create` (subcommand) — Posts a suggestion.
  - `title` (text) **(required)** — Short title
  - `detail` (text) — Details
- `list` (subcommand) — Lists recent suggestions.
- `decide` (subcommand) — Approves or rejects a suggestion (staff only).
  - `message_id` (text) **(required)** — Suggestion message ID
  - `status` (text) **(required)** — Decision
- `setup` (subcommand) — Sets the suggestion channel (staff only).
  - `channel` (channel) **(required)** — Channel

### `/ticket`

Support ticket system.


- `setup` (subcommand) — Configures the ticket system.
  - `category` (channel) — Category for ticket channels
  - `logs` (channel) — Channel for ticket logs
  - `max_open` (integer) — Open tickets per user
- `staff` (subcommand) — Adds or removes a staff role for tickets.
  - `role` (role) **(required)** — Role
  - `remove` (boolean) — Remove instead of add
- `panel` (subcommand) — Posts the support panel in a channel.
  - `channel` (channel) **(required)** — Channel to post in
- `close` (subcommand) — Closes this ticket.
- `claim` (subcommand) — Claims this ticket.
- `reopen` (subcommand) — Reopens this ticket.
- `add` (subcommand) — Adds a member to this ticket.
  - `user` (user) **(required)** — Member to add
- `remove` (subcommand) — Removes a member from this ticket.
  - `user` (user) **(required)** — Member to remove
- `transcript` (subcommand) — Shows the recorded transcript of this ticket.
- `rate` (subcommand) — Rates the support you received.
  - `stars` (integer) **(required)** — 1-5
- `list` (subcommand) — Lists open tickets (staff only).

### `/timeout`

Times a member out, or removes their timeout.

Bot needs: Moderate Members.

- `add` (subcommand) — Times a member out.
  - `user` (user) **(required)** — Member to time out
  - `duration` (text) **(required)** — e.g. 10m, 2h, 1d
  - `reason` (text) **(required)** — Reason recorded in the mod log
- `remove` (subcommand) — Removes a timeout.
  - `user` (user) **(required)** — Member
  - `reason` (text) — Reason recorded in the mod log

### `/timestamp`

Converts a duration into a Discord timestamp.


- `in` (text) **(required)** — Duration from now, e.g. 30m, 2h, 1d
- `style` (text) — Discord timestamp style

### `/unban`

Revokes a ban by user ID.

Bot needs: Ban Members.

- `user_id` (text) **(required)** — User ID to unban
- `reason` (text) **(required)** — Reason recorded in the mod log

### `/userinfo`

Shows information about a member.


- `user` (user) — Member to inspect

### `/verify`

Configures the verification role.


- `role` (subcommand) — Sets the role granted after verification.
  - `role` (role) **(required)** — Role
- `panel` (subcommand) — Posts the verification panel.
  - `channel` (channel) **(required)** — Channel
- `me` (subcommand) — Verifies yourself.

### `/warn`

Records a formal warning against a member.


- `user` (user) **(required)** — Member to warn
- `reason` (text) **(required)** — Reason recorded in the mod log

### `/warnings`

Lists warnings for a member.


- `user` (user) **(required)** — Member to look up

### `/welcome`

Configures welcome behaviour.


- `channel` (subcommand) — Sets the welcome channel.
  - `channel` (channel) **(required)** — Channel
- `message` (subcommand) — Sets the welcome message template.
  - `text` (text) **(required)** — Supports {{user}}, {{guild}}, {{member_count}}
- `autorole` (subcommand) — Adds or removes an auto-assigned role.
  - `role` (role) **(required)** — Role
  - `remove` (boolean) — Remove instead of add
- `test` (subcommand) — Sends a test welcome message.
- `status` (subcommand) — Shows the welcome configuration.

