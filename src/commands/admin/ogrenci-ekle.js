import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { getFirestore } from '../../database/connection.js';
import { logger } from '../../utils/logger.js';

export default {
    data: new SlashCommandBuilder()
        .setName('ogrenci-ekle')
        .setDescription('Yeni bir öğrenci kaydı oluşturur ve veritabanına ekler.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption(option =>
            option.setName('isim')
                .setDescription('Öğrencinin tam adı')
                .setRequired(true))
        .addUserOption(option =>
            option.setName('kullanici')
                .setDescription('Discord kullanıcısı')
                .setRequired(true))
        .addIntegerOption(option =>
            option.setName('paket')
                .setDescription('Toplam ders sayısı')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('paket-adi')
                .setDescription('Satın alınan paket adı')
                .setRequired(false)),
    async execute(interaction) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const name = interaction.options.getString('isim');
        const user = interaction.options.getUser('kullanici');
        const totalLessons = interaction.options.getInteger('paket');
        const packageName = interaction.options.getString('paket-adi') || 'Manuel Kayıt';

        try {
            const db = getFirestore();

            const docRef = await db.collection('students').add({
                fullName: name,
                discord: user.id,
                discordTag: user.tag,
                totalLessons: totalLessons,
                remainingLessons: totalLessons,
                packageName: packageName,
                isActive: true,
                createdAt: new Date().toISOString(),
                addedBy: interaction.user.tag
            });

            logger.info(`[Admin] Manuel öğrenci eklendi: ${name} (${user.tag})`);
            await interaction.editReply(`✅ **${name}** başarıyla öğrenci olarak kaydedildi!\nID: \`${docRef.id}\``);
        } catch (error) {
            logger.error(`[Admin] Öğrenci ekleme hatası: ${error.message}`);
            await interaction.editReply('❌ Kayıt sırasında bir hata oluştu.');
        }
    }
};
