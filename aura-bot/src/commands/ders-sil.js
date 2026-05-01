const { SlashCommandBuilder } = require('discord.js');
const prisma = require('../utils/db');
const { successEmbed, errorEmbed } = require('../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ders-sil')
    .setDescription('Bir öğrencinin dersini sil')
    .addUserOption(opt =>
      opt.setName('kullanici')
        .setDescription('Dersi silinecek öğrenci')
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('ders_id')
        .setDescription('Silinecek dersin ID\'si (bilmiyorsan /ders-raporu kullan)')
        .setRequired(false)
    )
    .addIntegerOption(opt =>
      opt.setName('ders_no')
        .setDescription('Silinecek dersin numarası')
        .setRequired(false)
        .setMinValue(1)
    ),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const user = interaction.options.getUser('kullanici');
    const lessonId = interaction.options.getString('ders_id');
    const lessonNo = interaction.options.getInteger('ders_no');

    if (!lessonId && !lessonNo) {
      return interaction.editReply({
        embeds: [errorEmbed('Eksik Bilgi', 'Ders ID\'si veya ders numarasından birini gir.')],
      });
    }

    const student = await prisma.student.findUnique({ where: { discordId: user.id } });
    if (!student) {
      return interaction.editReply({
        embeds: [errorEmbed('Kayıt Bulunamadı', `<@${user.id}> kayıtlı bir öğrenci değil.`)],
      });
    }

    let lesson;
    if (lessonId) {
      lesson = await prisma.lesson.findUnique({ where: { id: lessonId } });
    } else {
      lesson = await prisma.lesson.findFirst({
        where: { studentId: student.id, lessonNumber: lessonNo },
      });
    }

    if (!lesson || lesson.studentId !== student.id) {
      return interaction.editReply({
        embeds: [errorEmbed('Ders Bulunamadı', 'Bu ID veya numaraya ait ders bulunamadı.')],
      });
    }

    await prisma.lesson.delete({ where: { id: lesson.id } });

    // Restore remaining lesson count
    await prisma.student.update({
      where: { id: student.id },
      data: {
        totalLessons: { decrement: 1 },
        remainingLessons: { increment: 1 },
      },
    });

    const { CATEGORY_EMOJIS } = require('../utils/embeds');
    const emoji = CATEGORY_EMOJIS[lesson.category] || '📚';

    await interaction.editReply({
      embeds: [
        successEmbed(
          'Ders Silindi',
          `**${student.name} ${student.surname}** için **#${lesson.lessonNumber}** numaralı ders silindi.\n\n` +
          `${emoji} Kategori: **${lesson.category}**\n` +
          `📅 Tarih: **${new Date(lesson.createdAt).toLocaleDateString('tr-TR')}**`
        ),
      ],
    });
  },
};
