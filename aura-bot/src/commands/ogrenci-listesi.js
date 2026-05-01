const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const prisma = require('../utils/db');
const { generateProgressBar } = require('../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ogrenci-listesi')
    .setDescription('Kayıtlı tüm öğrencileri listele')
    .addStringOption(opt =>
      opt.setName('filtre')
        .setDescription('Filtrele')
        .setRequired(false)
        .addChoices(
          { name: '✅ Sadece Aktif', value: 'aktif' },
          { name: '⚫ Sadece Pasif', value: 'pasif' },
          { name: '⚠️ Dersi Bitenler (≤3 kalan)', value: 'bitmek_uzere' },
          { name: '📋 Hepsi', value: 'hepsi' },
        )
    ),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: false });

    const filtre = interaction.options.getString('filtre') || 'hepsi';

    let whereClause = {};
    if (filtre === 'aktif') whereClause.isActive = true;
    else if (filtre === 'pasif') whereClause.isActive = false;
    else if (filtre === 'bitmek_uzere') whereClause = { remainingLessons: { lte: 3 }, isActive: true };

    const students = await prisma.student.findMany({
      where: whereClause,
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    });

    if (!students.length) {
      const embed = new EmbedBuilder()
        .setColor(0x94a3b8)
        .setTitle('👥 Öğrenci Listesi')
        .setDescription('Kayıtlı öğrenci bulunamadı.')
        .setTimestamp();
      return interaction.editReply({ embeds: [embed] });
    }

    const activeCount = students.filter(s => s.isActive).length;
    const totalLessons = students.reduce((sum, s) => sum + (s.totalLessons - s.remainingLessons), 0);

    const embed = new EmbedBuilder()
      .setColor(0x6366f1)
      .setTitle('👥 AURA Coaching — Öğrenci Listesi')
      .setDescription(
        `📊 **${students.length}** öğrenci listelendi | 🟢 **${activeCount}** aktif | 📚 Toplam **${totalLessons}** ders tamamlandı`
      )
      .setTimestamp();

    // Chunk into groups of 10 per field
    const chunks = [];
    for (let i = 0; i < students.length; i += 10) {
      chunks.push(students.slice(i, i + 10));
    }

    for (let ci = 0; ci < Math.min(chunks.length, 5); ci++) {
      const chunk = chunks[ci];
      const lines = chunk.map((s, idx) => {
        const globalIdx = ci * 10 + idx + 1;
        const status = s.isActive ? '🟢' : '⚫';
        const warn = s.remainingLessons <= 3 && s.isActive ? ' ⚠️' : '';
        const completed = s.totalLessons - s.remainingLessons;
        return `${status} **${globalIdx}.** ${s.name} ${s.surname} — <@${s.discordId}>${warn}\n` +
               `   📚 ${completed}/${s.totalLessons} ders | 🎯 ${s.rank || '-'} → ${s.targetRank || '-'}`;
      });

      embed.addFields({
        name: chunks.length > 1 ? `Sayfa ${ci + 1}/${chunks.length}` : '📋 Öğrenciler',
        value: lines.join('\n\n'),
        inline: false,
      });
    }

    if (chunks.length > 5) {
      embed.setFooter({ text: `Sadece ilk 50 öğrenci gösteriliyor. Toplam: ${students.length}` });
    }

    await interaction.editReply({ embeds: [embed] });
  },
};
