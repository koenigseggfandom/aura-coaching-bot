const { errorEmbed } = require('../utils/embeds');

module.exports = {
  name: 'interactionCreate',
  async execute(interaction, client) {
    if (!interaction.isChatInputCommand()) return;

    const command = client.commands.get(interaction.commandName);
    if (!command) return;

    // Check if user has coach or admin role
    const coachRoleId = process.env.COACH_ROLE_ID;
    const adminRoleId = process.env.ADMIN_ROLE_ID;

    const isCoach = coachRoleId && interaction.member?.roles.cache.has(coachRoleId);
    const isAdmin = adminRoleId && interaction.member?.roles.cache.has(adminRoleId);
    const isOwner = interaction.guild?.ownerId === interaction.user.id;

    // Commands that require coach/admin
    const restrictedCommands = [
      'kayit', 'ders-ekle', 'ders-sil', 'ogrenci-duzenle',
      'ogrenci-listesi', 'koc-istatistik', 'tum-raporlar'
    ];

    if (restrictedCommands.includes(interaction.commandName)) {
      if (!isCoach && !isAdmin && !isOwner) {
        return interaction.reply({
          embeds: [errorEmbed('Yetki Yok', 'Bu komutu kullanmak için **Koç** veya **Admin** rolüne sahip olman gerekiyor.')],
          ephemeral: true,
        });
      }
    }

    try {
      await command.execute(interaction, client);
    } catch (err) {
      console.error(`[CMD ERROR] ${interaction.commandName}:`, err);
      const reply = {
        embeds: [errorEmbed('Hata Oluştu', `Bir hata meydana geldi: \`${err.message}\``)],
        ephemeral: true,
      };
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(reply).catch(() => {});
      } else {
        await interaction.reply(reply).catch(() => {});
      }
    }
  },
};
