const { EmbedBuilder } = require('discord.js');

const COLORS = {
  primary: 0x6366f1,
  success: 0x22c55e,
  error: 0xef4444,
  warning: 0xf59e0b,
  pink: 0xec4899,
  info: 0x3b82f6,
};

const CATEGORY_COLORS = {
  VOD: 0x6366f1,
  GAMESENSE: 0xec4899,
  MOVEMENT: 0x22c55e,
  AIM: 0xf59e0b,
};

const CATEGORY_EMOJIS = {
  VOD: '🎬',
  GAMESENSE: '🧠',
  MOVEMENT: '⚡',
  AIM: '🎯',
};

function successEmbed(title, description) {
  return new EmbedBuilder()
    .setColor(COLORS.success)
    .setTitle(`✅ ${title}`)
    .setDescription(description)
    .setTimestamp();
}

function errorEmbed(title, description) {
  return new EmbedBuilder()
    .setColor(COLORS.error)
    .setTitle(`❌ ${title}`)
    .setDescription(description)
    .setTimestamp();
}

function infoEmbed(title, description) {
  return new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle(`ℹ️ ${title}`)
    .setDescription(description)
    .setTimestamp();
}

function auraEmbed(title, description) {
  return new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle(title)
    .setDescription(description)
    .setFooter({ text: 'AURA Coaching | auracoaching.com.tr' })
    .setTimestamp();
}

function studentCard(student, lessons = []) {
  const completedLessons = student.totalLessons - student.remainingLessons;
  const progress = student.totalLessons > 0
    ? Math.round((completedLessons / student.totalLessons) * 100)
    : 0;

  const progressBar = generateProgressBar(progress);

  const embed = new EmbedBuilder()
    .setColor(student.isActive ? COLORS.primary : 0x94a3b8)
    .setTitle(`👤 ${student.name} ${student.surname}`)
    .setDescription(student.isActive ? '🟢 Aktif Öğrenci' : '⚫ Pasif Öğrenci')
    .addFields(
      { name: '🆔 Discord', value: `<@${student.discordId}>`, inline: true },
      { name: '👤 Username', value: student.discordUsername || '-', inline: true },
      { name: '🌍 Ülke', value: student.country || '-', inline: true },
      { name: '🎯 Mevcut Rank', value: student.rank || '-', inline: true },
      { name: '🏆 Hedef Rank', value: student.targetRank || '-', inline: true },
      { name: '📦 Paket', value: student.packageType || '-', inline: true },
      { name: '📚 Toplam Ders', value: `${student.totalLessons}`, inline: true },
      { name: '✅ Tamamlanan', value: `${completedLessons}`, inline: true },
      { name: '📋 Kalan', value: `${student.remainingLessons}`, inline: true },
      { name: `📊 İlerleme (${progress}%)`, value: progressBar, inline: false },
    )
    .setTimestamp();

  if (student.trackerLink) {
    embed.addFields({ name: '🔗 Tracker', value: `[Profil](${student.trackerLink})`, inline: true });
  }

  if (lessons.length > 0) {
    const lastLesson = lessons[0];
    embed.addFields({
      name: '⏰ Son Ders',
      value: `${CATEGORY_EMOJIS[lastLesson.category] || '📚'} ${lastLesson.category} — ${new Date(lastLesson.createdAt).toLocaleDateString('tr-TR')}`,
      inline: false,
    });
  }

  return embed;
}

function generateProgressBar(percent, length = 15) {
  const filled = Math.round((percent / 100) * length);
  const empty = length - filled;
  const color = percent <= 20 ? '🔴' : percent <= 50 ? '🟡' : '🟢';
  return `${'█'.repeat(filled)}${'░'.repeat(empty)} ${percent}% ${color}`;
}

module.exports = {
  COLORS,
  CATEGORY_COLORS,
  CATEGORY_EMOJIS,
  successEmbed,
  errorEmbed,
  infoEmbed,
  auraEmbed,
  studentCard,
  generateProgressBar,
};
