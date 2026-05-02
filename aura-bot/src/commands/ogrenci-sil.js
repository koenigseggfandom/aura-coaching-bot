const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const prisma = require('../utils/db');
const { successEmbed, errorEmbed } = require('../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ogrenci-sil')
    .setDescription('Kayıtlı bir öğrenciyi sistemden sil')
    .addUserOption(opt =>
      opt.setName('kullanici')
        .setDescription('Silinecek öğrenci')
        .setRequired(true)
    )
    .addBooleanOption(opt =>
      opt.setName('rolu_kaldir')
        .setDescription('Öğrenci rolünü de kaldır? (varsayılan: evet)')
        .setRequired(false)
    ),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const user = interaction.options.getUser('kullanici');
    const removeRole = interaction.options.getBoolean('rolu_kaldir') ?? true;

    const student = await prisma.student.findUnique({
      where: { discordId: user.id },
      include: { lessons: true },
    });

    if (!student) {
      return interaction.editReply({
        embeds: [errorEmbed('Kayıt Bulunamadı', `<@${user.id}> kayıtlı bir öğrenci değil.`)],
      });
    }

    const lessonCount = student.lessons.length;
    const completedLessons = student.totalLessons - student.remainingLessons;

    // Dersleri sil, sonra öğrenciyi sil
    await prisma.lesson.deleteMany({ where: { studentId: student.id } });
    await prisma.voiceSession.deleteMany({ where: { studentId: student.id } });
    await prisma.student.delete({ where: { id: student.id } });

    // Rolü kaldır
    if (removeRole) {
      const studentRoleId = process.env.STUDENT_ROLE_ID;
      if (studentRoleId) {
        const member = await interaction.guild.members.fetch(user.id).catch(() => null);
        if (member) {
          await member.roles.remove(studentRoleId).catch(console.error);
        }
      }
    }

    // Log
    const regLogChannelId = process.env.REGISTER_LOG_CHANNEL_ID;
    if (regLogChannelId) {
      const logChannel = interaction.guild.channels.cache.get(regLogChannelId);
      if (logChannel) {
        const logEmbed = new EmbedBuilder()
          .setColor(0xef4444)
          .setTitle('🗑️ Öğrenci Silindi')
          .addFields(
            { name: 'Öğrenci', value: `${student.name} ${student.surname}`, inline: true },
            { name: 'Discord', value: `<@${user.id}>`, inline: true },
            { name: 'Silen', value: `<@${interaction.user.id}>`, inline: true },
            { name: 'Tamamlanan Ders', value: `${completedLessons}`, inline: true },
            { name: 'Toplam Ders Kaydı', value: `${lessonCount}`, inline: true },
            { name: 'Rol Kaldırıldı', value: removeRole ? 'Evet' : 'Hayır', inline: true },
          )
          .setTimestamp();
        await logChannel.send({ embeds: [logEmbed] }).catch(console.error);
      }
    }

    await interaction.editReply({
      embeds: [
        successEmbed(
          'Öğrenci Silindi',
          `**${student.name} ${student.surname}** (<@${user.id}>) sistemden silindi.\n\n` +
          `🗑️ **${lessonCount}** ders kaydı da silindi.\n` +
          `👤 Rol kaldırıldı: **${removeRole ? 'Evet' : 'Hayır'}**`
        ),
      ],
    });
  },
};