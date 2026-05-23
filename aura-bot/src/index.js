const { Client, GatewayIntentBits, Collection, REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.commands = new Collection();

// Load commands
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(f => f.endsWith('.js'));
for (const file of commandFiles) {
  const cmd = require(path.join(commandsPath, file));
  if (cmd.data && cmd.execute) {
    client.commands.set(cmd.data.name, cmd);
    console.log(`[CMD] Loaded: ${cmd.data.name}`);
  }
}

// Load events
const eventsPath = path.join(__dirname, 'events');
const eventFiles = fs.readdirSync(eventsPath).filter(f => f.endsWith('.js'));
for (const file of eventFiles) {
  const event = require(path.join(eventsPath, file));
  if (event.once) {
    client.once(event.name, (...args) => event.execute(...args, client));
  } else {
    client.on(event.name, (...args) => event.execute(...args, client));
  }
  console.log(`[EVENT] Loaded: ${event.name}`);
}

// Register slash commands
async function registerCommands() {
  const commands = [...client.commands.values()].map(c => c.data.toJSON());
  const rest = new REST().setToken(process.env.DISCORD_TOKEN);
  try {
    console.log('[BOT] Registering slash commands...');
    await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID), { body: commands });
    console.log('[BOT] Slash commands registered successfully.');
  } catch (err) {
    console.error('[BOT] Failed to register commands:', err);
  }
}

client.once('ready', async () => {
  console.log(`[BOT] Logged in as ${client.user.tag}`);
  await registerCommands();
  // Start auto-register loop
  const { startAutoRegisterLoop } = require('./utils/autoRegister');
  startAutoRegisterLoop(client);
  // Start heartbeat
  const { startHeartbeat } = require('./utils/heartbeat');
  startHeartbeat();
});

client.login(process.env.DISCORD_TOKEN);
