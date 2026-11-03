import { EmbedBuilder } from 'discord.js';
import { getFirestore } from '../database/connection.js';
import { logger } from '../utils/logger.js';

let applicationChannelId = null;
const processedAppIds = new Set();

export async function startApplicationSync(client) {
    const db = getFirestore();
    
    logger.info('[Sync] Başvuru senkronizasyonu başlatıldı.');

    // Önce ayarları al
    const settingsRef = db.collection('settings').doc('announcements');
    settingsRef.onSnapshot((doc) => {
        if (doc.exists) {
            applicationChannelId = doc.data().applicationChannelId;
            logger.info(`[Sync] Başvuru kanalı güncellendi: ${applicationChannelId}`);
        }
    });

    // Başvuruları dinle
    db.collection('applications').onSnapshot(
        (snap) => {
            snap.docChanges().forEach(async (change) => {
                const doc = change.doc;
                const id = doc.id;
                const data = doc.data();

                if (change.type === 'added') {
                    // Bot yeni açıldığında eski başvuruları tekrar atmasın diye kontrol
                    // İlk snap'te tüm dokümanlar 'added' olarak gelir
                    // Bu yüzden processedAppIds'e bot açılışında mevcut olanları ekleyebiliriz
                    // Ama kullanıcı "gerçek zamanlı her saniye kontrol etsin" dediği için 
                    // yeni gelenleri hemen atmalıyız.
                    if (processedAppIds.has(id)) return;
                    processedAppIds.add(id);

                    // Eğer bot yeni açıldıysa ve snapshot çok eskiyse (örn: 5 dakikadan eski) gönderme
                    const createdAt = data.createdAt?.toDate ? data.createdAt.toDate() : new Date(data.createdAt);
                    const now = new Date();
                    const diff = (now - createdAt) / 1000; // saniye

                    if (diff < 60) { // Son 60 saniye içinde geldiyse yeni sayalım
                        await postApplication(client, id, data);
                    }
                }
            });
        },
        (err) => {
            logger.error('[Sync] Başvuru snapshot hatası: ' + err.message);
            setTimeout(() => startApplicationSync(client), 5000);
        }
    );
}

async function postApplication(client, appId, data) {
    if (!applicationChannelId) {
        logger.warn('[Sync] Başvuru kanalı henüz belirlenmemiş! /duyuru-kanal-belirle komutunu kullanın.');
        return;
    }

    try {
        const channel = await client.channels.fetch(applicationChannelId).catch(() => null);
        if (!channel) return;

        const embed = new EmbedBuilder()
            .setColor('#F59E0B')
            .setTitle('📩 Yeni Koçluk Başvurusu!')
            .setDescription('Web sitesinden yeni bir başvuru alındı.')
            .addFields(
                { name: '👤 İsim Soyisim', value: data.fullName || `${data.firstName || ''} ${data.lastName || ''}`.trim() || 'Bilinmiyor', inline: true },
                { name: '🎮 Discord', value: `\`${data.discord || 'Bilinmiyor'}\``, inline: true },
                { name: '📧 E-posta', value: data.email || 'Bilinmiyor', inline: true },
                { name: '📊 Mevcut Rank', value: data.currentRank || 'Belirtilmedi', inline: true },
                { name: '🎯 Hedef Rank', value: data.targetRank || 'Belirtilmedi', inline: true },
                { name: '🕒 Uygun Saatler', value: data.availability || 'Belirtilmedi', inline: true },
                { name: '🔗 Tracker Link', value: data.trackerLink || 'Belirtilmedi', inline: false },
                { name: '📝 Beklentiler', value: data.expectations || 'Belirtilmedi', inline: false },
                { name: '💬 Kendini Tanıtma', value: data.introduction || 'Not bırakılmadı', inline: false }
            )
            .setFooter({ text: `Başvuru ID: ${appId}` })
            .setTimestamp();

        await channel.send({ 
            content: '🔔 **Yeni Başvuru Geldi!**',
            embeds: [embed] 
        });
        
        logger.info(`[Sync] Yeni başvuru duyuru kanalına gönderildi: ${appId}`);
    } catch (error) {
        logger.error(`[Sync] Başvuru mesajı gönderme hatası: ${error.message}`);
    }
}
