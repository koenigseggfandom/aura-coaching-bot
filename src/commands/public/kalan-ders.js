import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { getFirestore } from '../../database/connection.js';

export default {
    data: new SlashCommandBuilder()
        .setName('kalan-ders')
        .setDescription('Kalan ders sayınızı kontrol edin.'),
    async execute(interaction) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const db = getFirestore();
        const userId = interaction.user.id;
        const userTag = interaction.user.tag;
        const userName = interaction.user.username;

        // Try multiple fields to find the student (discordId, discord, registration)
        let studentSnap = await db.collection('students')
            .where('discordId', '==', userId)
            .limit(1)
            .get();

        if (studentSnap.empty) {
            studentSnap = await db.collection('students')
                .where('discord', '==', userId)
                .limit(1)
                .get();
        }

        if (studentSnap.empty) {
            studentSnap = await db.collection('students')
                .where('discord', '==', userTag)
                .limit(1)
                .get();
        }

        if (studentSnap.empty) {
            studentSnap = await db.collection('students')
                .where('discord', '==', userName)
                .limit(1)
                .get();
        }

        // Try via registrations table
        if (studentSnap.empty) {
            try {
                const regSnap = await db.collection('registrations')
                    .where('studentId', '==', userId)
                    .limit(1)
                    .get();
                if (!regSnap.empty) {
                    const firestoreStudentId = regSnap.docs[0].data().firestoreStudentId;
                    if (firestoreStudentId) {
                        const doc = await db.collection('students').doc(firestoreStudentId).get();
                        if (doc.exists) {
                            studentSnap = { empty: false, docs: [doc] };
                        }
                    }
                }
            } catch (_) {}
        }

        if (studentSnap.empty) {
            return interaction.editReply('Sistemde kayıtlı öğrenci profiliniz bulunamadı. Lütfen yönetici ile iletişime geçin.');
        }

        const data = studentSnap.docs[0].data();
        const remaining = data.remainingLessons != null
            ? data.remainingLessons
            : Math.max(0, (Number(data.totalLessons || 0) - Number(data.usedLessons || 0)));

        const embed = new EmbedBuilder()
            .setColor('#ff4655')
            .setTitle('📊 Ders Durumu')
            .addFields(
                { name: '👤 Öğrenci', value: data.fullName || interaction.user.username, inline: true },
                { name: '📦 Paket', value: data.packageName || data.packageType || 'Belirtilmemiş', inline: true },
                { name: '📚 Kalan Ders', value: `${remaining} / ${data.totalLessons || 0}`, inline: false }
            )
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
    }
};
