const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const prisma = require('../utils/db');
const { errorEmbed, CATEGORY_EMOJIS, CATEGORY_COLORS } = require('../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ders-raporu')
    .setDescription('Bir öğrencinin tüm ders raporunu göster')
    .addUserOption(opt =>
      opt.setName('kullanici')
        .setDescription('Raporu gösterilecek öğrenci (boş bırakırsan kendin)')
        .setRequired(false)
    )
    .addStringOption(opt =>
      opt.setName('kategori')
        .setDescription('Sadece belirli bir kategorinin derslerini göster')
        .setRequired(false)
        .addChoices(
          { name: '🎬 VOD', value: 'VOD' },
          { name: '🧠 Gamesense', value: 'GAMESENSE' },
          { name: '⚡ Movement', value: 'MOVEMENT' },
          { name: '🎯 Aim', value: 'AIM' },
        )
    ),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: false });

    const target = interaction.options.getUser('kullanici') || interaction.user;
    const categoryFilter = interaction.options.getString('kategori');

    const student = await prisma.student.findUnique({ where: { discordId: target.id } });
    if (!student) {
      return interaction.editReply({
        embeds: [errorEmbed('Kayıt Bulunamadı', `<@${target.id}> kayıtlı bir öğrenci değil.`)],
      });
    }

    const whereClause = { studentId: student.id };
    if (categoryFilter) whereClause.category = categoryFilter;

    const lessons = await prisma.lesson.findMany({
      where: whereClause,
      orderBy: { lessonNumber: 'asc' },
    });

    if (!lessons.length) {
      return interaction.editReply({
        embeds: [errorEmbed('Ders Yok', `${categoryFilter ? `**${categoryFilter}** kategorisinde` : ''} hiç ders bulunamadı.`)],
      });
    }

    // Stats by category
    const byCat = {};
    for (const l of lessons) {
      if (!byCat[l.category]) byCat[l.category] = { count: 0, totalMins: 0 };
      byCat[l.category].count++;
      byCat[l.category].totalMins += l.durationMins || 0;
    }

    const totalMins = lessons.reduce((sum, l) => sum + (l.durationMins || 0), 0);
    const autoCount = lessons.filter(l => l.isAutomatic).length;
    const manualCount = lessons.length - autoCount;

    const embed = new EmbedBuilder()
      .setColor(categoryFilter ? (CATEGORY_COLORS[categoryFilter] || 0x6366f1) : 0x6366f1)
      .setTitle(`📊 Ders Raporu — ${student.name} ${student.surname}`)
      .setThumbnail(target.displayAvatarURL())
      .addFields(
        {
          name: '📈 Genel Özet',
          value: [
            `📚 Toplam: **${lessons.length}** ders`,
            `✅ Tamamlanan: **${student.totalLessons - student.remainingLessons}**`,
            `📋 Kalan: **${student.remainingLessons}**`,
            `⏱️ Toplam Süre: **${totalMins > 0 ? totalMins + ' dk' : 'Kayıt yok'}**`,
            `🤖 Otomatik: **${autoCount}** | ✍️ Manuel: **${manualCount}**`,
          ].join('\n'),
          inline: false,
        },
        {
          name: '📂 Kategoriye Göre',
          value: Object.entries(byCat).map(([cat, data]) =>
            `${CATEGORY_EMOJIS[cat] || '📚'} **${cat}**: ${data.count} ders${data.totalMins > 0 ? ` (${data.totalMins} dk)` : ''}`
          ).join('\n') || '-',
          inline: false,
        }
      )
      .setTimestamp();

    // Lesson list — chunk into pages of 15
    const PAGE_SIZE = 15;
    const pages = [];
    for (let i = 0; i < lessons.length; i += PAGE_SIZE) {
      pages.push(lessons.slice(i, i + PAGE_SIZE));
    }

    const lessonLines = pages[0].map(l => {
      const date = new Date(l.createdAt).toLocaleDateString('tr-TR');
      const emoji = CATEGORY_EMOJIS[l.category] || '📚';
      const dur = l.durationMins ? ` (${l.durationMins}dk)` : '';
      const auto = l.isAutomatic ? '🤖' : '✍️';
      const id = `\`${l.id.slice(-6)}\``;
      return `${auto} ${emoji} **#${l.lessonNumber}** ${l.category} — ${date}${dur} ${id}`;
    });

    embed.addFields({
      name: `📜 Dersler ${lessons.length > PAGE_SIZE ? `(1/${pages.length} sayfa)` : ''}`,
      value: lessonLines.join('\n'),
      inline: false,
    });

    if (lessons.length > PAGE_SIZE) {
      embed.setFooter({ text: `Toplam ${lessons.length} ders var. Sadece ilk ${PAGE_SIZE} gösteriliyor.` });
    }

    await interaction.editReply({ embeds: [embed] });
  },
};
