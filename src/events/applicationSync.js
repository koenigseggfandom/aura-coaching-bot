import { EmbedBuilder } from 'discord.js';
import { getFirestore } from '../database/connection.js';
import { logger } from '../utils/logger.js';

let applicationChannelId = null;
const processedAppIds = new Set();
let isInitialSnap = true;

export async function startApplicationSync(client) {
    const db = getFirestore();
    
    logger.info('[Sync] Başvuru senkronizasyonu başlatıldı.');

    // Önce ayarları dinle
    const settingsRef = db.collection('settings').doc('announcements');
    settingsRef.onSnapshot((doc) => {
        if (doc && doc.exists) {
            applicationChannelId = doc.data().applicationChannelId;
            logger.info(`[Sync] Başvuru duyuru kanalı güncellendi: ${applicationChannelId}`);
        }
    });

    // Başvuruları dinle
    db.collection('applications').onSnapshot(
        (snap) => {
            const changes = snap.docChanges();

            if (isInitialSnap) {
                // İlk okumada mevcut tüm başvuruları hafızaya al
                changes.forEach((change) => {
                    processedAppIds.add(change.doc.id);
                });
                isInitialSnap = false;
                logger.info(`[Sync] Mevcut ${processedAppIds.size} başvuru hafızaya alındı, yeni gelenler bekleniyor.`);
                return;
            }

            // İlk çalıştırmadan sonra yeni eklenen tüm başvuruları anında gönder
            changes.forEach(async (change) => {
                const doc = change.doc;
                const id = doc.id;
                const data = doc.data();

                if (change.type === 'added') {
                    if (processedAppIds.has(id)) return;
                    processedAppIds.add(id);
                    await postApplication(client, id, data);
                }
            });
        },
        (err) => {
            logger.error('[Sync] Başvuru snapshot hatası: ' + err.message);
            setTimeout(() => startApplicationSync(client), 5000);
        }
    );
}

async function resolveApplicationChannel(client) {
    if (applicationChannelId) {
        const ch = await client.channels.fetch(applicationChannelId).catch(() => null);
        if (ch) return ch;
    }

    if (process.env.APPLICATION_CHANNEL_ID) {
        const ch = await client.channels.fetch(process.env.APPLICATION_CHANNEL_ID).catch(() => null);
        if (ch) return ch;
    }

    // Guild içindeki başvuru kanallarını ara
    const guildId = process.env.GUILD_ID;
    const guild = guildId ? client.guilds.cache.get(guildId) : client.guilds.cache.first();
    if (guild) {
        const found = guild.channels.cache.find(c => 
            c.isTextBased() && (
                c.name.includes('başvuru') || 
                c.name.includes('basvuru') || 
                c.name.includes('application') ||
                c.name.includes('kayıt')
            )
        );
        if (found) {
            applicationChannelId = found.id;
            return found;
        }
    }
    return null;
}

async function postApplication(client, appId, data) {
    const channel = await resolveApplicationChannel(client);
    if (!channel) {
        logger.warn('[Sync] Başvuru kanalı bulunamadı! /duyuru-kanal-belirle komutunu kullanın veya APPLICATION_CHANNEL_ID tanımlayın.');
        return;
    }

    try {
        const embed = new EmbedBuilder()
            .setColor('#F59E0B')
            .setTitle('📝 Yeni Koçluk Başvurusu!')
            .setDescription('Web sitesinden yeni bir başvuru alındı.')
            .addFields(
                { name: '👤 İsim Soyisim', value: data.fullName || `${data.firstName || ''} ${data.lastName || ''}`.trim() || 'Bilinmiyor', inline: true },
                { name: '💬 Discord', value: `\`${data.discord || 'Bilinmiyor'}\``, inline: true },
                { name: '📧 E-posta', value: data.email || 'Bilinmiyor', inline: true },
                { name: '🎯 Mevcut Rank', value: data.currentRank || 'Belirtilmedi', inline: true },
                { name: '🏆 Hedef Rank', value: data.targetRank || 'Belirtilmedi', inline: true },
                { name: '⏰ Uygun Saatler', value: data.availability || 'Belirtilmedi', inline: true },
                { name: '🔗 Tracker Link', value: data.trackerLink || 'Belirtilmedi', inline: false },
                { name: '📌 Beklentiler', value: data.expectations || 'Belirtilmedi', inline: false },
                { name: '📝 Kendini Tanıtma', value: data.introduction || 'Not bırakılmadı', inline: false }
            )
            .setFooter({ text: `Başvuru ID: ${appId}` })
            .setTimestamp();

        await channel.send({ 
            content: '🚨 **Yeni Başvuru Geldi!**',
            embeds: [embed] 
        });
        
        logger.info(`[Sync] Yeni başvuru duyuru kanalına gönderildi: ${appId}`);
    } catch (error) {
        logger.error(`[Sync] Başvuru mesajı gönderme hatası: ${error.message}`);
    }
}
