/**
 * Sunucudaki log kanalını bulur
 * @param {import('discord.js').Guild} guild 
 * @returns {import('discord.js').TextChannel|null}
 */
export function getLogChannel(guild) {
    if (!guild) return null;

    // 1. Çevresel değişkenden ID ile ara
    const logChannelId = process.env.LOGS_CHANNEL_ID?.trim();
    if (logChannelId) {
        const channel = guild.channels.cache.get(logChannelId);
        if (channel && channel.isTextBased()) return channel;
    }

    // 2. İsim ile ara (log, kayit, ders-takip, ders-log vb.)
    return guild.channels.cache.find(c => 
        c.isTextBased() && 
        (c.name.toLowerCase().includes('log') || 
         c.name.toLowerCase().includes('kayit') || 
         c.name.toLowerCase().includes('ders-takip') ||
         c.name.toLowerCase().includes('ders-log'))
    ) || null;
}
