import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_CONFIG = {
  adminAnnouncementChannelId: null,
  leaderChannelId: null,
  kickChannelId: null,
  removeChannelId: null,
  actionLogChannelId: null,
  organizations: [],
};

function envDatabaseUrl() {
  return process.env.DATABASE_URL || process.env.POSTGRES_URL || null;
}

function cloneDefault() {
  return { ...DEFAULT_CONFIG, organizations: [] };
}

export class BgbbStore {
  constructor() {
    this.pool = null;
    this.filePath = path.resolve(process.env.BGBB_DATA_FILE || path.join(__dirname, '../../data/bgbb.json'));
    this.fileData = { guilds: {}, logs: [] };
  }

  async init() {
    const databaseUrl = envDatabaseUrl();

    if (databaseUrl) {
      this.pool = new Pool({ connectionString: databaseUrl, ssl: this.resolveSsl(databaseUrl) });
      try {
        await this.pool.query(`
          CREATE TABLE IF NOT EXISTS bgbb_guild_configs (
            guild_id TEXT PRIMARY KEY,
            admin_announcement_channel_id TEXT,
            leader_channel_id TEXT,
            kick_channel_id TEXT,
            remove_channel_id TEXT,
            action_log_channel_id TEXT,
            organizations JSONB NOT NULL DEFAULT '[]'::jsonb,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          )
        `);

        await this.pool.query(`
          CREATE TABLE IF NOT EXISTS bgbb_action_logs (
            id BIGSERIAL PRIMARY KEY,
            guild_id TEXT NOT NULL,
            staff_id TEXT,
            staff_name TEXT,
            person_id TEXT,
            person_name TEXT,
            role_type TEXT,
            action TEXT NOT NULL,
            organization TEXT,
            old_organization TEXT,
            new_organization TEXT,
            description TEXT,
            occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            result TEXT NOT NULL
          )
        `);
        return;
      } catch (error) {
        console.error('[BGBB] PostgreSQL initialization failed; using local JSON fallback:', error.message);
        try {
          await this.pool.end();
        } catch {}
        this.pool = null;
      }
    }

    await this.loadFile();
  }

  resolveSsl(url) {
    if (String(process.env.PGSSL || '').toLowerCase() === 'false') return false;
    if (String(url).includes('localhost') || String(url).includes('127.0.0.1')) return false;
    return { rejectUnauthorized: false };
  }

  async loadFile() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      this.fileData = JSON.parse(raw);
      if (!this.fileData.guilds || typeof this.fileData.guilds !== 'object') this.fileData.guilds = {};
      if (!Array.isArray(this.fileData.logs)) this.fileData.logs = [];
    } catch (error) {
      if (error.code !== 'ENOENT') console.warn('[BGBB] Could not read local storage:', error.message);
      await this.saveFile();
    }
  }

  async saveFile() {
    const temp = `${this.filePath}.tmp`;
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(temp, JSON.stringify(this.fileData, null, 2), 'utf8');
    await fs.rename(temp, this.filePath);
  }

  normalizeConfig(row) {
    if (!row) return cloneDefault();
    return {
      adminAnnouncementChannelId: row.admin_announcement_channel_id ?? row.adminAnnouncementChannelId ?? null,
      leaderChannelId: row.leader_channel_id ?? row.leaderChannelId ?? null,
      kickChannelId: row.kick_channel_id ?? row.kickChannelId ?? null,
      removeChannelId: row.remove_channel_id ?? row.removeChannelId ?? null,
      actionLogChannelId: row.action_log_channel_id ?? row.actionLogChannelId ?? null,
      organizations: Array.isArray(row.organizations) ? row.organizations : [],
    };
  }

  async getGuildConfig(guildId) {
    if (this.pool) {
      const { rows } = await this.pool.query(
        'SELECT * FROM bgbb_guild_configs WHERE guild_id = $1',
        [guildId],
      );
      return this.normalizeConfig(rows[0]);
    }

    return { ...cloneDefault(), ...(this.fileData.guilds[guildId] || {}), organizations: [...new Set(this.fileData.guilds[guildId]?.organizations || [])] };
  }

  async saveGuildConfig(guildId, config) {
    const normalized = {
      ...cloneDefault(),
      ...config,
      organizations: [...new Set((config.organizations || []).map((name) => String(name).trim()).filter(Boolean))].slice(-100),
    };

    if (this.pool) {
      await this.pool.query(`
        INSERT INTO bgbb_guild_configs (
          guild_id, admin_announcement_channel_id, leader_channel_id, kick_channel_id,
          remove_channel_id, action_log_channel_id, organizations, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,NOW())
        ON CONFLICT (guild_id) DO UPDATE SET
          admin_announcement_channel_id = EXCLUDED.admin_announcement_channel_id,
          leader_channel_id = EXCLUDED.leader_channel_id,
          kick_channel_id = EXCLUDED.kick_channel_id,
          remove_channel_id = EXCLUDED.remove_channel_id,
          action_log_channel_id = EXCLUDED.action_log_channel_id,
          organizations = EXCLUDED.organizations,
          updated_at = NOW()
      `, [
        guildId,
        normalized.adminAnnouncementChannelId,
        normalized.leaderChannelId,
        normalized.kickChannelId,
        normalized.removeChannelId,
        normalized.actionLogChannelId,
        JSON.stringify(normalized.organizations),
      ]);
      return normalized;
    }

    this.fileData.guilds[guildId] = normalized;
    await this.saveFile();
    return normalized;
  }

  async addOrganization(guildId, organization) {
    if (!organization) return;
    const config = await this.getGuildConfig(guildId);
    if (!config.organizations.includes(organization)) {
      config.organizations.push(organization);
      config.organizations = config.organizations.slice(-100);
      await this.saveGuildConfig(guildId, config);
    }
  }

  async logAction(entry) {
    const normalized = {
      guildId: entry.guildId,
      staffId: entry.staffId || null,
      staffName: entry.staffName || null,
      personId: entry.personId || null,
      personName: entry.personName || null,
      roleType: entry.roleType || null,
      action: entry.action,
      organization: entry.organization || null,
      oldOrganization: entry.oldOrganization || null,
      newOrganization: entry.newOrganization || null,
      description: entry.description || null,
      occurredAt: entry.occurredAt || new Date().toISOString(),
      result: entry.result || 'SUCCESS',
    };

    if (this.pool) {
      await this.pool.query(`
        INSERT INTO bgbb_action_logs (
          guild_id, staff_id, staff_name, person_id, person_name, role_type, action,
          organization, old_organization, new_organization, description, occurred_at, result
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      `, [
        normalized.guildId,
        normalized.staffId,
        normalized.staffName,
        normalized.personId,
        normalized.personName,
        normalized.roleType,
        normalized.action,
        normalized.organization,
        normalized.oldOrganization,
        normalized.newOrganization,
        normalized.description,
        normalized.occurredAt,
        normalized.result,
      ]);
      return;
    }

    this.fileData.logs.push(normalized);
    if (this.fileData.logs.length > 2000) this.fileData.logs.splice(0, this.fileData.logs.length - 2000);
    await this.saveFile();
  }

  async close() {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
  }
}
