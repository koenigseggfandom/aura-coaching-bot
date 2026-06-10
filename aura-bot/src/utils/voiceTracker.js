/**
 * Voice Session Tracker v3
 * Düzeltmeler:
 * 1. Koç sesten çıkınca direkt ders kayıt edilir (grace period YOK)
 * 2. Öğrenci 15 dk grace period'u korundu
 * 3. Pasife alma sırasında öğrenci rolü kaldırılır
 * 4. Koça ders başlangıcında ve bitişinde DM gider
 */

const prisma = require('./db');

const activeSessions = new Map();
const gracePeriods = new Map();

const LESSON_LOG_CHANNEL = process.env.LESSON_LOG_CHANNEL_ID;
const GRACE_PERIOD_MS = 15 * 60 * 1000; // öğrenci için 15 dk
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

// Koça DM gönder
async function sendCoachDM(guild, coachDiscordId, embed) {
  try {
    const coachMember = await guild.members.fetch(coachDiscordId).catch(() => null);
    if (coachMember) {
      await coachMember.send({ embeds: [embed] }).catch(() => {});
    }
  } catch (e) {
    console.error(`[VOICE] Koç DM hatası:`, e.message);
  }
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
    console.log(`[VOICE] ${studentMember.user.username} grace period'dan döndü`);
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

  console.log(`[VOICE] Oturum başladı: ${studentMember.user.username} + Koç: ${coachMember.user.username} -> ${channel.name} (${category})`);

  // Koça ders başlangıcı DM'i gönder
  const { EmbedBuilder } = require('discord.js');
  const catColors = { VOD: 0x6366f1, GAMESENSE: 0xec4899, MOVEMENT: 0x22c55e, AIM: 0xf59e0b };
  const startEmbed = new EmbedBuilder()
    .setColor(catColors[category] || 0x6366f1)
    .setTitle(`🎙️ Ders Başladı — ${category}`)
    .addFields(
      { name: 'Öğrenci', value: `<@${studentMember.id}> (${studentMember.user.username})`, inline: true },
      { name: 'Kanal', value: channel.name, inline: true },
      { name: 'Başlangıç', value: new Date().toLocaleString('tr-TR'), inline: false },
    )
    .setTimestamp();
  await sendCoachDM(guild, coachMember.id, startEmbed);
}

async function endSession(guild, studentDiscordId, forceEnd = false) {
  const session = activeSessions.get(studentDiscordId);
  if (!session) return;

  activeSessions.delete(studentDiscordId);

  const endedAt = new Date();
  const durationMins = Math.round((endedAt - session.startedAt) / 60000);

  if (durationMins < MIN_LESSON_MINS && !forceEnd) {
    console.log(`[VOICE] Çok kısa (${durationMins}dk), ders sayılmadı: ${session.studentUsername}`);
    await prisma.voiceSession.updateMany({
      where: { studentId: session.studentId, isActive: true },
      data: { leftAt: endedAt, isActive: false },
    }).catch(console.error);
    return;
  }

  // Kısa da olsa koç çıkınca kaydet (forceEnd=true)
  const effectiveDuration = Math.max(durationMins, forceEnd ? durationMins : MIN_LESSON_MINS);

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
      durationMins: effectiveDuration,
      isAutomatic: true,
    },
  }).catch(console.error);

  // remainingLessons 0 ama paket varsa yükle
  const currentStudent = await prisma.student.findUnique({ where: { id: session.studentId } }).catch(() => null);
  if (currentStudent && currentStudent.remainingLessons <= 0 && currentStudent.totalLessons > 0) {
    await prisma.student.update({
      where: { id: session.studentId },
      data: { remainingLessons: currentStudent.totalLessons },
    }).catch(console.error);
    console.log(`[VOICE] ${session.studentUsername} remainingLessons paketten yüklendi: ${currentStudent.totalLessons}`);
  }

  const updatedStudent = await prisma.student.update({
    where: { id: session.studentId },
    data: { remainingLessons: { decrement: 1 } },
  }).catch(console.error);

  await prisma.voiceSession.updateMany({
    where: { studentId: session.studentId, isActive: true },
    data: { leftAt: endedAt, isActive: false },
  }).catch(console.error);

  // Paket tükendiyse pasife al + rolü kaldır
  const gercekYapilan = await prisma.lesson.count({ where: { studentId: session.studentId } }).catch(() => 0);
  const paketBuyuklugu = currentStudent ? (currentStudent.totalLessons || 0) : 0;
  if (updatedStudent && updatedStudent.remainingLessons <= 0 && gercekYapilan >= paketBuyuklugu && paketBuyuklugu > 0 && updatedStudent.isActive) {
    await prisma.student.update({
      where: { id: session.studentId },
      data: { isActive: false },
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

  console.log(`[VOICE] Ders #${lessonNumber} sayıldı: ${session.studentUsername}, ${effectiveDuration}dk, ${session.category}`);

  const { EmbedBuilder } = require('discord.js');
  const catColors = { VOD: 0x6366f1, GAMESENSE: 0xec4899, MOVEMENT: 0x22c55e, AIM: 0xf59e0b };

  const lessonEmbed = new EmbedBuilder()
    .setColor(catColors[session.category] || 0x6366f1)
    .setTitle(`Ders #${lessonNumber} Tamamlandı`)
    .addFields(
      { name: 'Öğrenci', value: `<@${session.studentDiscordId}>`, inline: true },
      { name: 'Koç', value: `<@${session.coachId}>`, inline: true },
      { name: 'Kategori', value: session.category, inline: true },
      { name: 'Süre', value: `${effectiveDuration} dakika`, inline: true },
      { name: 'Kanal', value: session.channelName, inline: true },
      { name: 'Ders No', value: `#${lessonNumber}`, inline: true },
    )
    .setTimestamp();

  // Log kanalına gönder
  if (LESSON_LOG_CHANNEL && guild) {
    const logChannel = guild.channels.cache.get(LESSON_LOG_CHANNEL);
    if (logChannel) {
      await logChannel.send({ embeds: [lessonEmbed] }).catch(console.error);
    }
  }

  // Koça ders sonu DM'i gönder
  const coachDMEmbed = new EmbedBuilder()
    .setColor(catColors[session.category] || 0x6366f1)
    .setTitle(`✅ Ders #${lessonNumber} Kaydedildi`)
    .setDescription(`Ders başarıyla sisteme kaydedildi.`)
    .addFields(
      { name: 'Öğrenci', value: `<@${session.studentDiscordId}> (${session.studentUsername})`, inline: true },
      { name: 'Kategori', value: session.category, inline: true },
      { name: 'Süre', value: `${effectiveDuration} dakika`, inline: true },
      { name: 'Başlangıç', value: session.startedAt.toLocaleString('tr-TR'), inline: true },
      { name: 'Bitiş', value: endedAt.toLocaleString('tr-TR'), inline: true },
    )
    .setTimestamp();
  await sendCoachDM(guild, session.coachId, coachDMEmbed);
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
      console.log(`[VOICE] ${member.user.username} grace period içinde geri döndü`);
      return;
    }
    await tryStartSession(guild, newChannel);
  }

  // Kanaldan çıktı
  if (wasInCoaching && !isInCoaching) {
    const dbStudent = await memberIsStudent(member);

    if (dbStudent && activeSessions.has(member.id)) {
      // Öğrenci çıktı — 15 dk grace period
      console.log(`[VOICE] Grace period başladı: ${member.user.username}`);
      const session = activeSessions.get(member.id);
      const timeout = setTimeout(async () => {
        gracePeriods.delete(member.id);
        await endSession(guild, member.id, false);
      }, GRACE_PERIOD_MS);
      gracePeriods.set(member.id, { timeout, session });

    } else if (memberIsCoach(member)) {
      // ── Koç çıktı: DIREKT ders kayıt et, grace period YOK ──
      if (oldChannel) {
        for (const [, m] of oldChannel.members) {
          if (activeSessions.has(m.id)) {
            console.log(`[VOICE] Koç çıktı — direkt ders kaydediliyor: ${m.user.username}`);
            // Grace period varsa temizle
            if (gracePeriods.has(m.id)) {
              clearTimeout(gracePeriods.get(m.id).timeout);
              gracePeriods.delete(m.id);
            }
            await endSession(guild, m.id, true); // forceEnd=true → kısa olsa da kaydet
          }
        }
      }
      // Koç başka sese giderse yeni oturum dene
      if (isInCoaching && newChannel) {
        await tryStartSession(guild, newChannel);
      }
    }
  }

  // Farklı coaching kanala geçiş
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
