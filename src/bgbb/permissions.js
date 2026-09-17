import { PermissionFlagsBits } from 'discord.js';

function parseRoleIds(value) {
  return new Set(
    String(value || '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean),
  );
}

export function isStaff(member) {
  if (!member) return false;

  if (member.permissions?.has(PermissionFlagsBits.Administrator)) return true;
  if (member.permissions?.has(PermissionFlagsBits.ManageGuild)) return true;
  if (member.permissions?.has(PermissionFlagsBits.ManageRoles)) return true;

  const roleIds = parseRoleIds(process.env.BGBB_STAFF_ROLE_IDS);
  if (roleIds.size === 0) return false;

  return member.roles?.cache?.some((role) => roleIds.has(role.id)) ?? false;
}

export function isAdmin(member) {
  if (!member) return false;
  if (member.permissions?.has(PermissionFlagsBits.Administrator)) return true;

  const roleIds = parseRoleIds(process.env.BGBB_ADMIN_ROLE_IDS);
  return member.roles?.cache?.some((role) => roleIds.has(role.id)) ?? false;
}
