# Dashboard

A Next.js 14 (App Router) + React + TypeScript web app in `apps/dashboard`. It
shares the PostgreSQL database with the bot and reads live process metrics from
the bot's internal API.

## Routes

| Route                                                                                                        | Access         | Purpose                                                                                      |
| ------------------------------------------------------------------------------------------------------------ | -------------- | -------------------------------------------------------------------------------------------- |
| `/`                                                                                                          | public         | Landing page; shows configuration problems if any required env var is missing                |
| `/docs`                                                                                                      | public         | What the bot does and does not do                                                            |
| `/privacy`, `/terms`                                                                                         | public         | Data handling and terms                                                                      |
| `/login`                                                                                                     | public         | Discord OAuth2 entry point                                                                   |
| `/api/auth/login`, `/api/auth/callback`, `/api/auth/logout`                                                  | —              | OAuth2 flow and session handling                                                             |
| `/dashboard`                                                                                                 | signed in      | List of servers the user can actually manage                                                 |
| `/dashboard/[guildId]`                                                                                       | Manage Server  | Per-server overview: real counters from `guild_overview`, 14-day security series, top levels |
| `/dashboard/[guildId]/{moderation,automod,security,logging,welcome,tickets,leveling,economy,commands,audit}` | Manage Server  | One settings page per system                                                                 |
| `/api/guilds/[guildId]/settings`                                                                             | Manage Server  | `GET` current settings, `POST` a settings patch                                              |
| `/owner`                                                                                                     | bot owner only | Live process metrics, global counters, recent audit entries                                  |

`next build` produces 23 routes; the list above is what they are for.

## Authentication flow

1. `/api/auth/login` generates a random `state`, stores it in the
   `dcbot_oauth_state` cookie, and redirects to Discord with the
   `identify` + `guilds` scopes.
2. Discord redirects back to `/api/auth/callback` with `code` and `state`.
3. The callback rejects the request unless `state` matches the cookie value
   (CSRF protection), exchanges the code, and loads the user's guild list.
4. A session cookie is set: **encrypted** JWE (`dir` + `A256GCM`, key derived
   from `SESSION_SECRET` with SHA-256), `httpOnly`, `sameSite=lax`, `secure` in
   production, 12-hour lifetime. The Discord access token lives inside it.
5. `dashboard_sessions` stores only SHA-256 hashes of the tokens, plus the
   expiry, so a database leak does not hand out working Discord tokens.

## Authorization

Every page and every mutation re-checks authorization **on the server**:

- `isOwner(session)` → the session user is in `BOT_OWNER_IDS`.
- `assertGuildManager({ session, token, guildId })` → asks Discord for the
  signed-in user's guild list and requires that guild to be present with
  `MANAGE_GUILD` (bot owners may manage any guild they can see). A forged
  `guildId` in the URL therefore cannot pass.
- `/dashboard/[guildId]/layout.tsx` renders a denial screen instead of the
  settings UI when the check fails.

Hiding a button in the UI is cosmetic; the server checks are what matter.

## Settings writes

`POST /api/guilds/[guildId]/settings` with `{ "group": "...", "patch": { ... } }`:

1. valid session required (401 otherwise);
2. body validated by `validateSettingsRequest` (`lib/settingsPolicy.ts`);
3. `guildId` must be a snowflake;
4. `assertGuildManager` (403 otherwise);
5. the group is merged with JSONB `||` so only the keys you send change;
6. an `audit_logs` row is written with `actor_kind = 'dashboard_user'` and the
   list of changed keys.

Writable groups: `moderation`, `automod`, `security`, `tickets`, `welcome`,
`logging`, `economy`, `leveling`, `music`, `suggestions`, `reaction_roles`.

**Not writable from the dashboard:** `branding`, `no_tag`, `no_pin`. Those are
owner/staff command territory and stay in Discord.

Payloads larger than 16 KB are rejected with `413`.

The `SettingsForm` client component sends **only the fields you changed**, so
unrelated settings are never overwritten by a stale form.

## Live bot metrics

`lib/botApi.ts` calls the bot's `/metrics` endpoint with a bearer token:

- `BOT_API_ENABLED=true` on the dashboard,
- `BOT_API_TOKEN` identical to the bot's,
- `BOT_API_URL` when the bot is not on the same host (compose sets
  `http://bot:8787`).

When the API is off or unreachable the owner panel says **unavailable** and shows
the reason. It never renders an estimated or remembered value.

## Development

```bash
cp .env.example .env        # fill in DISCORD_*, SESSION_SECRET, DATABASE_URL
npm run dashboard           # http://localhost:3000
npm run dashboard:build     # production build (also what CI runs)
```

`next.config.mjs` sets:

- `transpilePackages` for the workspace packages,
- `experimental.serverComponentsExternalPackages: ['pg']` so the Postgres driver
  is not bundled,
- `resolve.extensionAlias` so `.js` specifiers resolve to the workspace `.ts`
  sources,
- `output: 'standalone'` for the container image.

## UI conventions

- Dark mode by default with a `ThemeToggle`; no external CSS framework.
- Responsive down to phone widths; the sidebar collapses.
- Every list has three states: loading, empty ("Nothing recorded.") and error.
- Unavailable data is labelled unavailable rather than shown as zero.
