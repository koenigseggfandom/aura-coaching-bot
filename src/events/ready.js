import { Events } from 'discord.js';
import { logger } from '../utils/logger.js';
import { startStudentSync } from './studentSync.js';
import { startApplicationSync } from './applicationSync.js';
import { initClassSessions } from './classVoiceTracker.js';
import { publishClassConfig, watchClassConfig, getDatabase } from '../utils/classSessionUtils.js';

export default {
    name: Events.ClientReady,
    once: true,
    async execute(client) {
        logger.info(`✅ Bot ${client.user.tag} olarak hazır!`);
        
        // Veritabanı senkronizasyonlarını başlat
        setTimeout(() => {
            startStudentSync(client);
            startApplicationSync(client);
        }, 2000);

        // Panelde tanımlı sınıfları (classConfig) izle: sınıf eklenip kanal eşleştirildiğinde
        // ses kanalı takibi otomatik devreye girer
        setTimeout(() => {
            watchClassConfig(getDatabase());
        }, 2500);

        // Sınıf ders oturumlarını kontrol et (bot yeniden başlatıldıysa)
        setTimeout(() => {
            initClassSessions(client);
        }, 3000);

        // Sınıf ses kanalı eşleştirmesini panele yayınla
        setTimeout(() => {
            const guild = client.guilds.cache.first();
            publishClassConfig(getDatabase(), guild).catch((e) =>
                logger.warn('[Sınıf] Kanal eşleştirmesi yayınlanamadı: ' + e.message)
            );
        }, 4000);
    }
};
