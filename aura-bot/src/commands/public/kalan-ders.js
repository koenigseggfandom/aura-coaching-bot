import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getFirestore } from '../../database/connection.js';

export default {
    data: new SlashCommandBuilder()
        .setName('kalan-ders')
        .setDescription('Kalan ders sayınızı kontrol edin.'),
    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });
        
        const db = getFirestore();
        const studentSnap = await db.collection('students')
            .where('discord', 'in', [interaction.user.id, interaction.user.tag])
            .get();

        if (studentSnap.empty) {
            return interaction.editReply('Sistemde kayıtlı öğrenci profiliniz bulunamadı. Lütfen yönetici ile iletişime geçin.');
        }

        const data = studentSnap.docs[0].data();
        const embed = new EmbedBuilder()
            .setColor('#5865F2')
            .setTitle('📊 Ders Durumu')
            .addFields(
                { name: 'Öğrenci', value: data.fullName || interaction.user.username, inline: true },
                { name: 'Paket', value: data.packageName || 'Belirtilmemiş', inline: true },
                { name: 'Kalan Ders', value: `${data.remainingLessons || 0} / ${data.totalLessons || 0}`, inline: false }
            )
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
    }
};
