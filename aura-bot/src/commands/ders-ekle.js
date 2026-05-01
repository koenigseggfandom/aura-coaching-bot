const { SlashCommandBuilder } = require('discord.js');
const prisma = require('../utils/db');
const { successEmbed, errorEmbed } = require('../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ders-ekle')
    .setDescription('Bir öğrenciye manuel ders ekle')
    .addUserOption(opt =>
      opt.setName('kullanici')
        .setDescription('Ders eklenecek öğrenci')
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('kategori')
        .setDescription('Ders kategorisi')
        .setRequired(true)
        .addChoices(
          { name: '🎬 VOD', value: 'VOD' },
          { name: '🧠 Gamesense', value: 'GAMESENSE' },
          { name: '⚡ Movement', value: 'MOVEMENT' },
          { name: '🎯 Aim', value: 'AIM' },
        )
    )
    .addStringOption(opt =>
      opt.setName('not')
        .setDescription('Ders hakkında not (opsiyonel)')
        .setRequired(false)
    )
    .addIntegerOption(opt =>
      opt.setName('sure')
        .setDescription('Ders süresi (dakika, opsiyonel)')
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(300)
    ),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const user = interaction.options.getUser('kullanici');
    const category = interaction.options.getString('kategori');
    const note = interaction.options.getString('not');
    const duration = interaction.options.getInteger('sure');

    const student = await prisma.student.findUnique({ where: { discordId: user.id } });
    if (!student) {
      return interaction.editReply({
        embeds: [errorEmbed('Kayıt Bulunamadı', `<@${user.id}> kayıtlı bir öğrenci değil. Önce \`/kayit\` ile kayıt et.`)],
      });
    }

    const lessonCount = await prisma.lesson.count({ where: { studentId: student.id } });
    const lessonNumber = lessonCount + 1;

    await prisma.lesson.create({
      data: {
        lessonNumber,
        studentId: student.id,
        coachId: interaction.user.id,
        coachUsername: interaction.user.username,
        category,
        startedAt: new Date(),
        endedAt: new Date(),
        durationMins: duration || null,
        notes: note || null,
        isAutomatic: false,
      },
    });

    await prisma.student.update({
      where: { id: student.id },
      data: {
        totalLessons: { increment: 1 },
        remainingLessons: { decrement: 1 },
      },
    });

    // Log
    const logChannelId = process.env.LESSON_LOG_CHANNEL_ID;
    if (logChannelId) {
      const logChannel = interaction.guild.channels.cache.get(logChannelId);
      if (logChannel) {
        const { EmbedBuilder } = require('discord.js');
        const CATEGORY_EMOJIS = { VOD: '🎬', GAMESENSE: '🧠', MOVEMENT: '⚡', AIM: '🎯' };
        const logEmbed = new EmbedBuilder()
          .setColor(0x6366f1)
          .setTitle(`${CATEGORY_EMOJIS[category]} Manuel Ders Eklendi — #${lessonNumber}`)
          .addFields(
            { name: '👤 Öğrenci', value: `<@${user.id}>`, inline: true },
            { name: '🎓 Koç', value: `<@${interaction.user.id}>`, inline: true },
            { name: '📂 Kategori', value: category, inline: true },
            { name: '⏱️ Süre', value: duration ? `${duration} dk` : '-', inline: true },
            { name: '📝 Not', value: note || '-', inline: false },
          )
          .setTimestamp();
        await logChannel.send({ embeds: [logEmbed] }).catch(console.error);
      }
    }

    const updatedStudent = await prisma.student.findUnique({ where: { id: student.id } });

    await interaction.editReply({
      embeds: [
        successEmbed(
          'Ders Eklendi!',
          `**${student.name} ${student.surname}** için **#${lessonNumber}** numaralı ders eklendi.\n\n` +
          `📂 Kategori: **${category}**\n` +
          `⏱️ Süre: **${duration ? duration + ' dk' : 'Belirtilmedi'}**\n` +
          `📋 Kalan Ders: **${updatedStudent.remainingLessons}**\n` +
          `📝 Not: ${note || '-'}`
        ),
      ],
    });
  },
};
