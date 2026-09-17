import {
  ChannelType,
  MessageFlags,
} from 'discord.js';
import { ACTIONS, buildActionLogEmbed, buildAnnouncementEmbed } from './embeds.js';
import { isAdmin, isStaff } from './permissions.js';
import {
  buildChannelSelector,
  buildCustomOrganizationModal,
  buildReasonModal,
  clearState,
  createActionPanel,
  createConfigPanel,
  getOrCreateState,
} from './panel.js';

function staffName(member) {
  return member?.displayName || member?.user?.tag || member?.user?.username || 'Unknown Staff';
}

function safeText(text, max = 1000) {
  return String(text || '').trim().slice(0, max);
}

async function safeDelete(message) {
  try { await message.delete(); } catch {}
}

async function replyAndDelete(message, content) {
  const sent = await message.reply({ content });
  setTimeout(() => safeDelete(sent), 12000);
}

function channelIdForRoute(config, route) {
  const primary = {
    adminAnnouncement: config.adminAnnouncementChannelId,
    leader: config.leaderChannelId,
    kick: config.kickChannelId,
    remove: config.removeChannelId,
  }[route];
  return primary || config.adminAnnouncementChannelId || null;
}

function isActionComplete(state) {
  if (!state.actionKey || !state.personId) return false;
  if (state.actionKey === 'CURATOR_TRANSFERRED') return Boolean(state.oldOrganization && state.newOrganization);
  return Boolean(state.organization);
}

function canInteract(interaction, userId) {
  return interaction.user?.id === userId;
}

async function sendActionLog({ client, guild, store, entry }) {
  try {
    await store.logAction(entry);
  } catch (error) {
    console.error('[BGBB] Failed to persist action log:', error);
  }

  try {
    const config = await store.getGuildConfig(guild.id);
    if (!config.actionLogChannelId) return;
    const channel = guild.channels.cache.get(config.actionLogChannelId) || await client.channels.fetch(config.actionLogChannelId).catch(() => null);
    if (!channel?.isTextBased()) return;
    await channel.send({ embeds: [buildActionLogEmbed(entry)] });
  } catch (error) {
    console.error('[BGBB] Failed to send action log:', error.message);
  }
}

export async function handlePrefixMessage(message, { client, store, prefix = '!' }) {
  if (!message.guild || message.author.bot || !message.content.startsWith(prefix)) return;

  const input = message.content.slice(prefix.length).trim();
  const parts = input.split(/\s+/);
  const root = (parts.shift() || '').toLowerCase();

  if (root === 'bgbbedit') {
    if (!isAdmin(message.member)) {
      await replyAndDelete(message, '❌ Only authorized administrators can use `!bgbbedit`.');
      return;
    }
    const config = await store.getGuildConfig(message.guild.id);
    await message.reply(createConfigPanel(config, message.author.id));
    return;
  }

  if (root !== 'bgbb') return;

  const sub = (parts.shift() || '').toLowerCase();
  const action = (parts.shift() || '').toLowerCase();

  if (sub !== 'sr' || action !== 'send') {
    await replyAndDelete(message, 'Use `!bgbb sr send` to open the BGBB staff action interface.');
    return;
  }

  if (!isStaff(message.member)) {
    await replyAndDelete(message, '❌ You are not authorized to use the BGBB staff interface.');
    return;
  }

  const config = await store.getGuildConfig(message.guild.id);
  const panel = createActionPanel(message.guild.id, message.author.id, config.organizations);
  await message.reply(panel);
}

export async function handleComponent(interaction, { client, store }) {
  const guild = interaction.guild;
  if (!guild) return;

  const [scope, type, maybeTarget, maybeUserId] = String(interaction.customId).split(':');
  const userId = (scope === 'bgbb' || scope === 'bgbbedit') ? (maybeUserId || maybeTarget) : null;

  if (scope === 'bgbb') {
    if (!canInteract(interaction, userId)) {
      await interaction.reply({ content: '❌ This BGBB panel belongs to another staff member.', flags: MessageFlags.Ephemeral });
      return;
    }
    if (!isStaff(guild.members.cache.get(interaction.user.id))) {
      await interaction.reply({ content: '❌ You are no longer authorized to use the BGBB staff interface.', flags: MessageFlags.Ephemeral });
      return;
    }

    const state = getOrCreateState(guild.id, interaction.user.id);
    const config = await store.getGuildConfig(guild.id);

    if (type === 'action') {
      state.actionKey = interaction.values[0];
      state.organization = null;
      state.oldOrganization = null;
      state.newOrganization = null;
      state.updatedAt = Date.now();
      await interaction.update(createActionPanel(guild.id, interaction.user.id, config.organizations));
      return;
    }

    if (type === 'person') {
      const personId = interaction.values[0];
      const member = await guild.members.fetch(personId).catch(() => null);
      if (!member) {
        await interaction.reply({ content: '❌ That member could not be found.', flags: MessageFlags.Ephemeral });
        return;
      }
      state.personId = member.id;
      state.personName = member.displayName || member.user.username;
      state.updatedAt = Date.now();
      await interaction.update(createActionPanel(guild.id, interaction.user.id, config.organizations));
      return;
    }

    if (type === 'org' || type === 'oldorg' || type === 'neworg') {
      const value = interaction.values[0];
      if (value === 'none') {
        await interaction.reply({ content: 'Choose an organization first.', flags: MessageFlags.Ephemeral });
        return;
      }
      if (value === 'custom') {
        const target = type === 'oldorg' ? 'old' : type === 'neworg' ? 'new' : 'main';
        await interaction.showModal(buildCustomOrganizationModal(interaction.user.id, target));
        return;
      }
      const organization = value.startsWith('org:') ? value.slice(4) : value;
      if (type === 'oldorg') state.oldOrganization = organization;
      else if (type === 'neworg') state.newOrganization = organization;
      else state.organization = organization;
      state.updatedAt = Date.now();
      await interaction.update(createActionPanel(guild.id, interaction.user.id, config.organizations));
      return;
    }

    if (type === 'reason') {
      await interaction.showModal(buildReasonModal(interaction.user.id));
      return;
    }

    if (type === 'cancel') {
      clearState(guild.id, interaction.user.id);
      await interaction.update({ content: 'BGBB action cancelled.', embeds: [], components: [] });
      return;
    }

    if (type === 'submit') {
      if (!isActionComplete(state)) {
        await interaction.reply({ content: '❌ Complete the required fields before submitting.', flags: MessageFlags.Ephemeral });
        return;
      }

      const actionDef = ACTIONS[state.actionKey];
      const entry = {
        guildId: guild.id,
        staffId: interaction.user.id,
        staffName: staffName(guild.members.cache.get(interaction.user.id)),
        personId: state.personId,
        personName: state.personName,
        roleType: actionDef.group,
        action: state.actionKey,
        organization: state.organization || null,
        oldOrganization: state.oldOrganization || null,
        newOrganization: state.newOrganization || null,
        description: safeText(state.description, 1000),
        occurredAt: new Date().toISOString(),
        result: 'SUCCESS',
      };

      const announcementChannelId = channelIdForRoute(config, actionDef.route);
      let announcementResult = 'SUCCESS';

      if (announcementChannelId) {
        const channel = guild.channels.cache.get(announcementChannelId) || await client.channels.fetch(announcementChannelId).catch(() => null);
        if (channel?.isTextBased()) {
          try {
            const embed = buildAnnouncementEmbed(state.actionKey, {
              memberId: state.personId,
              personName: state.personName,
              organization: state.organization,
              oldOrganization: state.oldOrganization,
              newOrganization: state.newOrganization,
              description: state.description,
              staffName: entry.staffName,
            });
            await channel.send({ embeds: [embed] });
          } catch (error) {
            announcementResult = `FAILED_ANNOUNCEMENT: ${error.message}`.slice(0, 500);
          }
        } else {
          announcementResult = 'FAILED_ANNOUNCEMENT: configured channel is not text-based';
        }
      } else {
        announcementResult = 'SUCCESS_NO_CHANNEL: no announcement channel configured';
      }

      entry.result = announcementResult;
      await sendActionLog({ client, guild, store, entry });

      if (state.organization) await store.addOrganization(guild.id, state.organization);
      if (state.oldOrganization) await store.addOrganization(guild.id, state.oldOrganization);
      if (state.newOrganization) await store.addOrganization(guild.id, state.newOrganization);

      clearState(guild.id, interaction.user.id);
      await interaction.update({ content: announcementResult.startsWith('SUCCESS') ? '✅ BGBB action submitted and logged.' : `⚠️ BGBB action logged, but the announcement had an issue: ${announcementResult}`, embeds: [], components: [] });
      return;
    }
    return;
  }

  if (scope === 'bgbbedit') {
    if (!canInteract(interaction, userId)) {
      await interaction.reply({ content: '❌ This configuration panel belongs to another administrator.', flags: MessageFlags.Ephemeral });
      return;
    }
    const member = guild.members.cache.get(interaction.user.id);
    if (!isAdmin(member)) {
      await interaction.reply({ content: '❌ Administrator authorization is required.', flags: MessageFlags.Ephemeral });
      return;
    }

    if (type === 'target') {
      const configKey = interaction.values[0];
      const row = buildChannelSelector(interaction.user.id, configKey);
      await interaction.update({ content: `Select a channel for **${configKey.replace(/ChannelId$/, '').replace(/([A-Z])/g, ' $1').trim()}**.`, components: [row] });
      return;
    }

    if (type === 'channel') {
      const configKey = maybeTarget;
      const channelId = interaction.values[0];
      const config = await store.getGuildConfig(guild.id);
      if (!Object.prototype.hasOwnProperty.call(config, configKey)) {
        await interaction.reply({ content: '❌ Invalid BGBB configuration item.', flags: MessageFlags.Ephemeral });
        return;
      }

      config[configKey] = channelId;
      await store.saveGuildConfig(guild.id, config);

      const configEntry = {
        guildId: guild.id,
        staffId: interaction.user.id,
        staffName: staffName(member),
        action: 'CONFIG_UPDATE',
        organization: null,
        description: `${configKey} set to ${channelId}`,
        occurredAt: new Date().toISOString(),
        result: 'SUCCESS',
      };
      await sendActionLog({ client, guild, store, entry: configEntry });

      const freshConfig = await store.getGuildConfig(guild.id);
      await interaction.update({ content: '✅ BGBB configuration saved.', ...createConfigPanel(freshConfig, interaction.user.id) });
      return;
    }
  }
}

export async function handleModal(interaction, { store }) {
  const guild = interaction.guild;
  if (!guild) return;
  const parts = String(interaction.customId).split(':');
  const scope = parts[0];
  const type = parts[1];
  const target = parts.length === 3 ? parts[2] : parts[2];
  const userId = parts.length >= 4 ? parts[3] : parts[2];

  if (scope !== 'bgbbmodal' || userId !== interaction.user.id) return;

  if (type === 'reason') {
    const state = getOrCreateState(guild.id, interaction.user.id);
    state.description = safeText(interaction.fields.getTextInputValue('description'), 1000);
    state.updatedAt = Date.now();
    const config = await store.getGuildConfig(guild.id);
    await interaction.update(createActionPanel(guild.id, interaction.user.id, config.organizations));
    return;
  }

  if (type === 'org') {
    const state = getOrCreateState(guild.id, interaction.user.id);
    const organization = safeText(interaction.fields.getTextInputValue('organization'), 100);
    if (!organization) {
      await interaction.reply({ content: '❌ Organization is required.', flags: MessageFlags.Ephemeral });
      return;
    }
    if (target === 'old') state.oldOrganization = organization;
    else if (target === 'new') state.newOrganization = organization;
    else state.organization = organization;
    state.updatedAt = Date.now();
    const config = await store.getGuildConfig(guild.id);
    await interaction.update(createActionPanel(guild.id, interaction.user.id, config.organizations));
  }
}

export function restrictChannelTypes() {
  return [ChannelType.GuildText, ChannelType.GuildAnnouncement];
}
