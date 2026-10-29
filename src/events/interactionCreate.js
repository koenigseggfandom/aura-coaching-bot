import { Events } from 'discord.js';
import { logger } from '../utils/logger.js';

export default {
    name: Events.InteractionCreate,
    async execute(interaction) {
        if (!interaction.isChatInputCommand()) return;

        const command = interaction.client.commands.get(interaction.commandName);

        if (!command) {
            logger.error(`Komut bulunamadı: ${interaction.commandName}`);
            return;
        }

        try {
            await command.execute(interaction);
        } catch (error) {
            logger.error(`Komut yürütme hatası (${interaction.commandName}): ${error.message}`);
            try {
                if (interaction.replied || interaction.deferred) {
                    await interaction.followUp({ content: 'Bu komutu çalıştırırken bir hata oluştu!', ephemeral: true }).catch(() => {});
                } else {
                    await interaction.reply({ content: 'Bu komutu çalıştırırken bir hata oluştu!', ephemeral: true }).catch(() => {});
                }
            } catch (_) {}
        }
    }
};
