const { SlashCommandBuilder } = require('discord.js');
const prisma = require('../utils/db');
const { successEmbed, errorEmbed } = require('../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('pasife-al')
    .setDescription('Bir öğrenciyi pasife al ve öğrenci rolünü kaldır')
    .addUserOption(opt =>
      opt.setName('kullanici')
        .setDescription('Pasife alınacak öğrenci')
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('sebep')
        .setDescription('Pasife alma sebebi (opsiyonel)')
        .setRequired(false)
    ),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const user   = interaction.options.getUser('kullanici');
    const reason = interaction.options.getString('sebep') || 'Belirtilmedi';

    // DB'de öğrenciyi bul
    const student = await prisma.student.findUnique({ where: { discordId: user.id } });
    if (!student) {
      return interaction.editReply({
        embeds: [errorEmbed('Kayıt Bulunamadı', `<@${user.id}> kayıtlı bir öğrenci değil.`)],
      });
    }

    if (!student.isActive) {
      return interaction.editReply({
        embeds: [errorEmbed('Zaten Pasif', `<@${user.id}> zaten pasif durumda.`)],
      });
    }

    // DB'de pasife al
    await prisma.student.update({
      where: { id: student.id },
      data:  { isActive: false },
    });

    // Discord rolünü kaldır
    const studentRoleId = process.env.STUDENT_ROLE_ID;
    let roleRemoved = false;
    let roleError = null;

    if (studentRoleId) {
      try {
        const member = await interaction.guild.members.fetch(user.id).catch(() => null);
        if (member && member.roles.cache.has(studentRoleId)) {
          await member.roles.remove(studentRoleId, `Pasife alındı — ${reason}`);
          roleRemoved = true;
        } else if (member) {
          roleError = 'Kullanıcıda bu rol zaten yoktu.';
        } else {
          roleError = 'Kullanıcı sunucuda bulunamadı.';
        }
      } catch (e) {
        roleError = e.message;
        console.error('[PASIFE-AL] Rol kaldırma hatası:', e.message);
      }
    } else {
      roleError = 'STUDENT_ROLE_ID env değişkeni tanımlı değil.';
    }

    // Log kanalına bildir
    const logChannelId = process.env.LESSON_LOG_CHANNEL_ID;
    if (logChannelId) {
      const logChannel = interaction.guild.channels.cache.get(logChannelId);
      if (logChannel) {
        const { EmbedBuilder } = require('discord.js');
        const logEmbed = new EmbedBuilder()
          .setColor(0xef4444)
          .setTitle('🔴 Öğrenci Pasife Alındı')
          .addFields(
            { name: '👤 Öğrenci',      value: `<@${user.id}> (${student.name} ${student.surname})`, inline: true },
            { name: '🛡️ İşlemi Yapan', value: `<@${interaction.user.id}>`,                         inline: true },
            { name: '📝 Sebep',         value: reason,                                               inline: false },
            { name: '🎭 Rol Durumu',    value: roleRemoved ? '✅ Öğrenci rolü kaldırıldı' : `⚠️ Rol kaldırılamadı: ${roleError}`, inline: false },
            { name: '📋 Kalan Ders',    value: String(student.remainingLessons || 0),               inline: true },
          )
          .setTimestamp();
        await logChannel.send({ embeds: [logEmbed] }).catch(console.error);
      }
    }

    await interaction.editReply({
      embeds: [
        successEmbed(
          '🔴 Öğrenci Pasife Alındı',
          `**${student.name} ${student.surname}** (<@${user.id}>) başarıyla pasife alındı.\n\n` +
          `📝 Sebep: **${reason}**\n` +
          `🎭 Rol: **${roleRemoved ? 'Öğrenci rolü kaldırıldı ✅' : `Kaldırılamadı — ${roleError}`}**\n` +
          `📋 Kalan Ders: **${student.remainingLessons || 0}**\n\n` +
          `Öğrenciyi tekrar aktifleştirmek için \`/aktifleştir\` komutunu veya admin panelini kullanın.`
        ),
      ],
    });
  },
};
