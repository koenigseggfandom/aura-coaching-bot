const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const prisma = require('../utils/db');
const { CATEGORY_EMOJIS } = require('../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('koc-istatistik')
    .setDescription('Koçların ders istatistiklerini göster')
    .addUserOption(opt =>
      opt.setName('koc')
        .setDescription('Belirli bir koçun istatistiği (boş = tüm koçlar)')
        .setRequired(false)
    )
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

    const targetCoach = interaction.options.getUser('koc');
    const periyot = interaction.options.getString('periyot') || 'hepsi';

    // Date filter
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

    const whereBase = { ...dateFilter };
    if (targetCoach) whereBase.coachId = targetCoach.id;

    const lessons = await prisma.lesson.findMany({
      where: whereBase,
      include: { student: true },
    });

    if (!lessons.length) {
      const embed = new EmbedBuilder()
        .setColor(0x94a3b8)
        .setTitle('🎓 Koç İstatistikleri')
        .setDescription('Bu periyotta ders bulunamadı.')
        .setTimestamp();
      return interaction.editReply({ embeds: [embed] });
    }

    // Group by coach
    const coachMap = {};
    for (const l of lessons) {
      if (!coachMap[l.coachId]) {
        coachMap[l.coachId] = {
          coachId: l.coachId,
          coachUsername: l.coachUsername || 'Bilinmiyor',
          total: 0,
          categories: {},
          students: new Set(),
          totalMins: 0,
        };
      }
      const c = coachMap[l.coachId];
      c.total++;
      c.students.add(l.studentId);
      c.totalMins += l.durationMins || 0;
      if (!c.categories[l.category]) c.categories[l.category] = 0;
      c.categories[l.category]++;
    }

    const coaches = Object.values(coachMap).sort((a, b) => b.total - a.total);

    const periyotLabel = { hafta: 'Bu Hafta', ay: 'Bu Ay', hepsi: 'Tüm Zamanlar' }[periyot];
    const embed = new EmbedBuilder()
      .setColor(0xec4899)
      .setTitle(`🎓 Koç İstatistikleri — ${periyotLabel}`)
      .setDescription(`📚 Toplam **${lessons.length}** ders | 👥 **${coaches.length}** aktif koç`)
      .setTimestamp();

    for (const [i, c] of coaches.entries()) {
      const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `**${i + 1}.**`;
      const catBreakdown = Object.entries(c.categories)
        .map(([cat, cnt]) => `${CATEGORY_EMOJIS[cat] || '📚'} ${cat}: ${cnt}`)
        .join(' | ');
      const hours = c.totalMins > 0 ? ` | ⏱️ ${Math.round(c.totalMins / 60 * 10) / 10} saat` : '';

      embed.addFields({
        name: `${medal} ${c.coachUsername} — ${c.total} ders`,
        value: `👥 ${c.students.size} öğrenci${hours}\n${catBreakdown || 'Kategori yok'}`,
        inline: false,
      });

      if (i >= 9) {
        embed.setFooter({ text: `Sadece ilk 10 koç gösteriliyor.` });
        break;
      }
    }

    await interaction.editReply({ embeds: [embed] });
  },
};
