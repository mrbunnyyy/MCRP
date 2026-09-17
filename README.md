# TitanBot — BGBB RP System

This version keeps the TitanBot-style Node/Discord entrypoint and Railway health server, but strips the project down to the requested BGBB system only.

## Commands

- `!bgbb sr send` — authorized staff action interface.
- `!bgbbedit` — administrator-only BGBB channel configuration.

Only the requested prefix commands are included.

## BGBB actions

### LEADER
- Appointed
- Fired
- Complete Term

### CURATOR
- Selected
- Removed
- Transferred

The interface lets staff select a Discord member, choose an organization, add an optional description/reason, and submit the action. Transfers collect both old and new organizations.

## Announcement routing

- Leader Appointed → Leader Channel
- Leader Fired → Kick Channel
- Leader Complete Term → Leader Channel
- Curator Selected → Admin Announcement Channel
- Curator Removed → Remove Channel
- Curator Transferred → Admin Announcement Channel

If a specific route channel is not configured, the Admin Announcement Channel is used as the fallback.

Every action is also sent to the Action Log Channel when configured.

## Logging

Each log records:

- Staff who used the system
- Person affected
- Action
- Organization
- Old/New organization where applicable
- Description/reason
- Date/time
- Result

Channel/configuration changes from `!bgbbedit` are logged as `CONFIG_UPDATE` records.

## Authorization

By default, staff access is allowed for members with Administrator, Manage Server, or Manage Roles. You can also add staff role IDs through `BGBB_STAFF_ROLE_IDS`.

`!bgbbedit` requires Administrator or a role listed in `BGBB_ADMIN_ROLE_IDS`.

## Persistence

The system supports two storage modes:

1. PostgreSQL when `DATABASE_URL` or `POSTGRES_URL` is set. This is recommended for Railway because it survives redeployments when your Railway Postgres database is persistent.
2. Local JSON fallback at `BGBB_DATA_FILE` (default `./data/bgbb.json`). This survives normal process restarts on the same filesystem.

## Railway setup

1. Set `DISCORD_TOKEN` in Railway Variables. Never put the real token in the project files.
2. Deploy with `npm start`.
3. Recommended: attach a Railway Postgres service and expose its connection URL as `DATABASE_URL`.
4. In the Discord Developer Portal, enable **Message Content Intent** and **Server Members Intent**.
5. Invite the bot with permissions that allow it to view/send messages and embeds in the configured BGBB channels.
6. Start the bot and run `!bgbbedit` as an admin to configure the five channel targets.

## Validation

Run:

```bash
npm install
npm run check
npm start
```

`npm run check` validates the JavaScript syntax for all project source files.
