import { Client, GatewayIntentBits, Collection } from 'discord.js';
import dotenv from 'dotenv';
import { connectDatabase } from './database/connection.js';
import { logger } from './utils/logger.js';
import { loadEvents } from './handlers/eventHandler.js';
import { loadCommands } from './handlers/commandHandler.js';

dotenv.config();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages
    ]
});

client.commands = new Collection();

async function startBot() {
    try {
        await connectDatabase();
        await loadCommands(client);
        await loadEvents(client);
        
        await client.login(process.env.DISCORD_TOKEN);
        logger.info(`✅ Bot ${client.user.tag} olarak giriş yaptı!`);
    } catch (error) {
        logger.error('Bot başlatma hatası: ' + error.message);
        process.exit(1);
    }
}

startBot();
