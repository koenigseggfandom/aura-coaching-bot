import { readdirSync } from 'fs';
import { pathToFileURL } from 'url';
import path from 'path';
import { logger } from '../utils/logger.js';

export async function loadEvents(client) {
    const eventsPath = path.resolve('src/events');
    const eventFiles = readdirSync(eventsPath).filter(file => file.endsWith('.js'));

    for (const file of eventFiles) {
        const filePath = path.join(eventsPath, file);
        const fileURL = pathToFileURL(filePath).href;
        const { default: event } = await import(fileURL);

        if (!event || !event.name) {
            logger.warn(`[UYARI] ${file} geçerli bir event yapısına sahip değil, atlanıyor.`);
            continue;
        }

        if (event.once) {
            client.once(event.name, (...args) => event.execute(...args, client));
        } else {
            client.on(event.name, (...args) => event.execute(...args, client));
        }
    }
    logger.info(`✅ ${eventFiles.length} event yüklendi.`);
}
