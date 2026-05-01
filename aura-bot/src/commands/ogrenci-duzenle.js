const { SlashCommandBuilder } = require('discord.js');
const prisma = require('../utils/db');
const { successEmbed, errorEmbed } = require('../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ogrenci-duzenle')
    .setDescription('Bir öğrencinin bilgilerini düzenle')
    .addUserOption(opt =>
      opt.setName('kullanici')
        .setDescription('Düzenlenecek öğrenci')
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('alan')
        .setDescription('Hangi alan düzenlensin?')
        .setRequired(true)
        .addChoices(
          { name: 'Ad', value: 'name' },
          { name: 'Soyad', value: 'surname' },
          { name: 'Rank', value: 'rank' },
          { name: 'Hedef Rank', value: 'targetRank' },
          { name: 'Paket', value: 'packageType' },
          { name: 'Kalan Ders', value: 'remainingLessons' },
          { name: 'Toplam Ders', value: 'totalLessons' },
          { name: 'Durum (Aktif/Pasif)', value: 'isActive' },
          { name: 'Ülke', value: 'country' },
          { name: 'Tracker Link', value: 'trackerLink' },
        )
    )
    .addStringOption(opt =>
      opt.setName('deger')
        .setDescription('Yeni değer')
        .setRequired(true)
    ),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const user = interaction.options.getUser('kullanici');
    const field = interaction.options.getString('alan');
    const value = interaction.options.getString('deger');

    const student = await prisma.student.findUnique({ where: { discordId: user.id } });
    if (!student) {
      return interaction.editReply({
        embeds: [errorEmbed('Kayıt Bulunamadı', `<@${user.id}> kayıtlı bir öğrenci değil.`)],
      });
    }

    let updateData = {};
    const fieldLabels = {
      name: 'Ad', surname: 'Soyad', rank: 'Rank', targetRank: 'Hedef Rank',
      packageType: 'Paket', remainingLessons: 'Kalan Ders', totalLessons: 'Toplam Ders',
      isActive: 'Durum', country: 'Ülke', trackerLink: 'Tracker Link',
    };

    if (field === 'remainingLessons' || field === 'totalLessons') {
      const num = parseInt(value);
      if (isNaN(num) || num < 0) {
        return interaction.editReply({ embeds: [errorEmbed('Geçersiz Değer', 'Sayısal bir değer gir.')] });
      }
      updateData[field] = num;
    } else if (field === 'isActive') {
      const lower = value.toLowerCase();
      if (!['aktif', 'pasif', 'true', 'false', '1', '0'].includes(lower)) {
        return interaction.editReply({ embeds: [errorEmbed('Geçersiz Değer', 'Aktif için: `aktif`, Pasif için: `pasif` yaz.')] });
      }
      updateData.isActive = ['aktif', 'true', '1'].includes(lower);
    } else {
      updateData[field] = value;
    }

    await prisma.student.update({
      where: { id: student.id },
      data: updateData,
    });

    await interaction.editReply({
      embeds: [
        successEmbed(
          'Bilgi Güncellendi',
          `**${student.name} ${student.surname}** için **${fieldLabels[field]}** güncellendi.\n\n` +
          `📝 Yeni Değer: **${value}**`
        ),
      ],
    });
  },
};
