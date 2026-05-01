const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('yardim')
    .setDescription('AURA Bot komut listesi'),

  async execute(interaction) {
    const embed = new EmbedBuilder()
      .setColor(0x6366f1)
      .setTitle('🎮 AURA Coaching Bot — Komut Listesi')
      .setDescription('Aşağıda kullanabileceğin tüm komutlar listelenmektedir.')
      .addFields(
        {
          name: '👤 Öğrenci Komutları',
          value: [
            '`/ogrenci` — Öğrenci bilgilerini görüntüle',
            '`/ders-raporu` — Ders geçmişini görüntüle',
          ].join('\n'),
          inline: false,
        },
        {
          name: '🎓 Koç/Admin Komutları',
          value: [
            '`/kayit` — Öğrenci manuel kayıt et',
            '`/ogrenci-duzenle` — Öğrenci bilgilerini güncelle',
            '`/ogrenci-listesi` — Tüm öğrencileri listele',
            '`/ders-ekle` — Manuel ders ekle',
            '`/ders-sil` — Ders sil',
            '`/koc-istatistik` — Koç istatistiklerini görüntüle',
            '`/tum-raporlar` — Genel sistem raporu',
          ].join('\n'),
          inline: false,
        },
        {
          name: '🤖 Otomatik Özellikler',
          value: [
            '🔊 Ses kanalı izleme (VOD / Gamesense / Movement / Aim)',
            '⏱️ 15 dakika grace period (bağlantı kopması)',
            '📨 Otomatik öğrenci kayıt (admin panelinden)',
            '📢 DM bildirimleri',
          ].join('\n'),
          inline: false,
        },
      )
      .setFooter({ text: 'AURA Coaching | auracoaching.com.tr' })
      .setTimestamp();

    await interaction.reply({ embeds: [embed], ephemeral: true });
  },
};
