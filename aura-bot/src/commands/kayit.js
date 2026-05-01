const { SlashCommandBuilder } = require('discord.js');
const prisma = require('../utils/db');
const { successEmbed, errorEmbed, studentCard } = require('../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('kayit')
    .setDescription('Bir öğrenciyi manuel olarak Discord sunucusuna kayıt et')
    .addUserOption(opt =>
      opt.setName('kullanici')
        .setDescription('Kayıt edilecek Discord kullanıcısı')
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('ad')
        .setDescription('Öğrencinin adı')
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('soyad')
        .setDescription('Öğrencinin soyadı')
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('rank')
        .setDescription('Mevcut rank')
        .setRequired(false)
        .addChoices(
          { name: 'Iron', value: 'Iron' },
          { name: 'Bronze', value: 'Bronze' },
          { name: 'Silver', value: 'Silver' },
          { name: 'Gold', value: 'Gold' },
          { name: 'Platinum', value: 'Platinum' },
          { name: 'Diamond', value: 'Diamond' },
          { name: 'Ascendant', value: 'Ascendant' },
          { name: 'Immortal', value: 'Immortal' },
          { name: 'Radiant', value: 'Radiant' },
        )
    )
    .addStringOption(opt =>
      opt.setName('hedef_rank')
        .setDescription('Hedef rank')
        .setRequired(false)
        .addChoices(
          { name: 'Iron', value: 'Iron' },
          { name: 'Bronze', value: 'Bronze' },
          { name: 'Silver', value: 'Silver' },
          { name: 'Gold', value: 'Gold' },
          { name: 'Platinum', value: 'Platinum' },
          { name: 'Diamond', value: 'Diamond' },
          { name: 'Ascendant', value: 'Ascendant' },
          { name: 'Immortal', value: 'Immortal' },
          { name: 'Radiant', value: 'Radiant' },
        )
    )
    .addStringOption(opt =>
      opt.setName('paket')
        .setDescription('Paket türü (örn: 5 Ders, 10 Ders)')
        .setRequired(false)
    )
    .addIntegerOption(opt =>
      opt.setName('ders_sayisi')
        .setDescription('Toplam ders sayısı (paket adedi)')
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(100)
    ),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const user = interaction.options.getUser('kullanici');
    const member = await interaction.guild.members.fetch(user.id).catch(() => null);

    if (!member) {
      return interaction.editReply({ embeds: [errorEmbed('Bulunamadı', 'Bu kullanıcı sunucuda bulunamadı.')] });
    }

    // Check if already registered
    const existing = await prisma.student.findUnique({ where: { discordId: user.id } });
    if (existing) {
      return interaction.editReply({
        embeds: [errorEmbed('Zaten Kayıtlı', `**${user.username}** zaten kayıtlı bir öğrenci!\nDüzenlemek için \`/ogrenci-duzenle\` komutunu kullan.`)],
      });
    }

    const ad = interaction.options.getString('ad');
    const soyad = interaction.options.getString('soyad');
    const rank = interaction.options.getString('rank');
    const targetRank = interaction.options.getString('hedef_rank');
    const packageType = interaction.options.getString('paket');
    const lessonCount = interaction.options.getInteger('ders_sayisi') || 0;

    const student = await prisma.student.create({
      data: {
        discordId: user.id,
        discordUsername: user.username,
        name: ad,
        surname: soyad,
        rank: rank || null,
        targetRank: targetRank || null,
        packageType: packageType || null,
        totalLessons: lessonCount,
        remainingLessons: lessonCount,
        isActive: true,
      },
    });

    // Give student role
    const studentRoleId = process.env.STUDENT_ROLE_ID;
    if (studentRoleId) {
      await member.roles.add(studentRoleId).catch(console.error);
    }

    // Log to register channel
    const regLogChannelId = process.env.REGISTER_LOG_CHANNEL_ID;
    if (regLogChannelId) {
      const logChannel = interaction.guild.channels.cache.get(regLogChannelId);
      if (logChannel) {
        const { EmbedBuilder } = require('discord.js');
        const logEmbed = new EmbedBuilder()
          .setColor(0x22c55e)
          .setTitle('✅ Manuel Kayıt')
          .addFields(
            { name: 'Öğrenci', value: `${ad} ${soyad}`, inline: true },
            { name: 'Discord', value: `<@${user.id}>`, inline: true },
            { name: 'Kayıt Eden', value: `<@${interaction.user.id}>`, inline: true },
            { name: 'Rank', value: rank || '-', inline: true },
            { name: 'Hedef', value: targetRank || '-', inline: true },
            { name: 'Paket', value: packageType || '-', inline: true },
          )
          .setThumbnail(user.displayAvatarURL())
          .setTimestamp();
        await logChannel.send({ embeds: [logEmbed] }).catch(console.error);
      }
    }

    // DM the student
    const { EmbedBuilder } = require('discord.js');
    const dmEmbed = new EmbedBuilder()
      .setColor(0x6366f1)
      .setTitle('🎮 AURA Coaching\'e Hoş Geldin!')
      .setDescription(
        `Merhaba **${ad}**! AURA Coaching Discord sunucusuna başarıyla kaydoldun.\n\n` +
        `📦 Paket: **${packageType || '-'}**\n` +
        `🎯 Mevcut Rank: **${rank || '-'}**\n` +
        `🏆 Hedef Rank: **${targetRank || '-'}**\n\n` +
        `Koçun seninle iletişime geçecek. Hazır ol! 🔥`
      )
      .setFooter({ text: 'AURA Coaching | auracoaching.com.tr' })
      .setTimestamp();

    await user.send({ embeds: [dmEmbed] }).catch(() => {}); // DM kapalı olabilir

    await interaction.editReply({
      embeds: [
        successEmbed(
          'Kayıt Başarılı!',
          `**${ad} ${soyad}** (<@${user.id}>) başarıyla kayıt edildi!\n\n` +
          `📦 Paket: **${packageType || '-'}**\n` +
          `🎯 Rank: **${rank || '-'}** → 🏆 **${targetRank || '-'}**\n` +
          `📚 Ders Hakkı: **${lessonCount}**`
        ),
      ],
    });
  },
};
