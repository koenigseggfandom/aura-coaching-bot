import { REST, Routes } from 'discord.js';
import { readdirSync } from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const commands = [];
const commandsPath = path.resolve('src/commands');
const commandFolders = readdirSync(commandsPath);

for (const folder of commandFolders) {
    const folderPath = path.join(commandsPath, folder);
    const commandFiles = readdirSync(folderPath).filter(file => file.endsWith('.js'));

    for (const file of commandFiles) {
        const filePath = path.join(folderPath, file);
        const fileURL = pathToFileURL(filePath).href;
        const { default: command } = await import(fileURL);
        
        if ('data' in command && 'execute' in command) {
            commands.push(command.data.toJSON());
        }
    }
}

const rest = new REST().setToken(normalizeToken(process.env.DISCORD_TOKEN));

/** Yapıştırma sırasında başına karışan "DISCORD_TOKEN=", tırnak ve "Bot " öneklerini temizler. */
function normalizeToken(token) {
    if (!token) return '';
    let t = String(token).trim();
    if (t.includes('=')) t = t.split('=').pop().trim();
    if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
        t = t.slice(1, -1).trim();
    }
    if (t.startsWith('Bot ')) t = t.slice(4).trim();
    return t;
}

(async () => {
    try {
        console.log(`${commands.length} adet slash komutu yükleniyor...`);

        const data = await rest.put(
            Routes.applicationCommands(process.env.CLIENT_ID),
            { body: commands },
        );

        console.log(`${data.length} adet slash komutu başarıyla kaydedildi.`);
    } catch (error) {
        console.error(error);
    }
})();
