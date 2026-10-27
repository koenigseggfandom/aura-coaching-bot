import { SlashCommandBuilder, PermissionFlagsBits, ChannelType } from 'discord.js';
import { getFirestore } from '../../database/connection.js';
import { logger } from '../../utils/logger.js';

export default {
    data: new SlashCommandBuilder()
        .setName('duyuru-kanal-belirle')
        .setDescription('Yeni başvuruların düşeceği kanalı belirler.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addChannelOption(option => 
            option.setName('kanal')
                .setDescription('Başvuruların gönderileceği kanal')
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(true)),
    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });
        
        const channel = interaction.options.getChannel('kanal');

        try {
            const db = getFirestore();
            
            // Ayarları Firestore'a kaydet
            await db.collection('settings').doc('announcements').set({
                applicationChannelId: channel.id,
                updatedAt: new Date(),
                updatedBy: interaction.user.tag
            }, { merge: true });

            logger.info(`[Admin] Başvuru duyuru kanalı belirlendi: #${channel.name} (${channel.id})`);
            await interaction.editReply(`✅ Başvuru duyuru kanalı başarıyla **${channel}** olarak belirlendi.`);
        } catch (error) {
            logger.error(`[Admin] Kanal belirleme hatası: ${error.message}`);
            await interaction.editReply('❌ Kanal ayarlanırken bir hata oluştu.');
        }
    }
};
