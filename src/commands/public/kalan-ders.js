import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { getFirestore } from '../../database/connection.js';

export default {
    data: new SlashCommandBuilder()
        .setName('kalan-ders')
        .setDescription('Kalan ders sayınızı kontrol edin.'),
    async execute(interaction) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const db = getFirestore();
        const studentSnap = await db.collection('students')
            .where('discord', '==', interaction.user.id)
            .get();

        if (studentSnap.empty) {
            return interaction.editReply('Sistemde kayıtlı öğrenci profiliniz bulunamadı. Lütfen yönetici ile iletişime geçin.');
        }

        const data = studentSnap.docs[0].data();
        const embed = new EmbedBuilder()
            .setColor('#ff4655')
            .setTitle('📊 Ders Durumu')
            .addFields(
                { name: '👤 Öğrenci', value: data.fullName || interaction.user.username, inline: true },
                { name: '📦 Paket', value: data.packageName || 'Belirtilmemiş', inline: true },
                { name: '📚 Kalan Ders', value: `${data.remainingLessons || 0} / ${data.totalLessons || 0}`, inline: false }
            )
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
    }
};
