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

            // Check for duplicate by discordId
            const existing = await db.collection('students')
                .where('discordId', '==', user.id)
                .limit(1)
                .get();

            if (!existing.empty) {
                return interaction.editReply(`⚠️ **${user.tag}** zaten öğrenci olarak kayıtlı. (ID: \`${existing.docs[0].id}\`)`);
            }

            // Also check by discord field
            const existingByDiscord = await db.collection('students')
                .where('discord', '==', user.id)
                .limit(1)
                .get();

            if (!existingByDiscord.empty) {
                return interaction.editReply(`⚠️ **${user.tag}** zaten öğrenci olarak kayıtlı. (ID: \`${existingByDiscord.docs[0].id}\`)`);
            }

            const docRef = await db.collection('students').add({
                fullName: name,
                discord: user.id,
                discordId: user.id,
                discordTag: user.tag,
                discordUsername: user.username,
                totalLessons: totalLessons,
                usedLessons: 0,
                remainingLessons: totalLessons,
                lessonHistory: [],
                packageName: packageName,
                isActive: true,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                addedBy: interaction.user.tag
            });

            // Also create a registration record for bot-student linking
            await db.collection('registrations').add({
                firestoreStudentId: docRef.id,
                studentId: user.id,
                studentTag: user.tag,
                packageType: packageName,
                status: 'active',
                approvedBy: interaction.user.tag,
                createdAt: new Date(),
                updatedAt: new Date()
            });

            logger.info(`[Admin] Manuel öğrenci eklendi: ${name} (${user.tag}) - ID: ${docRef.id}`);
            await interaction.editReply(`✅ **${name}** başarıyla öğrenci olarak kaydedildi!\nID: \`${docRef.id}\``);
        } catch (error) {
            logger.error(`[Admin] Öğrenci ekleme hatası: ${error.message}`);
            await interaction.editReply('❌ Kayıt sırasında bir hata oluştu.');
        }
    }
};
