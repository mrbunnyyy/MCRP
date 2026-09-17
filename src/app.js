import 'dotenv/config';
import express from 'express';
import {
  Client,
  GatewayIntentBits,
  Partials,
} from 'discord.js';
import { BgbbStore } from './bgbb/store.js';
import { handleComponent, handleModal, handlePrefixMessage } from './bgbb/commands.js';
import { cleanupPanels } from './bgbb/panel.js';

const token = process.env.DISCORD_TOKEN;
const prefix = process.env.COMMAND_PREFIX || '!';
const port = Number(process.env.PORT || 3000);
const host = process.env.WEB_HOST || '0.0.0.0';

if (!token) {
  console.error('DISCORD_TOKEN is required. Set it in Railway Variables or .env.');
  process.exit(1);
}

const store = new BgbbStore();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
});

client.once('ready', () => {
  console.log(`✅ ${client.user.tag} is online. BGBB system ready.`);
  console.log(`📋 Prefix command: ${prefix}bgbb sr send`);
  console.log(`⚙️ Config command: ${prefix}bgbbedit`);
});

client.on('messageCreate', async (message) => {
  try {
    await handlePrefixMessage(message, { client, store, prefix });
  } catch (error) {
    console.error('[BGBB] message handler error:', error);
    if (message.guild) {
      try { await message.reply('❌ BGBB encountered an internal error while opening the interface.'); } catch {}
    }
  }
});

client.on('interactionCreate', async (interaction) => {
  try {
    if (interaction.isStringSelectMenu() || interaction.isUserSelectMenu() || interaction.isChannelSelectMenu() || interaction.isButton()) {
      await handleComponent(interaction, { client, store });
    } else if (interaction.isModalSubmit()) {
      await handleModal(interaction, { store });
    }
  } catch (error) {
    console.error('[BGBB] interaction handler error:', error);
    try {
      const payload = { content: '❌ Something went wrong while processing that BGBB action.', flags: 64 };
      if (interaction.replied || interaction.deferred) await interaction.followUp(payload);
      else await interaction.reply(payload);
    } catch {}
  }
});

const app = express();
app.disable('x-powered-by');
app.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'healthy',
    botReady: client.isReady(),
    service: 'TitanBot BGBB',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});
app.get('/ready', (_req, res) => {
  if (!client.isReady()) return res.status(503).json({ ready: false });
  return res.status(200).json({ ready: true });
});

const server = app.listen(port, host, () => {
  console.log(`🌐 Health server listening on ${host}:${port}`);
});

const cleanupInterval = setInterval(cleanupPanels, 60_000);

async function shutdown(signal) {
  console.log(`🛑 Shutting down (${signal})...`);
  clearInterval(cleanupInterval);
  server.close();
  try { await client.destroy(); } catch {}
  try { await store.close(); } catch {}
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (error) => {
  console.error('[BGBB] Unhandled rejection:', error);
});

process.on('uncaughtException', (error) => {
  console.error('[BGBB] Uncaught exception:', error);
});

await store.init();
await client.login(token);
