const { SlashCommandBuilder, ActionRowBuilder, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
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
    .addUserOption(opt =>
      opt.setName('koc')
        .setDescription('Dersi veren koç (belirtilmezse komutu kullanan koç sayılır)')
        .setRequired(false)
    )
    .addStringOption(opt =>
      opt.setName('tarih')
        .setDescription('Ders tarihi (GG.AA.YYYY formatında, örn: 25.05.2026) - boş bırakılırsa bugün')
        .setRequired(false)
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

    const user       = interaction.options.getUser('kullanici');
    const category   = interaction.options.getString('kategori');
    const coachUser  = interaction.options.getUser('koc');
    const dateStr    = interaction.options.getString('tarih');
    const note       = interaction.options.getString('not');
    const duration   = interaction.options.getInteger('sure');

    // Tarih parse
    let lessonDate = new Date();
    if (dateStr) {
      const parts = dateStr.split('.');
      if (parts.length === 3) {
        const d = parseInt(parts[0]), m = parseInt(parts[1]) - 1, y = parseInt(parts[2]);
        const parsed = new Date(y, m, d);
        if (!isNaN(parsed.getTime())) {
          lessonDate = parsed;
        } else {
          return interaction.editReply({
            embeds: [errorEmbed('Geçersiz Tarih', 'Tarih formatı hatalı. Lütfen GG.AA.YYYY formatını kullanın. Örn: 25.05.2026')],
          });
        }
      } else {
        return interaction.editReply({
          embeds: [errorEmbed('Geçersiz Tarih', 'Tarih formatı hatalı. Lütfen GG.AA.YYYY formatını kullanın. Örn: 25.05.2026')],
        });
      }
    }

    // Koç bilgisi — belirtilmişse o kullanıcı, yoksa komutu kullanan
    const coachDiscordUser = coachUser || interaction.user;
    const coachDiscordId   = coachDiscordUser.id;
    const coachUsername    = coachDiscordUser.username;

    const student = await prisma.student.findUnique({ where: { discordId: user.id } });
    if (!student) {
      return interaction.editReply({
        embeds: [errorEmbed('Kayıt Bulunamadı', `<@${user.id}> kayıtlı bir öğrenci değil. Önce \`/kayit\` ile kayıt et.`)],
      });
    }

    // Pasif öğrenciye ders eklemeye izin ver ama uyar
    const wasInactive = !student.isActive;

    const lessonCount  = await prisma.lesson.count({ where: { studentId: student.id } });
    const lessonNumber = lessonCount + 1;

    await prisma.lesson.create({
      data: {
        lessonNumber,
        studentId:    student.id,
        coachId:      coachDiscordId,
        coachUsername,
        category,
        startedAt:    lessonDate,
        endedAt:      lessonDate,
        durationMins: duration || null,
        notes:        note || null,
        isAutomatic:  false,
      },
    });

    await prisma.student.update({
      where: { id: student.id },
      data: {
        totalLessons:     { increment: 1 },
        remainingLessons: { decrement: 1 },
      },
    });

    // Kalan ders kontrolü — sıfırlandıysa otomatik pasife al
    const updatedStudent = await prisma.student.findUnique({ where: { id: student.id } });
    let autoDeactivated = false;
    if (updatedStudent.remainingLessons <= 0 && updatedStudent.isActive) {
      await prisma.student.update({
        where: { id: student.id },
        data:  { isActive: false },
      });
      autoDeactivated = true;
    }

    // Log kanalına bildir
    const logChannelId = process.env.LESSON_LOG_CHANNEL_ID;
    if (logChannelId) {
      const logChannel = interaction.guild.channels.cache.get(logChannelId);
      if (logChannel) {
        const { EmbedBuilder } = require('discord.js');
        const CATEGORY_EMOJIS = { VOD: '🎬', GAMESENSE: '🧠', MOVEMENT: '⚡', AIM: '🎯' };
        const dateFormatted = lessonDate.toLocaleDateString('tr-TR');

        const logEmbed = new EmbedBuilder()
          .setColor(autoDeactivated ? 0xef4444 : 0x6366f1)
          .setTitle(`${CATEGORY_EMOJIS[category]} Manuel Ders Eklendi — #${lessonNumber}`)
          .addFields(
            { name: '👤 Öğrenci',  value: `<@${user.id}>`,         inline: true },
            { name: '🎓 Koç',      value: `<@${coachDiscordId}>`,  inline: true },
            { name: '📂 Kategori', value: category,                 inline: true },
            { name: '📅 Tarih',    value: dateFormatted,            inline: true },
            { name: '⏱️ Süre',    value: duration ? `${duration} dk` : '-', inline: true },
            { name: '📝 Not',      value: note || '-',              inline: false },
            ...(autoDeactivated ? [{ name: '⚠️ Uyarı', value: 'Kalan ders sıfırlandı — öğrenci otomatik pasife alındı!', inline: false }] : []),
            ...(wasInactive ? [{ name: 'ℹ️ Bilgi', value: 'Bu öğrenci pasif durumdayken ders eklendi.', inline: false }] : []),
          )
          .setTimestamp();
        await logChannel.send({ embeds: [logEmbed] }).catch(console.error);
      }
    }

    const remainingFinal = updatedStudent.remainingLessons <= 0 ? 0 : updatedStudent.remainingLessons;
    const lowLessonWarn  = remainingFinal <= 2 && remainingFinal > 0 ? `\n⚠️ **Dikkat:** Öğrencinin yalnızca **${remainingFinal}** dersi kaldı!` : '';

    await interaction.editReply({
      embeds: [
        successEmbed(
          autoDeactivated ? '⚠️ Ders Eklendi — Öğrenci Pasife Alındı!' : 'Ders Eklendi!',
          `**${student.name} ${student.surname}** için **#${lessonNumber}** numaralı ders eklendi.\n\n` +
          `🎓 Koç: <@${coachDiscordId}>\n` +
          `📅 Tarih: **${lessonDate.toLocaleDateString('tr-TR')}**\n` +
          `📂 Kategori: **${category}**\n` +
          `⏱️ Süre: **${duration ? duration + ' dk' : 'Belirtilmedi'}**\n` +
          `📋 Kalan Ders: **${remainingFinal}**\n` +
          `📝 Not: ${note || '-'}` +
          lowLessonWarn +
          (autoDeactivated ? '\n\n❌ Kalan ders tükendi — öğrenci **otomatik pasife** alındı.' : '') +
          (wasInactive ? '\n\nℹ️ Bu öğrenci pasif durumdaydı, ders yine de eklendi.' : '')
        ),
      ],
    });
  },
};
