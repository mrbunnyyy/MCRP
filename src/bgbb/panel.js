import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  EmbedBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
} from 'discord.js';
import { ACTIONS } from './embeds.js';

const states = new Map();
const PANEL_TTL = 5 * 60 * 1000;

function stateKey(guildId, userId) {
  return `${guildId}:${userId}`;
}

function getState(guildId, userId) {
  const key = stateKey(guildId, userId);
  let state = states.get(key);
  if (!state || Date.now() - state.createdAt > PANEL_TTL) {
    state = { createdAt: Date.now(), updatedAt: Date.now() };
    states.set(key, state);
  }
  state.updatedAt = Date.now();
  return state;
}

export function cleanupPanels() {
  const now = Date.now();
  for (const [key, state] of states) {
    if (now - state.updatedAt > PANEL_TTL) states.delete(key);
  }
}

function makeOrganizationOptions(organizations = [], includeBlank = true) {
  const safe = [...new Set(organizations.map((name) => String(name).trim()).filter(Boolean))].slice(0, 24);
  const options = safe.map((name) => ({ label: name.slice(0, 100), value: `org:${name}` }));
  options.push({ label: 'Custom organization…', value: 'custom' });
  return includeBlank ? [{ label: 'Choose an organization', value: 'none' }, ...options].slice(0, 25) : options.slice(0, 25);
}

function actionOptions() {
  return Object.entries(ACTIONS).map(([value, action]) => ({
    label: `${action.group} • ${action.label}`,
    value,
    description: `Create a ${action.group.toLowerCase()} ${action.label.toLowerCase()} announcement`,
  }));
}

function buildActionEmbed(state) {
  const action = state.actionKey ? ACTIONS[state.actionKey] : null;
  const embed = new EmbedBuilder()
    .setTitle('BGBB • Staff Action Interface')
    .setDescription('Select the action, Discord member, organization, and optional description/reason, then submit the record.')
    .setColor(action?.color || 0x5865f2)
    .addFields(
      { name: 'Action', value: action ? `${action.group} • ${action.label}` : 'Not selected', inline: true },
      { name: 'Person', value: state.personName || 'Not selected', inline: true },
      { name: 'Organization', value: state.organization || 'Not selected', inline: true },
    );

  if (state.oldOrganization || state.newOrganization) {
    embed.addFields(
      { name: 'Old Organization', value: state.oldOrganization || 'Not selected', inline: true },
      { name: 'New Organization', value: state.newOrganization || 'Not selected', inline: true },
    );
  }

  embed.addFields({ name: 'Description / Reason', value: state.description || 'None provided', inline: false });
  embed.setFooter({ text: 'BGBB • Staff only • Panel locks to the command user' });
  return embed;
}

export function createActionPanel(guildId, userId, organizations = []) {
  const state = getState(guildId, userId);
  state.organizations = organizations;

  const actionSelect = new StringSelectMenuBuilder()
    .setCustomId(`bgbb:action:${userId}`)
    .setPlaceholder('1. Select BGBB action')
    .addOptions(actionOptions());

  const userSelect = new UserSelectMenuBuilder()
    .setCustomId(`bgbb:person:${userId}`)
    .setPlaceholder('2. Select Discord member/name')
    .setMinValues(1)
    .setMaxValues(1);

  const components = [
    new ActionRowBuilder().addComponents(actionSelect),
    new ActionRowBuilder().addComponents(userSelect),
  ];

  const action = state.actionKey ? ACTIONS[state.actionKey] : null;
  const isTransfer = state.actionKey === 'CURATOR_TRANSFERRED';

  if (isTransfer) {
    const oldOrg = new StringSelectMenuBuilder()
      .setCustomId(`bgbb:oldorg:${userId}`)
      .setPlaceholder('3. Select old organization')
      .addOptions(makeOrganizationOptions(organizations));
    const newOrg = new StringSelectMenuBuilder()
      .setCustomId(`bgbb:neworg:${userId}`)
      .setPlaceholder('4. Select new organization')
      .addOptions(makeOrganizationOptions(organizations));
    components.push(new ActionRowBuilder().addComponents(oldOrg));
    components.push(new ActionRowBuilder().addComponents(newOrg));
  } else if (action) {
    const org = new StringSelectMenuBuilder()
      .setCustomId(`bgbb:org:${userId}`)
      .setPlaceholder('3. Select organization')
      .addOptions(makeOrganizationOptions(organizations));
    components.push(new ActionRowBuilder().addComponents(org));
  }

  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`bgbb:reason:${userId}`).setLabel('Description / Reason').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`bgbb:submit:${userId}`).setLabel('Submit BGBB').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`bgbb:cancel:${userId}`).setLabel('Cancel').setStyle(ButtonStyle.Danger),
  );
  components.push(buttons);

  return { embeds: [buildActionEmbed(state)], components };
}

export function createConfigPanel(config, userId) {
  const fields = [
    ['Admin Announcement Channel', config.adminAnnouncementChannelId],
    ['Leader Channel', config.leaderChannelId],
    ['Kick Channel', config.kickChannelId],
    ['Remove Channel', config.removeChannelId],
    ['Action Log Channel', config.actionLogChannelId],
  ];

  const description = fields.map(([label, id]) => `**${label}:** ${id ? `<#${id}>` : 'Not set'}`).join('\n');
  const embed = new EmbedBuilder()
    .setTitle('BGBB • Admin Configuration')
    .setDescription(`${description}\n\nChoose a setting below, then select the Discord channel to save it.`)
    .setColor(0x5865f2)
    .setFooter({ text: 'BGBB • Admin only • Panel locks to the command user' });

  const targetSelect = new StringSelectMenuBuilder()
    .setCustomId(`bgbbedit:target:${userId}`)
    .setPlaceholder('Select configuration item')
    .addOptions(
      { label: 'Admin Announcement Channel', value: 'adminAnnouncementChannelId' },
      { label: 'Leader Channel', value: 'leaderChannelId' },
      { label: 'Kick Channel', value: 'kickChannelId' },
      { label: 'Remove Channel', value: 'removeChannelId' },
      { label: 'Action Log Channel', value: 'actionLogChannelId' },
    );

  return {
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(targetSelect)],
  };
}

export function getOrCreateState(guildId, userId) {
  return getState(guildId, userId);
}

export function buildReasonModal(userId) {
  return new ModalBuilder()
    .setCustomId(`bgbbmodal:reason:${userId}`)
    .setTitle('BGBB • Description / Reason')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('description')
          .setLabel('Description / Reason (optional)')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setMaxLength(1000)
          .setPlaceholder('Enter the reason or description for this action.'),
      ),
    );
}

export function buildCustomOrganizationModal(userId, target) {
  return new ModalBuilder()
    .setCustomId(`bgbbmodal:org:${target}:${userId}`)
    .setTitle('BGBB • Custom Organization')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('organization')
          .setLabel('Organization')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(100)
          .setPlaceholder('e.g. Arzamas Police Department'),
      ),
    );
}

export function buildChannelSelector(userId, configKey) {
  return new ActionRowBuilder().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId(`bgbbedit:channel:${configKey}:${userId}`)
      .setPlaceholder('Select a channel to save')
      .setMinValues(1)
      .setMaxValues(1),
  );
}

export function clearState(guildId, userId) {
  states.delete(stateKey(guildId, userId));
}
