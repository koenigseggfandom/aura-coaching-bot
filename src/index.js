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

function normalizeDiscordToken(token) {
    if (!token) return '';
    let t = String(token).trim();
    // Eger kullanici degeri yapistirirken basindaki DISCORD_TOKEN= kismini da aldiysa temizle
    if (t.includes('=')) {
        t = t.split('=').pop().trim();
    }
    // Tirnak isaretlerini temizle
    if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
        t = t.slice(1, -1).trim();
    }
    // Fazla "Bot " on ekini temizle
    if (t.startsWith('Bot ')) {
        t = t.slice(4).trim();
    }
    return t;
}

async function startBot() {
    try {
        await connectDatabase();
        await loadCommands(client);
        await loadEvents(client);
        
        const token = normalizeDiscordToken(process.env.DISCORD_TOKEN);
        if (!token) {
            throw new Error('DISCORD_TOKEN bos veya gecersiz!');
        }
        await client.login(token);
        logger.info(`✅ Bot ${client.user.tag} olarak giriş yaptı!`);
    } catch (error) {
        logger.error('Bot başlatma hatası: ' + error.message);
        process.exit(1);
    }
}

startBot();
