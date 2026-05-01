/**
 * Voice Session Tracker
 * Tracks students in voice channels and counts lessons automatically.
 * Channel categories: VOD, GAMESENSE, MOVEMENT, AIM
 * Each category has 3 channels (e.g. "VOD 1", "VOD 2", "VOD 3")
 * 
 * 15-minute grace period: if student drops and rejoins within 15 min,
 * the session continues. Otherwise, +1 new lesson.
 */

const prisma = require('./db');

// Map to track active voice sessions: studentDiscordId -> session info
const activeSessions = new Map();
// Map to track grace period timeouts: studentDiscordId -> timeout
const gracePeriods = new Map();

const LESSON_LOG_CHANNEL = process.env.LESSON_LOG_CHANNEL_ID;
const GRACE_PERIOD_MS = 15 * 60 * 1000; // 15 minutes

// Channel category detection
const CHANNEL_CATEGORIES = ['VOD', 'GAMESENSE', 'MOVEMENT', 'AIM'];

function detectCategory(channelName) {
  if (!channelName) return null;
  const upper = channelName.toUpperCase();
  for (const cat of CHANNEL_CATEGORIES) {
    if (upper.includes(cat)) return cat;
  }
  return null;
}

function isCoachingChannel(channelName) {
  return detectCategory(channelName) !== null;
}

async function getStudentAndCoach(guild, channel) {
  const members = [...channel.members.values()];
  const coachRoleId = process.env.COACH_ROLE_ID;

  let coach = null;
  let student = null;

  for (const member of members) {
    const isCoach = coachRoleId
      ? member.roles.cache.has(coachRoleId)
      : false;
    if (isCoach) {
      coach = member;
    } else {
      // Check if this member is a registered student
      const dbStudent = await prisma.student.findUnique({
        where: { discordId: member.id },
      }).catch(() => null);
      if (dbStudent) {
        student = { member, dbStudent };
      }
    }
  }

  return { coach, student };
}

async function startSession(client, guild, member, channel) {
  const category = detectCategory(channel.name);
  if (!category) return;

  const dbStudent = await prisma.student.findUnique({
    where: { discordId: member.id },
  }).catch(() => null);

  if (!dbStudent) return;

  // Check for coach in channel
  const coachRoleId = process.env.COACH_ROLE_ID;
  let coachMember = null;
  for (const [, m] of channel.members) {
    if (m.id !== member.id && coachRoleId && m.roles.cache.has(coachRoleId)) {
      coachMember = m;
      break;
    }
  }

  const session = {
    studentId: dbStudent.id,
    studentDiscordId: member.id,
    coachId: coachMember?.id || 'unknown',
    coachUsername: coachMember?.user.username || 'unknown',
    channelId: channel.id,
    channelName: channel.name,
    category,
    startedAt: new Date(),
  };

  activeSessions.set(member.id, session);

  // Create voice_session record
  await prisma.voiceSession.create({
    data: {
      studentId: dbStudent.id,
      coachId: coachMember?.id || 'unknown',
      channelId: channel.id,
      channelName: channel.name,
      category,
      isActive: true,
    },
  }).catch(console.error);

  console.log(`[VOICE] Session started: ${member.user.username} in ${channel.name} (${category})`);
}

async function endSession(client, guild, member, wasGrace = false) {
  const session = activeSessions.get(member.id);
  if (!session) return;

  activeSessions.delete(member.id);

  const endedAt = new Date();
  const durationMins = Math.round((endedAt - session.startedAt) / 60000);

  // Only count as lesson if at least 5 minutes
  if (durationMins < 5) {
    console.log(`[VOICE] Session too short (${durationMins}m), not counting: ${member.user.username}`);
    return;
  }

  // Get current lesson count for this student
  const lessonCount = await prisma.lesson.count({ where: { studentId: session.studentId } });
  const lessonNumber = lessonCount + 1;

  // Create lesson
  await prisma.lesson.create({
    data: {
      lessonNumber,
      studentId: session.studentId,
      coachId: session.coachId,
      coachUsername: session.coachUsername,
      category: session.category,
      channelName: session.channelName,
      startedAt: session.startedAt,
      endedAt,
      durationMins,
      isAutomatic: true,
    },
  }).catch(console.error);

  // Update student totals
  await prisma.student.update({
    where: { id: session.studentId },
    data: {
      totalLessons: { increment: 1 },
      remainingLessons: { decrement: 1 },
    },
  }).catch(console.error);

  // Update voice_session record
  await prisma.voiceSession.updateMany({
    where: {
      studentId: session.studentId,
      channelId: session.channelId,
      isActive: true,
    },
    data: {
      leftAt: endedAt,
      isActive: false,
    },
  }).catch(console.error);

  // Log to channel
  if (LESSON_LOG_CHANNEL) {
    const logChannel = guild.channels.cache.get(LESSON_LOG_CHANNEL);
    if (logChannel) {
      const { EmbedBuilder } = require('discord.js');
      const categoryColors = {
        VOD: 0x6366f1,
        GAMESENSE: 0xec4899,
        MOVEMENT: 0x22c55e,
        AIM: 0xf59e0b,
      };
      const embed = new EmbedBuilder()
        .setColor(categoryColors[session.category] || 0x6366f1)
        .setTitle(`📚 Ders #${lessonNumber} Tamamlandı`)
        .addFields(
          { name: '👤 Öğrenci', value: `<@${session.studentDiscordId}>`, inline: true },
          { name: '🎓 Koç', value: session.coachId !== 'unknown' ? `<@${session.coachId}>` : 'Bilinmiyor', inline: true },
          { name: '📂 Kategori', value: session.category, inline: true },
          { name: '⏱️ Süre', value: `${durationMins} dakika`, inline: true },
          { name: '🔊 Kanal', value: session.channelName, inline: true },
          { name: '🔢 Ders No', value: `#${lessonNumber}`, inline: true },
        )
        .setTimestamp();
      await logChannel.send({ embeds: [embed] }).catch(console.error);
    }
  }

  console.log(`[VOICE] Lesson #${lessonNumber} counted: ${member.user.username}, ${durationMins}m, ${session.category}`);
}

async function handleVoiceUpdate(oldState, newState, client) {
  const member = newState.member || oldState.member;
  if (!member || member.user.bot) return;

  const guild = newState.guild || oldState.guild;
  const oldChannel = oldState.channel;
  const newChannel = newState.channel;

  const wasInCoachingChannel = oldChannel && isCoachingChannel(oldChannel.name);
  const isInCoachingChannel = newChannel && isCoachingChannel(newChannel.name);

  // Left a coaching channel
  if (wasInCoachingChannel && !isInCoachingChannel) {
    if (activeSessions.has(member.id)) {
      // Start grace period
      console.log(`[VOICE] Grace period started for ${member.user.username}`);
      const timeout = setTimeout(async () => {
        gracePeriods.delete(member.id);
        await endSession(client, guild, member, false);
      }, GRACE_PERIOD_MS);

      gracePeriods.set(member.id, {
        timeout,
        session: activeSessions.get(member.id),
      });
    }
  }

  // Joined a coaching channel
  if (isInCoachingChannel && !wasInCoachingChannel) {
    // Cancel grace period if returning
    if (gracePeriods.has(member.id)) {
      const gp = gracePeriods.get(member.id);
      clearTimeout(gp.timeout);
      gracePeriods.delete(member.id);
      console.log(`[VOICE] ${member.user.username} returned within grace period, session continuing`);
      // Restore active session (keeps original startedAt)
      activeSessions.set(member.id, gp.session);
    } else {
      // New session
      await startSession(client, guild, member, newChannel);
    }
  }

  // Switched between coaching channels (e.g. VOD 1 → VOD 2)
  if (wasInCoachingChannel && isInCoachingChannel && oldChannel.id !== newChannel.id) {
    // Update channel info in active session
    if (activeSessions.has(member.id)) {
      const session = activeSessions.get(member.id);
      session.channelId = newChannel.id;
      session.channelName = newChannel.name;
      session.category = detectCategory(newChannel.name) || session.category;
      activeSessions.set(member.id, session);
    }
  }
}

module.exports = { handleVoiceUpdate };
