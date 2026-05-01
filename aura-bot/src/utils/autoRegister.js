/**
 * Auto Register Loop
 * Polls the AutoRegisterQueue table every 60 seconds.
 * When a new entry arrives (added by admin panel when a coach adds a student),
 * it searches the Discord server for a matching member by username/displayname
 * and registers them automatically.
 */

const prisma = require('./db');

const STUDENT_ROLE_ID = process.env.STUDENT_ROLE_ID;
const REGISTER_LOG_CHANNEL = process.env.REGISTER_LOG_CHANNEL_ID;

async function processQueue(client) {
  const pending = await prisma.autoRegisterQueue.findMany({
    where: { processed: false },
    orderBy: { createdAt: 'asc' },
  });

  if (!pending.length) return;

  const guild = await client.guilds.fetch(process.env.GUILD_ID);
  await guild.members.fetch(); // Cache all members

  for (const entry of pending) {
    try {
      let matched = null;

      // Try matching by stored discordId first
      if (entry.discordId) {
        try {
          matched = await guild.members.fetch(entry.discordId);
        } catch {}
      }

      // Try matching by discordTag (username#0000 or just username)
      if (!matched && entry.discordTag) {
        const tag = entry.discordTag.toLowerCase().trim();
        matched = guild.members.cache.find(m => {
          const username = m.user.username.toLowerCase();
          const displayName = m.displayName.toLowerCase();
          const globalName = (m.user.globalName || '').toLowerCase();
          return (
            username === tag ||
            `${username}#${m.user.discriminator}` === tag ||
            displayName === tag ||
            globalName === tag
          );
        });
      }

      // Try fuzzy match by first+last name in display name
      if (!matched) {
        const fullName = `${entry.name} ${entry.surname}`.toLowerCase();
        matched = guild.members.cache.find(m => {
          const dn = m.displayName.toLowerCase();
          return (
            dn.includes(entry.name.toLowerCase()) ||
            dn.includes(entry.surname.toLowerCase()) ||
            dn.includes(fullName)
          );
        });
      }

      if (!matched) {
        console.log(`[AUTO-REG] No Discord match for: ${entry.name} ${entry.surname}`);
        // Mark with discordId = null — leave for manual handling
        // Don't mark as processed so it retries next loop
        continue;
      }

      // Check if already registered
      const existing = await prisma.student.findUnique({
        where: { discordId: matched.id },
      });

      if (!existing) {
        // Create student
        await prisma.student.create({
          data: {
            discordId: matched.id,
            discordUsername: matched.user.username,
            name: entry.name,
            surname: entry.surname,
            rank: entry.rank || null,
            targetRank: entry.targetRank || null,
            packageType: entry.packageType || null,
            isActive: true,
            totalLessons: 0,
            remainingLessons: 0,
          },
        });

        // Give role
        if (STUDENT_ROLE_ID) {
          await matched.roles.add(STUDENT_ROLE_ID).catch(console.error);
        }

        // Log
        if (REGISTER_LOG_CHANNEL) {
          const logChannel = guild.channels.cache.get(REGISTER_LOG_CHANNEL);
          if (logChannel) {
            const { EmbedBuilder } = require('discord.js');
            const embed = new EmbedBuilder()
              .setColor(0x22c55e)
              .setTitle('✅ Otomatik Kayıt Tamamlandı')
              .addFields(
                { name: 'Öğrenci', value: `${entry.name} ${entry.surname}`, inline: true },
                { name: 'Discord', value: `<@${matched.id}>`, inline: true },
                { name: 'Username', value: matched.user.username, inline: true },
                { name: 'Paket', value: entry.packageType || '-', inline: true },
                { name: 'Rank', value: entry.rank || '-', inline: true },
                { name: 'Hedef Rank', value: entry.targetRank || '-', inline: true },
              )
              .setThumbnail(matched.user.displayAvatarURL())
              .setTimestamp();
            await logChannel.send({ embeds: [embed] }).catch(console.error);
          }
        }

        // Send DM to student
        try {
          const { EmbedBuilder } = require('discord.js');
          const dmEmbed = new EmbedBuilder()
            .setColor(0x6366f1)
            .setTitle('🎮 AURA Coaching\'e Hoş Geldin!')
            .setDescription(
              `Merhaba **${entry.name}**! AURA Coaching Discord sunucusuna otomatik olarak kaydoldun.\n\n` +
              `📦 Paket: **${entry.packageType || '-'}**\n` +
              `🎯 Mevcut Rank: **${entry.rank || '-'}**\n` +
              `🏆 Hedef Rank: **${entry.targetRank || '-'}**\n\n` +
              `Koçun yakında seninle iletişime geçecek. Hazır ol! 🔥`
            )
            .setFooter({ text: 'AURA Coaching | auracoaching.com.tr' })
            .setTimestamp();
          await matched.send({ embeds: [dmEmbed] }).catch(() => {}); // DM kapalı olabilir
        } catch {}

        console.log(`[AUTO-REG] Registered: ${entry.name} ${entry.surname} → ${matched.user.username}`);
      } else {
        console.log(`[AUTO-REG] Already registered: ${matched.user.username}`);
      }

      // Mark as processed
      await prisma.autoRegisterQueue.update({
        where: { id: entry.id },
        data: { processed: true, processedAt: new Date(), discordId: matched.id },
      });
    } catch (err) {
      console.error(`[AUTO-REG] Error processing entry ${entry.id}:`, err.message);
    }
  }
}

function startAutoRegisterLoop(client) {
  console.log('[AUTO-REG] Loop started (60s interval)');
  setInterval(() => processQueue(client).catch(console.error), 60_000);
  processQueue(client).catch(console.error); // Run immediately on start
}

module.exports = { startAutoRegisterLoop };
