const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const prisma = require('../utils/db');
const { CATEGORY_EMOJIS } = require('../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('tum-raporlar')
    .setDescription('Tüm sisteme ait genel rapor ve istatistikler')
    .addStringOption(opt =>
      opt.setName('periyot')
        .setDescription('Zaman aralığı')
        .setRequired(false)
        .addChoices(
          { name: '📅 Bu Hafta', value: 'hafta' },
          { name: '🗓️ Bu Ay', value: 'ay' },
          { name: '📆 Tüm Zamanlar', value: 'hepsi' },
        )
    ),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: false });

    const periyot = interaction.options.getString('periyot') || 'hepsi';

    let dateFilter = {};
    const now = new Date();
    if (periyot === 'hafta') {
      const weekStart = new Date(now);
      weekStart.setDate(now.getDate() - now.getDay());
      weekStart.setHours(0, 0, 0, 0);
      dateFilter = { createdAt: { gte: weekStart } };
    } else if (periyot === 'ay') {
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      dateFilter = { createdAt: { gte: monthStart } };
    }

    const [totalStudents, activeStudents, lessons, lowLessons] = await Promise.all([
      prisma.student.count(),
      prisma.student.count({ where: { isActive: true } }),
      prisma.lesson.findMany({ where: dateFilter }),
      prisma.student.findMany({
        where: { remainingLessons: { lte: 3 }, isActive: true },
        select: { name: true, surname: true, discordId: true, remainingLessons: true },
      }),
    ]);

    const totalMins = lessons.reduce((s, l) => s + (l.durationMins || 0), 0);
    const autoLessons = lessons.filter(l => l.isAutomatic).length;
    const manualLessons = lessons.length - autoLessons;

    // Category breakdown
    const byCat = {};
    for (const l of lessons) {
      byCat[l.category] = (byCat[l.category] || 0) + 1;
    }

    // Unique coaches
    const uniqueCoaches = new Set(lessons.map(l => l.coachId)).size;

    const periyotLabel = { hafta: 'Bu Hafta', ay: 'Bu Ay', hepsi: 'Tüm Zamanlar' }[periyot];

    const embed = new EmbedBuilder()
      .setColor(0x6366f1)
      .setTitle(`📊 AURA Coaching — Genel Rapor (${periyotLabel})`)
      .setDescription('Sistemdeki tüm istatistikler aşağıda gösterilmektedir.')
      .addFields(
        {
          name: '👥 Öğrenci Durumu',
          value: [
            `🟢 Aktif: **${activeStudents}**`,
            `⚫ Pasif: **${totalStudents - activeStudents}**`,
            `📋 Toplam: **${totalStudents}**`,
          ].join('\n'),
          inline: true,
        },
        {
          name: '📚 Ders İstatistikleri',
          value: [
            `📊 Toplam: **${lessons.length}** ders`,
            `🤖 Otomatik: **${autoLessons}**`,
            `✍️ Manuel: **${manualLessons}**`,
            `⏱️ Toplam Süre: **${totalMins > 0 ? Math.round(totalMins / 60) + ' saat' : '-'}**`,
          ].join('\n'),
          inline: true,
        },
        {
          name: '🎓 Koç Bilgisi',
          value: `🎓 Aktif Koç: **${uniqueCoaches}**`,
          inline: true,
        },
        {
          name: '📂 Kategoriye Göre Dersler',
          value: Object.entries(byCat).length
            ? Object.entries(byCat)
              .sort((a, b) => b[1] - a[1])
              .map(([cat, cnt]) => `${CATEGORY_EMOJIS[cat] || '📚'} **${cat}**: ${cnt} ders`)
              .join('\n')
            : 'Ders yok',
          inline: false,
        },
      )
      .setTimestamp();

    if (lowLessons.length > 0) {
      const warningLines = lowLessons
        .slice(0, 10)
        .map(s => `⚠️ **${s.name} ${s.surname}** (<@${s.discordId}>) — ${s.remainingLessons} ders kaldı`)
        .join('\n');
      embed.addFields({
        name: '🚨 Dersi Bitmek Üzere Olanlar',
        value: warningLines,
        inline: false,
      });
    }

    await interaction.editReply({ embeds: [embed] });
  },
};
