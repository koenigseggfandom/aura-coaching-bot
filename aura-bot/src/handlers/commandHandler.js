import { readdirSync } from 'fs';
import { pathToFileURL } from 'url';
import path from 'path';
import { logger } from '../utils/logger.js';

export async function loadCommands(client) {
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
                client.commands.set(command.data.name, command);
            } else {
                logger.warn(`[UYARI] ${filePath} komutunda "data" veya "execute" eksik.`);
            }
        }
    }
    logger.info(`✅ ${client.commands.size} komut yüklendi.`);
}
