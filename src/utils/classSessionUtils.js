import { EmbedBuilder } from 'discord.js';
import { logger } from './logger.js';
import { getFirestore } from '../database/connection.js';
import { getLogChannel } from './channelUtils.js';

/**
 * Sınıf tanımları. Discord ses kanalı ID'leri .env dosyasından okunur.
 * Paneldeki sınıf kayıtları (classId) bu tanımlarla eşleşir.
 */
export const CLASS_DEFS = [
    { id: 'classA', code: 'A', name: 'A Sınıfı', envKey: 'CLASS_A_CHANNEL_ID' },
    { id: 'classB', code: 'B', name: 'B Sınıfı', envKey: 'CLASS_B_CHANNEL_ID' },
    { id: 'classC', code: 'C', name: 'C Sınıfı', envKey: 'CLASS_C_CHANNEL_ID' }
];

/** Verilen Discord kanal ID'sinin hangi sınıfa ait olduğunu döndürür */
export function getClassByChannelId(channelId) {
    if (!channelId) return null;
    const idStr = String(channelId);
    for (const def of CLASS_DEFS) {
        const envVal = (process.env[def.envKey] || '').trim();
        if (envVal && envVal === idStr) return def;
    }
    return null;
}

/** classId ("classA") ile sınıf tanımını döndürür */
export function getClassById(classId) {
    return CLASS_DEFS.find((d) => d.id === classId) || null;
}

// Haftalık program gün anahtarları (JS getDay(): 0=Pazar ... 6=Cumartesi)
const DAY_KEYS = ['pazar', 'pazartesi', 'sali', 'carsamba', 'persembe', 'cuma', 'cumartesi'];

function todayDayKey(ts = Date.now()) {
    return DAY_KEYS[new Date(ts).getDay()];
}

/** "20:30" -> 1230 */
function timeToMinutes(str) {
    if (!str || typeof str !== 'string') return 0;
    const [h, m] = str.split(':').map((n) => parseInt(n, 10));
    return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

/**
 * Sınıf ses kanalı eşleştirmesini panele yayınlar (panel Discord kanal adını gösterebilsin).
 */
export async function publishClassConfig(db, guild) {
    const classes = {};
    for (const def of CLASS_DEFS) {
        const channelId = (process.env[def.envKey] || '').trim();
        if (!channelId) continue;
        let channelName = null;
        try {
            const ch = guild
                ? (guild.channels.cache.get(channelId) || (await guild.channels.fetch(channelId).catch(() => null)))
                : null;
            channelName = ch ? ch.name : null;
        } catch (_) {}
        classes[def.id] = { channelId, channelName };
    }
    await db.collection('classConfig').doc('main').set({ classes, updatedAt: new Date() }, { merge: true });
    logger.info('[Sınıf] Kanal eşleştirmesi panele yayınlandı.');
}


/** Öğrencinin görünen adını üretir */
function displayNameOf(data) {
    if (!data) return 'İsimsiz';
    return (
        data.fullName ||
        `${data.firstName || ''} ${data.lastName || ''}`.trim() ||
        data.discord ||
        'İsimsiz'
    );
}

/**
 * Discord kullanıcı ID'sini Firestore'daki öğrenci kaydıyla eşleştirir.
 * Önce registrations haritası, sonra students alanları denenir.
 */
export async function findStudentByDiscordId(db, discordId) {
    const id = String(discordId);

    try {
        const regSnap = await db
            .collection('registrations')
            .where('studentId', '==', id)
            .limit(1)
            .get();
        if (!regSnap.empty) {
            const firestoreStudentId = regSnap.docs[0].data().firestoreStudentId;
            if (firestoreStudentId) {
                const doc = await db.collection('students').doc(firestoreStudentId).get();
                if (doc.exists) return doc;
            }
        }
    } catch (e) {
        logger.warn('[Sınıf] registrations aramasında hata: ' + e.message);
    }

    try {
        const byDiscordId = await db.collection('students').where('discordId', '==', id).limit(1).get();
        if (!byDiscordId.empty) return byDiscordId.docs[0];

        const byDiscord = await db.collection('students').where('discord', '==', id).limit(1).get();
        if (!byDiscord.empty) return byDiscord.docs[0];

        const byMention = await db.collection('students').where('discord', '==', `<@${id}>`).limit(1).get();
        if (!byMention.empty) return byMention.docs[0];
    } catch (e) {
        logger.warn('[Sınıf] students aramasında hata: ' + e.message);
    }

    return null;
}

/** Sınıfa atanmış tüm öğrenci kayıtlarını döndürür */
export async function getClassStudents(db, classId) {
    const snap = await db.collection('students').where('classId', '==', classId).get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/** Sınıf için aktif (devam eden) bir oturum var mı? */
export async function getActiveClassSession(db, classId) {
    const snap = await db
        .collection('classSessions')
        .where('classId', '==', classId)
        .where('status', '==', 'active')
        .limit(1)
        .get();
    if (snap.empty) return null;
    const doc = snap.docs[0];
    return { ...doc.data(), sessionId: doc.id };
}

/**
 * Haftalık programda bu oturuma karşılık gelen ders kaydını bulur ve
 * "devam ediyor" olarak işaretler. Planlanan ders ile gerçekleşen ders ayrı tutulur;
 * bu eşleştirme ders hakkı düşmez, yalnızca durum bilgisini günceller.
 */
async function linkScheduleToSession(db, session) {
    try {
        const ref = db.collection('classSchedules').doc(session.classId);
        const snap = await ref.get();
        if (!snap.exists) return;

        const slots = Array.isArray(snap.data().slots) ? snap.data().slots : [];
        if (!slots.length) return;

        const dayKey = todayDayKey(session.startTime);
        const start = new Date(session.startTime);
        const nowMin = start.getHours() * 60 + start.getMinutes();

        let bestIdx = -1;
        let bestDiff = Infinity;
        slots.forEach((slot, idx) => {
            if (slot.day !== dayKey) return;
            if (slot.status === 'cancelled') return;
            const diff = Math.abs(timeToMinutes(slot.startTime) - nowMin);
            if (diff < bestDiff) {
                bestDiff = diff;
                bestIdx = idx;
            }
        });

        // 3 saatlik pencere dışındaki eşleşmeleri yok say
        if (bestIdx < 0 || bestDiff > 180) return;

        const slot = slots[bestIdx];
        slot.sessionId = session.sessionId;
        slot.status = 'ongoing';
        slot.lastSessionDate = session.date;
        slot.updatedAt = new Date().toISOString();

        await ref.update({ slots, updatedAt: new Date() });
        session.scheduleSlotId = slot.id;
        await db
            .collection('classSessions')
            .doc(session.sessionId)
            .update({ scheduleSlotId: slot.id })
            .catch(() => {});

        logger.info(`[Sınıf] ${session.className} oturumu program kaydıyla eşleşti (${slot.day} ${slot.startTime}).`);
    } catch (e) {
        logger.warn('[Sınıf] Program eşleştirme hatası: ' + e.message);
    }
}

/** Oturum kapandığında ilgili program kaydını "tamamlandı" yapar ve katılım özetini yazar. */
async function completeScheduleSlot(db, session, attendedCount, absentCount) {
    try {
        const ref = db.collection('classSchedules').doc(session.classId);
        const snap = await ref.get();
        if (!snap.exists) return;

        const slots = Array.isArray(snap.data().slots) ? snap.data().slots : [];
        const idx = slots.findIndex((s) => s.id === session.scheduleSlotId);
        if (idx < 0) return;

        slots[idx].status = 'completed';
        slots[idx].sessionId = null;
        slots[idx].lastSessionId = session.sessionId;
        slots[idx].lastSessionDate = session.date;
        slots[idx].attendedCount = attendedCount;
        slots[idx].absentCount = absentCount;
        slots[idx].updatedAt = new Date().toISOString();

        await ref.update({ slots, updatedAt: new Date() });
    } catch (e) {
        logger.warn('[Sınıf] Program kaydı güncellenemedi: ' + e.message);
    }
}

/**
 * Yeni bir sınıf ders oturumu açar.
 * Katılımcı listesi oturum başında sabitlenir; ders devam ederken sınıfa eklenen
 * öğrenciler bu oturuma dahil edilmez.
 */
export async function createClassSession(db, classDef, channel, starterDoc, guild) {
    const students = await getClassStudents(db, classDef.id);
    const startTs = Date.now();
    const startDate = new Date(startTs);

    const participants = students.map((s) => ({
        studentId: s.id,
        discordId: s.discordId || s.discord || null,
        name: displayNameOf(s),
        attended: false,
        joinedAt: null,
        leftAt: null
    }));

    const starterData = starterDoc ? starterDoc.data() || {} : {};

    const payload = {
        classId: classDef.id,
        className: classDef.name,
        classCode: classDef.code,
        channelId: channel.id,
        channelName: channel.name,
        date: startDate.toISOString().split('T')[0],
        startTime: startTs,
        endTime: null,
        duration: 0,
        durationText: '-',
        status: 'active',
        participants,
        deducted: false,
        deductedCount: 0,
        attendedCount: 0,
        absentCount: 0,
        startedByDiscordId: starterDoc ? starterDoc.id : null,
        startedByName: starterDoc ? displayNameOf(starterData) : null,
        createdAt: new Date(),
        updatedAt: new Date()
    };

    const ref = await db.collection('classSessions').add(payload);
    payload.sessionId = ref.id;

    logger.info(
        `[Sınıf] Ders başladı: ${classDef.name} | Kanal #${channel.name} | ` +
        `${participants.length} öğrenci oturuma alındı | Başlatan: ${payload.startedByName || '-'}`
    );

    const logChannel = getLogChannel(guild);
    if (logChannel) {
        const embed = new EmbedBuilder()
            .setColor('#10B981')
            .setTitle('🎓 Sınıf Dersi Başladı')
            .addFields([
                { name: '🏫 Sınıf', value: classDef.name, inline: true },
                { name: '🔊 Kanal', value: `#${channel.name}`, inline: true },
                { name: '👥 Oturumdaki Öğrenci', value: String(participants.length), inline: true },
                { name: '🕐 Başlangıç', value: `<t:${Math.floor(startTs / 1000)}:F>`, inline: false }
            ])
            .setTimestamp();
        logChannel.send({ embeds: [embed] }).catch((e) => logger.warn('[Sınıf] Log gönderilemedi: ' + e.message));
    }

    // Haftalık programdaki ilgili ders kaydıyla eşleştir (varsa)
    await linkScheduleToSession(db, payload);

    return payload;
}

/** Oturum katılımcı bilgisini Firestore'a yazar (ders devam ederken panel görebilsin) */
export async function persistSessionParticipants(db, session) {
    try {
        await db.collection('classSessions').doc(session.sessionId).update({
            participants: session.participants,
            updatedAt: new Date()
        });
    } catch (e) {
        logger.warn('[Sınıf] Katılım güncellenemedi: ' + e.message);
    }
}

/** Kanal katılımını işaretler. Oturumda olmayan (sonradan eklenen) öğrenci dahil edilmez. */
export function markParticipantJoined(session, discordId, studentId) {
    const p = session.participants.find(
        (x) => x.studentId === studentId || (x.discordId && x.discordId === String(discordId))
    );
    if (!p) return false;
    if (p.attended === true) return false;
    p.attended = true;
    p.joinedAt = Date.now();
    return true;
}

/** Kanal ayrılış zamanını kaydeder */
export function markParticipantLeft(session, discordId, studentId) {
    const p = session.participants.find(
        (x) => (studentId && x.studentId === studentId) || (x.discordId && x.discordId === String(discordId))
    );
    if (!p) return false;
    p.leftAt = Date.now();
    return true;
}

/**
 * Tek bir öğrenciden sınıf dersi hakkını düşer ve ders geçmişine işler.
 * Katılım bilgisi (attended) ile düşüm aynı transaction içinde yapılır.
 */
async function deductClassLesson(db, participant, session, minutes, timeStr, attended) {
    const studentRef = db.collection('students').doc(participant.studentId);
    const historyId = `${session.sessionId}_${participant.studentId}`;
    const lessonTypeLabel = `${session.className} Dersi`;

    const result = await db.runTransaction(async (tx) => {
        const snap = await tx.get(studentRef);
        if (!snap.exists) return { ok: false, reason: 'not_found' };

        const data = snap.data() || {};
        const total = Number(data.totalLessons || data.lessonCount || 0);
        const used = Number(data.usedLessons || 0);
        const newUsed = used + 1;
        const newRemaining = total > 0 ? Math.max(0, total - newUsed) : 0;

        const history = Array.isArray(data.lessonHistory) ? [...data.lessonHistory] : [];
        const item = {
            id: historyId,
            sessionId: session.sessionId,
            type: lessonTypeLabel,
            category: lessonTypeLabel,
            coach: session.className,
            coachName: session.className,
            coachTag: session.className,
            date: session.date,
            time: timeStr,
            duration: minutes,
            attended,
            status: attended ? 'attended' : 'absent',
            notes: `${session.className} grup dersi (${attended ? 'Katıldı' : 'Katılmadı'})`,
            createdAt: new Date().toISOString()
        };

        const existIdx = history.findIndex((h) => h && h.id === historyId);
        if (existIdx >= 0) history[existIdx] = { ...history[existIdx], ...item };
        else history.push(item);

        tx.update(studentRef, {
            usedLessons: newUsed,
            remainingLessons: newRemaining,
            lastLessonDate: new Date(),
            lessonHistory: history,
            updatedAt: new Date().toISOString()
        });

        return { ok: true, newUsed, newRemaining, total, exhausted: total > 0 && newRemaining === 0 };
    });

    if (result.ok) {
        await db
            .collection('lessonRecords')
            .add({
                id: historyId,
                sessionId: session.sessionId,
                classId: session.classId,
                className: session.className,
                studentId: participant.studentId,
                studentName: participant.name,
                discordId: participant.discordId,
                lessonType: lessonTypeLabel,
                category: lessonTypeLabel,
                coach: session.className,
                coachName: session.className,
                date: session.date,
                time: timeStr,
                startTime: session.startTime,
                endTime: Date.now(),
                duration: minutes,
                attended,
                status: 'completed',
                source: 'class_voice_auto',
                packageDeducted: true,
                usedLessonsAfter: result.newUsed,
                remainingLessonsAfter: result.newRemaining,
                totalLessons: result.total,
                createdAt: new Date()
            })
            .catch((e) => logger.warn('[Sınıf] lessonRecords yazılamadı: ' + e.message));
    }

    return result;
}

/**
 * Sınıf ders oturumunu kapatır: katılım durumlarını kesinleştirir,
 * tüm öğrencilerden bir ders hakkı düşer ve kaydı tamamlar.
 * Aynı oturum için ikinci kez düşüm yapılmasını engeller.
 */
export async function completeClassSession(db, session, guild) {
    const ref = db.collection('classSessions').doc(session.sessionId);

    const fresh = await ref.get().catch(() => null);
    if (!fresh || !fresh.exists) return null;
    if (fresh.data().deducted === true) {
        logger.warn('[Sınıf] Oturum zaten sonuçlandırılmış, tekrar düşüm yapılmadı: ' + session.sessionId);
        return null;
    }

    const endTs = Date.now();
    const durationMs = Math.max(0, endTs - session.startTime);
    const minutes = Math.max(1, Math.floor(durationMs / 60000));
    const timeStr = new Date(session.startTime).toLocaleTimeString('tr-TR', {
        hour: '2-digit',
        minute: '2-digit'
    });

    const results = [];
    for (const p of session.participants) {
        const attended = p.attended === true;
        try {
            const r = await deductClassLesson(db, p, session, minutes, timeStr, attended);
            results.push({ ...p, ...r, attended });
        } catch (e) {
            logger.error(`[Sınıf] Ders düşüm hatası (${p.name}): ` + e.message);
            results.push({ ...p, ok: false, reason: 'error', attended });
        }
    }

    const attendedList = results.filter((r) => r.attended);
    const absentList = results.filter((r) => !r.attended);
    const deductedCount = results.filter((r) => r.ok).length;

    await ref
        .update({
            endTime: endTs,
            duration: minutes,
            durationText: `${minutes} dakika`,
            status: 'completed',
            participants: session.participants,
            deducted: true,
            deductedCount,
            attendedCount: attendedList.length,
            absentCount: absentList.length,
            updatedAt: new Date()
        })
        .catch((e) => logger.warn('[Sınıf] Oturum güncellenemedi: ' + e.message));

    // Haftalık programdaki ilgili kaydı "tamamlandı" olarak güncelle
    if (session.scheduleSlotId) {
        await completeScheduleSlot(db, session, attendedList.length, absentList.length);
    }

    // Yönetim paneli bildirimi
    await db
        .collection('notifications')
        .add({
            type: 'class_lesson_completed',
            classId: session.classId,
            className: session.className,
            sessionId: session.sessionId,
            title: `${session.className} dersi gerçekleştirildi`,
            message: `${session.date} ${timeStr} - ${attendedList.length} katıldı, ${absentList.length} katılmadı (${minutes} dk)`,
            attendedCount: attendedList.length,
            absentCount: absentList.length,
            duration: minutes,
            read: false,
            createdAt: new Date()
        })
        .catch((e) => logger.warn('[Sınıf] Bildirim yazılamadı: ' + e.message));

    // Ders hakkı biten öğrenciler için yöneticiyi uyar (pasife alma yapılmaz)
    for (const ex of results.filter((r) => r.ok && r.exhausted)) {
        await db
            .collection('notifications')
            .add({
                type: 'lesson_quota_exhausted',
                classId: session.classId,
                studentId: ex.studentId,
                studentName: ex.name,
                title: 'Ders hakkı doldu',
                message: `${ex.name} (${session.className}) için kalan ders hakkı 0.`,
                read: false,
                createdAt: new Date()
            })
            .catch(() => {});
    }

    logger.info(
        `[Sınıf] Ders bitti: ${session.className} | ${minutes} dk | ` +
        `Katılan: ${attendedList.length} | Katılmayan: ${absentList.length} | Düşülen: ${deductedCount}`
    );

    const logChannel = getLogChannel(guild);
    if (logChannel) {
        const embed = new EmbedBuilder()
            .setColor('#10B981')
            .setTitle('✅ Sınıf Dersi Tamamlandı')
            .addFields([
                { name: '🏫 Sınıf', value: session.className, inline: true },
                { name: '📅 Tarih', value: `${session.date} ${timeStr}`, inline: true },
                { name: '⏱️ Süre', value: `${minutes} dakika`, inline: true },
                {
                    name: '✅ Katılan',
                    value: attendedList.length ? attendedList.map((r) => r.name).join(', ') : '-',
                    inline: false
                },
                {
                    name: '❌ Katılmayan',
                    value: absentList.length ? absentList.map((r) => r.name).join(', ') : '-',
                    inline: false
                },
                { name: '📦 Ders Hakkı', value: `${deductedCount} öğrenciden 1 ders düşüldü`, inline: false }
            ])
            .setTimestamp();
        logChannel.send({ embeds: [embed] }).catch((e) => logger.warn('[Sınıf] Log gönderilemedi: ' + e.message));
    }

    return { attendedList, absentList, deductedCount, minutes };
}

export { getFirestore };
