/**
 * Voice Session Tracker v2
 * - Oturum hem ogrenci hem koc girince baslar
 * - Koc kanala girdiginde zaten icerde ogrenci varsa oturum baslatilir
 * - Ogrenci girdiginde zaten icerde koc varsa oturum baslatilir
 * - 15 dakika grace period
 * - Min 5 dakika ders sayilir
 */

const prisma = require('./db');

const activeSessions = new Map();
const gracePeriods = new Map();

const LESSON_LOG_CHANNEL = process.env.LESSON_LOG_CHANNEL_ID;
const GRACE_PERIOD_MS = 15 * 60 * 1000;
const MIN_LESSON_MINS = 5;

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

function memberIsCoach(member) {
  const coachRoleId = process.env.COACH_ROLE_ID;
  if (!coachRoleId) return false;
  return member.roles.cache.has(coachRoleId);
}

async function memberIsStudent(member) {
  try {
    return await prisma.student.findUnique({ where: { discordId: member.id } });
  } catch { return null; }
}

async function tryStartSession(guild, channel) {
  const members = [...channel.members.values()].filter(m => !m.user.bot);

  let coachMember = null;
  let studentMember = null;
  let dbStudent = null;

  for (const member of members) {
    if (memberIsCoach(member)) {
      coachMember = member;
    } else {
      const db = await memberIsStudent(member);
      if (db) { studentMember = member; dbStudent = db; }
    }
  }

  if (!coachMember || !studentMember || !dbStudent) return;
  if (activeSessions.has(studentMember.id)) return;

  if (gracePeriods.has(studentMember.id)) {
    const gp = gracePeriods.get(studentMember.id);
    clearTimeout(gp.timeout);
    gracePeriods.delete(studentMember.id);
    activeSessions.set(studentMember.id, gp.session);
    console.log(`[VOICE] ${studentMember.user.username} grace period'dan dondu`);
    return;
  }

  const category = detectCategory(channel.name);
  if (!category) return;

  const session = {
    studentId: dbStudent.id,
    studentDiscordId: studentMember.id,
    studentUsername: studentMember.user.username,
    coachId: coachMember.id,
    coachUsername: coachMember.user.username,
    channelId: channel.id,
    channelName: channel.name,
    category,
    startedAt: new Date(),
  };

  activeSessions.set(studentMember.id, session);

  await prisma.voiceSession.create({
    data: {
      studentId: dbStudent.id,
      coachId: coachMember.id,
      channelId: channel.id,
      channelName: channel.name,
      category,
      isActive: true,
    },
  }).catch(console.error);

  console.log(`[VOICE] Oturum basladi: ${studentMember.user.username} + Koc: ${coachMember.user.username} -> ${channel.name} (${category})`);
}

async function endSession(guild, studentDiscordId) {
  const session = activeSessions.get(studentDiscordId);
  if (!session) return;

  activeSessions.delete(studentDiscordId);

  const endedAt = new Date();
  const durationMins = Math.round((endedAt - session.startedAt) / 60000);

  if (durationMins < MIN_LESSON_MINS) {
    console.log(`[VOICE] Cok kisa (${durationMins}dk), ders sayilmadi: ${session.studentUsername}`);
    await prisma.voiceSession.updateMany({
      where: { studentId: session.studentId, isActive: true },
      data: { leftAt: endedAt, isActive: false },
    }).catch(console.error);
    return;
  }

  const lessonCount = await prisma.lesson.count({ where: { studentId: session.studentId } });
  const lessonNumber = lessonCount + 1;

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

  const updatedStudent = await prisma.student.update({
    where: { id: session.studentId },
    data: {
      // totalLessons = paket büyüklüğü, SABIT — değiştirme
      remainingLessons: { decrement: 1 },
    },
  }).catch(console.error);

  await prisma.voiceSession.updateMany({
    where: { studentId: session.studentId, isActive: true },
    data: { leftAt: endedAt, isActive: false },
  }).catch(console.error);

  // Kalan ders bitti veya sıfırın altına düştü — otomatik pasife al
  if (updatedStudent && updatedStudent.remainingLessons <= 0 && updatedStudent.isActive) {
    await prisma.student.update({
      where: { id: session.studentId },
      data:  { isActive: false },
    }).catch(console.error);

    console.log(`[VOICE] Kalan ders tükendi — ${session.studentUsername} otomatik pasife alındı`);

    // Discord öğrenci rolünü kaldır
    const studentRoleId = process.env.STUDENT_ROLE_ID;
    if (studentRoleId && guild) {
      try {
        const member = await guild.members.fetch(session.studentDiscordId).catch(() => null);
        if (member && member.roles.cache.has(studentRoleId)) {
          await member.roles.remove(studentRoleId, 'Kalan ders tükendi — otomatik pasife alındı');
          console.log(`[VOICE] ${session.studentUsername} öğrenci rolü kaldırıldı`);
        }
      } catch (e) {
        console.error(`[VOICE] Rol kaldırma hatası (${session.studentUsername}):`, e.message);
      }
    }
  }

  console.log(`[VOICE] Ders #${lessonNumber} sayildi: ${session.studentUsername}, ${durationMins}dk, ${session.category}`);

  if (LESSON_LOG_CHANNEL && guild) {
    const logChannel = guild.channels.cache.get(LESSON_LOG_CHANNEL);
    if (logChannel) {
      const { EmbedBuilder } = require('discord.js');
      const catColors = { VOD: 0x6366f1, GAMESENSE: 0xec4899, MOVEMENT: 0x22c55e, AIM: 0xf59e0b };
      const embed = new EmbedBuilder()
        .setColor(catColors[session.category] || 0x6366f1)
        .setTitle(`Ders #${lessonNumber} Tamamlandi`)
        .addFields(
          { name: 'Ogrenci', value: `<@${session.studentDiscordId}>`, inline: true },
          { name: 'Koc', value: `<@${session.coachId}>`, inline: true },
          { name: 'Kategori', value: session.category, inline: true },
          { name: 'Sure', value: `${durationMins} dakika`, inline: true },
          { name: 'Kanal', value: session.channelName, inline: true },
          { name: 'Ders No', value: `#${lessonNumber}`, inline: true },
        )
        .setTimestamp();
      await logChannel.send({ embeds: [embed] }).catch(console.error);
    }
  }
}

async function handleVoiceUpdate(oldState, newState, client) {
  const member = newState.member || oldState.member;
  if (!member || member.user.bot) return;

  const guild = newState.guild || oldState.guild;
  const oldChannel = oldState.channel;
  const newChannel = newState.channel;

  const wasInCoaching = oldChannel && isCoachingChannel(oldChannel.name);
  const isInCoaching = newChannel && isCoachingChannel(newChannel.name);

  // Kanala girdi
  if (isInCoaching && !wasInCoaching) {
    if (gracePeriods.has(member.id)) {
      const gp = gracePeriods.get(member.id);
      clearTimeout(gp.timeout);
      gracePeriods.delete(member.id);
      activeSessions.set(member.id, gp.session);
      console.log(`[VOICE] ${member.user.username} grace period icinde geri dondu`);
      return;
    }
    await tryStartSession(guild, newChannel);
  }

  // Kanaldan cikti
  if (wasInCoaching && !isInCoaching) {
    const dbStudent = await memberIsStudent(member);

    if (dbStudent && activeSessions.has(member.id)) {
      // Ogrenci cikti — grace period
      console.log(`[VOICE] Grace period basladi: ${member.user.username}`);
      const session = activeSessions.get(member.id);
      const timeout = setTimeout(async () => {
        gracePeriods.delete(member.id);
        await endSession(guild, member.id);
      }, GRACE_PERIOD_MS);
      gracePeriods.set(member.id, { timeout, session });
    } else if (memberIsCoach(member)) {
      // Koc cikti — kanalda ogrenci varsa oturumu bitir
      if (oldChannel) {
        for (const [, m] of oldChannel.members) {
          if (activeSessions.has(m.id)) {
            console.log(`[VOICE] Koc cikti, oturum bitiyor: ${m.user.username}`);
            await endSession(guild, m.id);
          }
        }
      }
    }
  }

  // Farkli coaching kanala gecis
  if (wasInCoaching && isInCoaching && oldChannel.id !== newChannel.id) {
    if (activeSessions.has(member.id)) {
      const session = activeSessions.get(member.id);
      session.channelId = newChannel.id;
      session.channelName = newChannel.name;
      session.category = detectCategory(newChannel.name) || session.category;
    }
    await tryStartSession(guild, newChannel);
  }
}

module.exports = { handleVoiceUpdate };
