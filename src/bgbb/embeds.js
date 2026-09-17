import { EmbedBuilder } from 'discord.js';

export const ACTIONS = {
  LEADER_APPOINTED: {
    group: 'LEADER',
    label: 'Appointed',
    title: 'Leader Appointment',
    color: 0x2ecc71,
    route: 'leader',
    text: ({ person, organization }) => `${person} has been appointed as the Leader of **${organization}**.`,
  },
  LEADER_FIRED: {
    group: 'LEADER',
    label: 'Fired',
    title: 'Leader Removal',
    color: 0xe74c3c,
    route: 'kick',
    text: ({ person, organization }) => `${person} has been removed from the position of Leader of **${organization}**.`,
  },
  LEADER_COMPLETE_TERM: {
    group: 'LEADER',
    label: 'Complete Term',
    title: 'Leader Term Completed',
    color: 0x3498db,
    route: 'leader',
    text: ({ person, organization }) => `${person} has completed their term as Leader of **${organization}**.`,
  },
  CURATOR_SELECTED: {
    group: 'CURATOR',
    label: 'Selected',
    title: 'Curator Selection',
    color: 0x9b59b6,
    route: 'adminAnnouncement',
    text: ({ person, organization }) => `${person} has been selected as Curator of **${organization}**.`,
  },
  CURATOR_REMOVED: {
    group: 'CURATOR',
    label: 'Removed',
    title: 'Curator Removal',
    color: 0xe67e22,
    route: 'remove',
    text: ({ person, organization }) => `${person} has been removed from the Curator position of **${organization}**.`,
  },
  CURATOR_TRANSFERRED: {
    group: 'CURATOR',
    label: 'Transferred',
    title: 'Curator Transfer',
    color: 0xf1c40f,
    route: 'adminAnnouncement',
    text: ({ person, oldOrganization, newOrganization }) => `${person} has been transferred from **${oldOrganization}** to **${newOrganization}**.`,
  },
};

export function buildAnnouncementEmbed(actionKey, payload) {
  const action = ACTIONS[actionKey];
  if (!action) throw new Error(`Unknown BGBB action: ${actionKey}`);

  const mention = payload.memberId ? `<@${payload.memberId}>` : payload.personName;
  const description = action.text({
    person: mention,
    organization: payload.organization,
    oldOrganization: payload.oldOrganization,
    newOrganization: payload.newOrganization,
  });

  const embed = new EmbedBuilder()
    .setTitle(`BGBB • ${action.title}`)
    .setDescription(description)
    .setColor(action.color)
    .addFields(
      { name: 'Person', value: payload.personName || 'Unknown', inline: true },
      { name: 'Role', value: action.group === 'LEADER' ? 'Leader' : 'Curator', inline: true },
    )
    .setTimestamp(new Date());

  if (payload.organization) embed.addFields({ name: 'Organization', value: payload.organization, inline: true });
  if (payload.oldOrganization) embed.addFields({ name: 'Old Organization', value: payload.oldOrganization, inline: true });
  if (payload.newOrganization) embed.addFields({ name: 'New Organization', value: payload.newOrganization, inline: true });
  if (payload.description) embed.addFields({ name: 'Description / Reason', value: payload.description.slice(0, 1024), inline: false });
  if (payload.staffName) embed.addFields({ name: 'Processed By', value: payload.staffName, inline: true });

  embed.setFooter({ text: 'BGBB • RP Staff System' });
  return embed;
}

export function buildActionLogEmbed(entry) {
  const embed = new EmbedBuilder()
    .setTitle(`BGBB • ${entry.action}`)
    .setColor(entry.result?.startsWith('SUCCESS') ? 0x2ecc71 : 0xe74c3c)
    .setTimestamp(new Date(entry.occurredAt || Date.now()))
    .addFields(
      { name: 'Staff', value: entry.staffName || entry.staffId || 'Unknown', inline: true },
      { name: 'Person', value: entry.personName || entry.personId || '—', inline: true },
      { name: 'Action', value: entry.action || '—', inline: true },
      { name: 'Organization', value: entry.organization || '—', inline: true },
      { name: 'Old Organization', value: entry.oldOrganization || '—', inline: true },
      { name: 'New Organization', value: entry.newOrganization || '—', inline: true },
      { name: 'Result', value: entry.result || '—', inline: true },
      { name: 'Description / Reason', value: (entry.description || '—').slice(0, 1024), inline: false },
    )
    .setFooter({ text: 'BGBB • Action Log' });

  return embed;
}
