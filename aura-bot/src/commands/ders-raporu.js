const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const prisma = require('../utils/db');

const CATEGORY_EMOJIS = { VOD: '🎬', GAMESENSE: '🧠', MOVEMENT: '⚡', AIM: '🎯' };
const CAT_COLORS = { VOD: 0x6366f1, GAMESENSE: 0xec4899, MOVEMENT: 0x22c55e, AIM: 0xf59e0b };

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ders-raporu')
    .setDescription('Bir öğrencinin ders raporunu göster')
    .addUserOption(opt =>
      opt.setName('kullanici')
        .setDescription('Raporu gösterilecek öğrenci')
        .setRequired(true)
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const user    = interaction.options.getUser('kullanici');
    const student = await prisma.student.findUnique({
      where:   { discordId: user.id },
      include: { lessons: { orderBy: { startedAt: 'desc' } } },
    });

    if (!student) {
      return interaction.editReply({ content: `❌ <@${user.id}> kayıtlı bir öğrenci değil.` });
    }

    const lessons       = student.lessons;
    // completedLessons = gerçek yapılan ders sayısı (lessons tablosundan)
    const completedCount = lessons.length;
    // Paket büyüklüğü = totalLessons (kayıtta set edilmiş, sabit)
    const paketBuyuklugu = student.totalLessons || 0;
    // Kalan = remainingLessons (her ders eklenince azalıyor)
    const remaining      = Math.max(0, student.remainingLessons);

    const autoCount    = lessons.filter(l =>  l.isAutomatic).length;
    const manualCount  = lessons.filter(l => !l.isAutomatic).length;
    const totalMins    = lessons.reduce((sum, l) => sum + (l.durationMins || 0), 0);

    // Kategoriye göre grupla
    const catBreakdown = {};
    lessons.forEach(l => {
      catBreakdown[l.category] = (catBreakdown[l.category] || 0) + 1;
    });

    // Son 5 dersi listele
    const recentLessons = lessons.slice(0, 5);

    // Embed rengi — en çok yapılan kategori
    const topCat = Object.entries(catBreakdown).sort((a, b) => b[1] - a[1])[0];
    const color  = topCat ? (CAT_COLORS[topCat[0]] || 0x6366f1) : 0x6366f1;

    const embed = new EmbedBuilder()
      .setColor(color)
      .setTitle(`📊 Ders Raporu — ${student.name} ${student.surname}`)
      .setThumbnail(user.displayAvatarURL({ dynamic: true }))
      .addFields(
        {
          name: '📈 Genel Özet',
          value: [
            `🗒️ Toplam: **${completedCount}** ders`,
            `✅ Tamamlanan: **${completedCount}**`,
            `📋 Kalan: **${remaining}** / **${paketBuyuklugu}** (Paket: ${student.packageType || paketBuyuklugu + ' Ders'})`,
            `⏱️ Toplam Süre: **${totalMins > 0 ? totalMins + ' dk' : 'Kayıt yok'}**`,
            `🤖 Otomatik: **${autoCount}** | 🏋️ Manuel: **${manualCount}**`,
          ].join('\n'),
          inline: false,
        },
        {
          name: '📂 Kategoriye Göre',
          value: Object.entries(catBreakdown).length
            ? Object.entries(catBreakdown)
                .sort((a, b) => b[1] - a[1])
                .map(([cat, cnt]) => `${CATEGORY_EMOJIS[cat] || '📌'} **${cat}**: ${cnt} ders`)
                .join('\n')
            : 'Henüz ders yok',
          inline: false,
        },
      );

    if (recentLessons.length > 0) {
      embed.addFields({
        name: '📚 Dersler',
        value: recentLessons.map(l => {
          const dateStr = l.startedAt
            ? l.startedAt.toLocaleDateString('tr-TR', { day:'2-digit', month:'2-digit', year:'numeric' })
            : '-';
          const emoji = CATEGORY_EMOJIS[l.category] || '📌';
          return `🎓 ${emoji} **#${l.lessonNumber} ${l.category}** — ${dateStr} \`${l.coachUsername || l.coachId || '-'}\``;
        }).join('\n'),
        inline: false,
      });
    }

    embed.setTimestamp().setFooter({ text: `Durum: ${student.isActive ? '🟢 Aktif' : '🔴 Pasif'}` });

    await interaction.editReply({ embeds: [embed] });
  },
};
