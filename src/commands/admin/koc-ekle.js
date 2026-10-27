import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { getFirestore } from '../../database/connection.js';
import { logger } from '../../utils/logger.js';

export default {
    data: new SlashCommandBuilder()
        .setName('koc-ekle')
        .setDescription('Yeni bir koç kaydı oluşturur ve veritabanına ekler.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption(option => 
            option.setName('isim')
                .setDescription('Koçun tam adı')
                .setRequired(true))
        .addUserOption(option => 
            option.setName('kullanici')
                .setDescription('Discord kullanıcısı')
                .setRequired(true))
        .addStringOption(option => 
            option.setName('uzmanlik')
                .setDescription('Uzmanlık alanı (Aim, VOD vb.)')
                .setRequired(false)),
    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });
        
        const name = interaction.options.getString('isim');
        const user = interaction.options.getUser('kullanici');
        const specialty = interaction.options.getString('uzmanlik') || 'Genel';

        try {
            const db = getFirestore();
            
            // Firestore'a ekle (coaches koleksiyonu)
            const docRef = await db.collection('coaches').add({
                fullName: name,
                discord: user.id,
                discordTag: user.tag,
                specialty: specialty,
                isActive: true,
                role: 'coach',
                createdAt: new Date(),
                addedBy: interaction.user.tag
            });

            // Ayrıca students koleksiyonuna da (rol: coach) olarak ekleyelim (senkronizasyon için)
            await db.collection('students').add({
                fullName: name,
                discord: user.id,
                role: 'coach',
                isActive: true
            });

            logger.info(`[Admin] Manuel koç eklendi: ${name} (${user.tag})`);
            await interaction.editReply(`✅ **${name}** başarıyla koç olarak kaydedildi!\nID: \`${docRef.id}\``);
        } catch (error) {
            logger.error(`[Admin] Koç ekleme hatası: ${error.message}`);
            await interaction.editReply('❌ Kayıt sırasında bir hata oluştu.');
        }
    }
};
