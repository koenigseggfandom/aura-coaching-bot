const { SlashCommandBuilder } = require('discord.js');
const prisma = require('../utils/db');
const { errorEmbed, studentCard } = require('../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ogrenci')
    .setDescription('Bir öğrencinin tüm bilgilerini göster')
    .addUserOption(opt =>
      opt.setName('kullanici')
        .setDescription('Bilgilerini görmek istediğin öğrenci (boş bırakırsan kendin)')
        .setRequired(false)
    ),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: false });

    const target = interaction.options.getUser('kullanici') || interaction.user;

    const student = await prisma.student.findUnique({
      where: { discordId: target.id },
      include: {
        lessons: {
          orderBy: { createdAt: 'desc' },
          take: 5,
        },
      },
    });

    if (!student) {
      return interaction.editReply({
        embeds: [errorEmbed('Kayıt Bulunamadı', `<@${target.id}> kayıtlı bir öğrenci değil.\nKayıt için koçuna ulaş veya \`/kayit\` komutunu kullan.`)],
      });
    }

    // Güvenli değerler — negatife düşmesin
    const safeTotal = Math.max(0, student.totalLessons || 0);
    const safeRemaining = Math.max(0, student.remainingLessons || 0);
    const safeCompleted = Math.max(0, safeTotal - safeRemaining);

    // Gerekirse DB'yi düzelt
    if (student.totalLessons < 0 || student.remainingLessons < 0) {
      await prisma.student.update({
        where: { id: student.id },
        data: {
          totalLessons: safeTotal,
          remainingLessons: safeRemaining,
        },
      }).catch(() => {});
    }

    const fixedStudent = {
      ...student,
      totalLessons: safeTotal,
      remainingLessons: safeRemaining,
    };

    const embed = studentCard(fixedStudent, student.lessons);
    embed.setThumbnail(target.displayAvatarURL({ size: 256 }));

    if (student.lessons.length > 0) {
      const { CATEGORY_EMOJIS } = require('../utils/embeds');
      const lessonLines = student.lessons.map(l => {
        const date = new Date(l.createdAt).toLocaleDateString('tr-TR');
        const emoji = CATEGORY_EMOJIS[l.category] || '📚';
        const dur = l.durationMins ? `${l.durationMins}dk` : '';
        return `${emoji} **#${l.lessonNumber}** ${l.category} — ${date} ${dur ? `(${dur})` : ''}`;
      });
      embed.addFields({
        name: '📜 Son 5 Ders',
        value: lessonLines.join('\n'),
        inline: false,
      });
    }

    await interaction.editReply({ embeds: [embed] });
  },
};