import { Events, EmbedBuilder } from 'discord.js';
import { logger } from '../utils/logger.js';
import { getFirestore } from '../database/connection.js';
import { getLogChannel } from '../utils/channelUtils.js';
import { getClassByChannelId } from '../utils/classSessionUtils.js';

const activeLessons = new Map();
const GRACE_PERIOD = 15 * 60 * 1000;
const COUNTER_INTERVAL = 30 * 1000;

function getLessonType(channel) {
    if (!channel) return null;
    const channelName = (channel.name || '').toLowerCase().trim();
    const categoryName = (channel.parent?.name || '').toLowerCase().trim();
    const combined = categoryName + ' ' + channelName;

    if (combined.includes('aim')) return 'Aim Dersi';
    if (combined.includes('movement')) return 'Movement Dersi';
    if (combined.includes('gamesense') || combined.includes('game sense')) return 'GameSense Dersi';
    if (combined.includes('vod')) return 'VOD Analizi';
    if (combined.includes('ders') || combined.includes('koç') || combined.includes('koc') || combined.includes('coach') || combined.includes('seans')) return 'Özel Ders';

    return null;
}

function findActiveSessionForMember(memberId) {
    for (const [channelId, session] of activeLessons.entries()) {
        if (session.coachId === memberId || session.studentId === memberId) {
            return session;
        }
    }
    return null;
}

function isCoach(member) {
    if (!member) return false;
    const coachRoleId = process.env.COACH_ROLE_ID;
    if (coachRoleId && member.roles.cache.has(coachRoleId)) return true;
    return member.roles.cache.some(role => {
        const name = role.name.toLowerCase();
        return name.includes('koc') || name.includes('koç') || name.includes('coach');
    });
}

function isStudent(member) {
    if (!member) return false;
    const studentRoleId = process.env.STUDENT_ROLE_ID;
    if (studentRoleId && member.roles.cache.has(studentRoleId)) return true;
    return member.roles.cache.some(role => {
        const name = role.name.toLowerCase();
        return name.includes('ogrenci') || name.includes('öğrenci') || name.includes('student');
    });
}

function formatRemainingTime(ms) {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return minutes + ' dk ' + seconds.toString().padStart(2, '0') + ' sn';
}

function clearGraceTimers(session) {
    if (session.graceTimeout) {
        clearTimeout(session.graceTimeout);
        session.graceTimeout = null;
    }
    if (session.graceInterval) {
        clearInterval(session.graceInterval);
        session.graceInterval = null;
    }
}

async function endLesson(session, reason, guild, deductPackage = true) {
    clearGraceTimers(session);

    activeLessons.delete(session.channelId);

    let startTimeMs = typeof session.startTime === 'number' ? session.startTime : new Date(session.startTime).getTime();
    if (isNaN(startTimeMs) || startTimeMs <= 0 || startTimeMs > Date.now()) {
        startTimeMs = Date.now();
    }

    const duration = Math.max(0, Date.now() - startTimeMs);
    const minutes = Math.max(1, Math.floor(duration / 60000));
    const durationText = minutes + ' dakika';
    const startDate = new Date(startTimeMs);
    const timeStr = startDate.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });

    let remainingLessons = 'Bilinmiyor';
    let totalLessons = 0;
    let studentFullName = session.studentName || session.studentTag;
    const coachDisplayName = session.coachName || session.coachTag;

    try {
        const db = getFirestore();
        
        await db.collection('lesson_history').add({
            coachId: session.coachId,
            coachName: coachDisplayName,
            coachTag: session.coachTag,
            studentId: session.studentId,
            studentName: session.studentName || session.studentTag,
            studentTag: session.studentTag,
            lessonType: session.lessonType,
            channelName: session.channelName || '',
            startTime: startTimeMs,
            endTime: Date.now(),
            duration: duration,
            minutes: minutes,
            durationText: durationText,
            reason: reason,
            packageDeducted: deductPackage,
            createdAt: new Date()
        });

        let studentSnap = await db.collection('students')
            .where('discordId', '==', String(session.studentId))
            .limit(1)
            .get();

        if (studentSnap.empty) {
            studentSnap = await db.collection('students')
                .where('discord', 'in', [session.studentId, session.studentTag, session.studentName])
                .limit(1)
                .get();
        }

        if (studentSnap.empty) {
            studentSnap = await db.collection('students')
                .where('discordUsername', 'in', [session.studentId, session.studentTag, session.studentName])
                .limit(1)
                .get();
        }
        
        if (!studentSnap.empty) {
            const studentDocRef = studentSnap.docs[0].ref;
            const initialData = studentSnap.docs[0].data();
            totalLessons = Number(initialData.totalLessons || 0);
            studentFullName = initialData.fullName || session.studentName || session.studentTag;

            if (deductPackage) {
                const newHistoryItem = {
                    date: startDate.toISOString(),
                    time: timeStr,
                    category: session.lessonType,
                    type: session.lessonType,
                    coach: coachDisplayName,
                    coachName: coachDisplayName,
                    coachTag: session.coachTag,
                    duration: minutes,
                    reason: reason,
                    packageDeducted: true
                };

                try {
                    const txResult = await db.runTransaction(async (tx) => {
                        const latestDoc = await tx.get(studentDocRef);
                        if (!latestDoc.exists) return null;

                        const data = latestDoc.data();
                        const curTotal = Number(data.totalLessons || totalLessons);
                        const curUsed = Number(data.usedLessons || 0);
                        const curHistory = Array.isArray(data.lessonHistory) ? [...data.lessonHistory] : [];

                        const newUsed = curUsed + 1;
                        const newRemaining = Math.max(0, curTotal - newUsed);
                        const curStudentName = data.fullName || studentFullName;

                        curHistory.push(newHistoryItem);

                        tx.update(studentDocRef, {
                            usedLessons: newUsed,
                            remainingLessons: newRemaining,
                            lessonHistory: curHistory,
                            lastLessonDate: new Date(),
                            updatedAt: new Date().toISOString()
                        });

                        return { newRemaining, newUsed, curTotal, curStudentName };
                    });

                    if (txResult) {
                        remainingLessons = txResult.newRemaining;
                        totalLessons = txResult.curTotal;
                        studentFullName = txResult.curStudentName;
                    }
                } catch (txErr) {
                    logger.error('[Lesson] Transaction hatasi (fallback ile devam ediliyor): ' + txErr.message);
                    const curUsed = Number(initialData.usedLessons || 0);
                    const curTotal = Number(initialData.totalLessons || 0);
                    const newUsed = curUsed + 1;
                    const newRemaining = Math.max(0, curTotal - newUsed);
                    const curHistory = Array.isArray(initialData.lessonHistory) ? [...initialData.lessonHistory] : [];
                    curHistory.push(newHistoryItem);

                    await studentDocRef.update({
                        usedLessons: newUsed,
                        remainingLessons: newRemaining,
                        lessonHistory: curHistory,
                        lastLessonDate: new Date(),
                        updatedAt: new Date().toISOString()
                    });
                    remainingLessons = newRemaining;
                }
            } else {
                remainingLessons = Math.max(0, totalLessons - Number(initialData.usedLessons || 0));
            }
        }

        logger.info(
            '[Lesson] Ders bitti: Kanal #' + (session.channelName || '') + ' | ' + coachDisplayName + ' (KOC) - ' + studentFullName + ' (OGRENCI)' +
            ' | Tur: ' + session.lessonType +
            ' | Sure: ' + durationText +
            ' | Sebep: ' + reason +
            ' | Paket dusuldu: ' + deductPackage +
            ' | Kalan ders: ' + remainingLessons + ' / ' + totalLessons
        );

        const embed = new EmbedBuilder()
            .setColor(deductPackage ? '#10B981' : '#EF4444')
            .setTitle('✅ Ders Tamamlandı')
            .addFields([
                { name: '👨‍🏫 Koç', value: coachDisplayName, inline: true },
                { name: '🎓 Öğrenci', value: studentFullName, inline: true },
                { name: '📚 Ders Türü', value: session.lessonType, inline: true },
                { name: '🔊 Kanal', value: `#${session.channelName || 'Bilinmeyen'}`, inline: true },
                { name: '⏱️ Toplam Süre', value: durationText, inline: true },
                { name: '🕐 Başlangıç Saati', value: timeStr, inline: true },
                { name: '📦 Paket Durumu', value: deductPackage ? `✅ Düşüldü (Kalan: ${remainingLessons}/${totalLessons})` : '⚠️ Paket düşülmedi', inline: false },
                { name: '📝 Sebep', value: reason || 'Kanal boşaldı', inline: false }
            ])
            .setTimestamp();

        const logChannel = getLogChannel(guild);
        if (logChannel) {
            try { await logChannel.send({ embeds: [embed] }); } catch (e) { logger.error('Log kanalı gönderme hatası:', e); }
        }
    } catch (error) {
        logger.error('[Lesson] Ders kaydetme hatasi: ' + error.message + (error.stack ? '\n' + error.stack : ''));
    }
}

async function startLesson(channel, coach, student, lessonType) {
    const coachName = coach.displayName || coach.user.globalName || coach.user.username;
    const studentName = student.displayName || student.user.globalName || student.user.username;

    const session = {
        channelId: channel.id,
        channelName: channel.name,
        coachId: coach.id,
        coachName: coachName,
        coachTag: coach.user.tag,
        studentId: student.id,
        studentName: studentName,
        studentTag: student.user.tag,
        lessonType: lessonType,
        startTime: Date.now(),
        lastActive: Date.now()
    };

    activeLessons.set(channel.id, session);

    logger.info(
        '[Lesson] Ders basladi: Kanal #' + channel.name + ' | ' + coachName + ' (KOC) - ' +
        studentName + ' (OGRENCI) | Tur: ' + lessonType
    );

    const embed = new EmbedBuilder()
        .setColor('#10B981')
        .setTitle('🎓 Ders Başladı')
        .addFields([
            { name: '👨‍🏫 Koç', value: `${coachName} (<@${coach.id}>)`, inline: true },
            { name: '🎓 Öğrenci', value: `${studentName} (<@${student.id}>)`, inline: true },
            { name: '📚 Ders Türü', value: lessonType, inline: true },
            { name: '🔊 Kanal', value: `#${channel.name}`, inline: true },
            { name: '🕐 Başlangıç', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: false }
        ])
        .setTimestamp();

    const logChannel = getLogChannel(channel.guild);
    if (logChannel) {
        try { await logChannel.send({ embeds: [embed] }); } catch (e) { logger.error('Log kanalı gönderme hatası:', e); }
    }

    return session;
}

function notifyLeftLog(remainingTag, leftTag, session, leaverRole, guild) {
    const endTime = Date.now() + GRACE_PERIOD;
    session.graceEndTime = endTime;
    session.graceLeaverName = leftTag;
    session.graceLeaverRole = leaverRole;

    const roleText = leaverRole === 'coach' ? 'KOÇ' : 'ÖĞRENCİ';
    logger.info(
        '[Grace] Ayrilma bildirimi: ' + leftTag + ' (' + roleText + ') kanaldan ayrildi. ' +
        'Kalan: ' + remainingTag + ' | Ders: ' + session.lessonType + ' | Kanal: #' + (session.channelName || '') +
        ' | 15 dakika icinde donmezse sonuclanacak.'
    );

    const logChannel = getLogChannel(guild);
    if (logChannel) {
        const waitEmbed = new EmbedBuilder()
            .setColor('#F59E0B')
            .setTitle('⏳ Ders Askıya Alındı')
            .setDescription(`${roleText} (${leftTag}) #${session.channelName} kanalından ayrıldı. 15 dakika içinde dönmezse ders sonlandırılacak.`)
            .setTimestamp();
        logChannel.send({ embeds: [waitEmbed] }).catch(e => logger.error('Log kanalı gönderme hatası:', e));
    }
}

export default {
    name: Events.VoiceStateUpdate,
    async execute(oldState, newState) {
        const member = newState.member ?? oldState.member;
        const guild = newState.guild ?? oldState.guild;
        if (!member || !guild || member.user.bot) return;

        const oldChannel = oldState.channel;
        const newChannel = newState.channel;

        // Sınıf ses kanalları classVoiceTracker.js tarafından yönetilir.
        if (getClassByChannelId(oldChannel?.id) || getClassByChannelId(newChannel?.id)) return;

        if (oldChannel && (!newChannel || oldChannel.id !== newChannel.id)) {
            const session = activeLessons.get(oldChannel.id);
            if (session) {
                const members = oldChannel.members.filter(m => !m.user.bot);

                const isLeaverCoach = member.id === session.coachId;
                const isLeaverStudent = member.id === session.studentId;
                const leaverRole = isLeaverCoach ? 'coach' : isLeaverStudent ? 'student' : null;
                
                if (members.size === 0) {
                    const deduct = isLeaverStudent || !session.lastLeaverWasCoach;
                    const endReason = deduct
                        ? 'Ogrenci kanaldan ayrildi - odada kimse kalmadi (paket dusuldu)'
                        : 'Odada kimse kalmadi (koc son ayrildi, paket dusulmedi)';
                    await endLesson(session, endReason, guild, deduct);
                } 
                else if (isLeaverCoach || isLeaverStudent) {
                    session.lastActive = Date.now();
                    session.lastLeaverWasCoach = isLeaverCoach;
                    
                    clearGraceTimers(session);

                    const remainingTag = isLeaverCoach ? session.studentName || session.studentTag : session.coachName || session.coachTag;
                    notifyLeftLog(remainingTag, member.displayName || member.user.tag, session, leaverRole, guild);
                    
                    session.graceInterval = setInterval(async () => {
                        const currentSession = activeLessons.get(session.channelId);
                        if (!currentSession || !currentSession.graceInterval) {
                            clearInterval(session.graceInterval);
                            return;
                        }
                        const remaining = currentSession.graceEndTime - Date.now();
                        if (remaining <= 0) {
                            clearInterval(currentSession.graceInterval);
                            currentSession.graceInterval = null;
                            return;
                        }
                        const roleText = currentSession.graceLeaverRole === 'coach' ? 'KOÇ' : 'ÖĞRENCİ';
                        logger.info(
                            '[Grace-Counter] ' + currentSession.graceLeaverName + ' (' + roleText + ') ' +
                            'bekleniyor. Kalan sure: ' + formatRemainingTime(remaining) +
                            ' | Ders: ' + currentSession.lessonType
                        );
                    }, COUNTER_INTERVAL);
                    
                    session.graceTimeout = setTimeout(async () => {
                        const currentSession = activeLessons.get(oldChannel.id);
                        if (currentSession && currentSession.lastActive === session.lastActive) {
                            const deductPackage = !currentSession.lastLeaverWasCoach;
                            const endReason = currentSession.lastLeaverWasCoach
                                ? 'Koc 15 dakika icinde donmedi - paket dusulmedi'
                                : 'Ogrenci 15 dakika icinde donmedi - paket dusuldu';
                            await endLesson(currentSession, endReason, guild, deductPackage);
                        }
                    }, GRACE_PERIOD);
                    
                    logger.info('[Grace] ' + (member.displayName || member.user.tag) + ' (' + leaverRole + ') ayrildi, 15dk sayac basladi.');
                }
            }
        }

        if (newChannel) {
            const lessonType = getLessonType(newChannel);

            if (!lessonType) return;

            const members = newChannel.members.filter(m => !m.user.bot);
            const coach = members.find(m => isCoach(m));
            const student = members.find(m => isStudent(m) && m.id !== coach?.id);

            if (coach && student) {
                // Önceden bu koç veya öğrencinin başka bir kanalda aktif dersi var mıydı kontrol et
                const prevSession = findActiveSessionForMember(coach.id) || findActiveSessionForMember(student.id);

                if (prevSession && (prevSession.channelId !== newChannel.id || prevSession.lessonType !== lessonType)) {
                    logger.info(`[Lesson] Derse geçiş yapıldı (${prevSession.lessonType} -> ${lessonType}). Önceki ders (${prevSession.lessonType}) sonlandırılıp paketi düşülüyor.`);
                    await endLesson(prevSession, `Farklı derse geçiş yapıldı (${prevSession.lessonType} -> ${lessonType})`, guild, true);
                    
                    // Önceki ders bittikten sonra yeni dersi başlat
                    await startLesson(newChannel, coach, student, lessonType);
                    return;
                }

                const currentSession = activeLessons.get(newChannel.id);
                if (currentSession) {
                    if (member.id === currentSession.coachId || member.id === currentSession.studentId) {
                        if (currentSession.graceTimeout || currentSession.graceInterval) {
                            clearGraceTimers(currentSession);

                            logger.info(
                                '[Grace] ' + (member.displayName || member.user.tag) + ' kanala geri dondu, ders devam ediyor. ' +
                                'Ders: ' + currentSession.lessonType + ' | Kanal: #' + newChannel.name
                            );
                        }
                    } 
                    else if (isStudent(member) && member.id !== currentSession.studentId) {
                        await endLesson(currentSession, 'Yeni ogrenci katildi', guild, true);
                        await startLesson(newChannel, coach, member, lessonType);
                    }
                } 
                else {
                    await startLesson(newChannel, coach, student, lessonType);
                }
            }
        }
    }
};

