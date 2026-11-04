import { Events } from 'discord.js';
import { logger } from '../utils/logger.js';
import { getFirestore } from '../database/connection.js';
import {
    getClassByChannelId,
    getClassById,
    findStudentByDiscordId,
    createClassSession,
    getActiveClassSession,
    completeClassSession,
    markParticipantJoined,
    markParticipantLeft,
    persistSessionParticipants
} from '../utils/classSessionUtils.js';

// Kanal tamamen boşaldıktan sonra dersin kapanması için beklenen süre
const GRACE_PERIOD = 3 * 60 * 1000;

// classId -> oturum (bellek içi)
export const classSessions = new Map();
// classId -> grace timeout
export const graceTimers = new Map();

export function hasSessionForChannel(channelId) {
    if (!channelId) return false;
    for (const sess of classSessions.values()) {
        if (sess && sess.channelId === String(channelId)) return true;
    }
    return false;
}

export function getClassDefForChannel(channelId) {
    if (!channelId) return null;
    const def = getClassByChannelId(channelId);
    if (def) return def;
    for (const [cId, sess] of classSessions.entries()) {
        if (sess && sess.channelId === String(channelId)) {
            return getClassById(cId) || { id: cId, name: sess.className || cId };
        }
    }
    return null;
}

function studentDisplayName(data) {
    if (!data) return 'İsimsiz';
    return data.fullName || `${data.firstName || ''} ${data.lastName || ''}`.trim() || 'İsimsiz';
}

function clearGrace(classId) {
    const t = graceTimers.get(classId);
    if (t) {
        clearTimeout(t);
        graceTimers.delete(classId);
    }
}

/**
 * Kesin bir aktif oturumu belleğe alır. Yoksa o sınıf için yeni oturum açar.
 */
export async function ensureSession(db, classDef, channel, studentDoc, guild) {
    let session = classSessions.get(classDef.id);

    if (!session) {
        const active = await getActiveClassSession(db, classDef.id);
        if (active) {
            session = active;
            logger.info(`[Sınıf] ${classDef.name} için devam eden oturum bulundu: ${session.sessionId}`);
        }
    }

    if (!session) {
        session = await createClassSession(db, classDef, channel, studentDoc, guild);
    }

    classSessions.set(classDef.id, session);
    return session;
}

export async function handleClassJoin(member, channel, guild, db, explicitClassDef = null) {
    const classDef = explicitClassDef || getClassByChannelId(channel.id);
    if (!classDef) return;

    const studentDoc = await findStudentByDiscordId(db, member.id, member.user.username, member.displayName);
    if (!studentDoc) {
        logger.info(`[Sınıf] #${channel.name}: ${member.user.tag} sistemde kayıtlı öğrenci değil, yok sayıldı.`);
        return;
    }

    const studentData = studentDoc.data() || {};

    if (studentData.classId && studentData.classId !== classDef.id) {
        logger.warn(
            `[Sınıf] ${studentDisplayName(studentData)} (${member.user.tag}) ${classDef.name} kanalında ama ` +
            `atanmış sınıfı "${studentData.classId || 'yok'}". Ders oturumu oluşturulmadı.`
        );
        return;
    }

    const session = await ensureSession(db, classDef, channel, studentDoc, guild);

    const changed = markParticipantJoined(session, member.id, studentDoc.id);
    if (changed) await persistSessionParticipants(db, session);

    clearGrace(classDef.id);
    logger.info(`[Sınıf] ${studentDisplayName(studentData)} (${member.user.tag}) ${classDef.name} dersine katıldı.`);
}

export async function handleClassLeave(member, channel, guild, db, explicitClassDef = null) {
    const classDef = explicitClassDef || getClassDefForChannel(channel.id);
    if (!classDef) return;

    const session = classSessions.get(classDef.id);
    if (!session) return;

    logger.info(`[Sınıf] ${member.displayName || member.user.tag} (${classDef.name}) dersten ayrıldı.`);

    const changed = markParticipantLeft(session, member.id);
    if (changed) await persistSessionParticipants(db, session);

    // Kanalda bot olmayan başka üye var mı? Varsa ders devam ediyor.
    const remaining = channel.members.filter((m) => !m.user.bot);
    if (remaining.size > 0) return;

    if (graceTimers.has(classDef.id)) return;

    const timer = setTimeout(async () => {
        graceTimers.delete(classDef.id);
        const current = classSessions.get(classDef.id);
        if (!current) return;

        // Bekleme süresince kanal yeniden dolduysa dersi kapatma
        try {
            const fresh = await channel.fetch().catch(() => channel);
            if (fresh.members.filter((m) => !m.user.bot).size > 0) {
                logger.info(`[Sınıf] ${classDef.name} kanalı yeniden doldu, ders devam ediyor.`);
                return;
            }
        } catch (_) {}

        classSessions.delete(classDef.id);
        await completeClassSession(db, current, guild);
        logger.info(`[Sınıf] ${classDef.name} ders oturumu tamamlandı, tüm sınıf öğrencilerinin hakkı düşüldü.`);
    }, GRACE_PERIOD);

    graceTimers.set(classDef.id, timer);
    logger.info(
        `[Sınıf] ${classDef.name} kanalı boşaldı, ${Math.round(GRACE_PERIOD / 60000)} dk içinde ` +
        'kimse girmezse ders sonlandırılacak.'
    );
}

/**
 * Bot yeniden başladığında yarım kalan oturumları kontrol eder.
 * Kanalda hâlâ öğrenci varsa oturumu devam ettirir, yoksa kapatıp ders hakkını düşer.
 */
export async function initClassSessions(client) {
    try {
        const db = getFirestore();
        const snap = await db.collection('classSessions').where('status', '==', 'active').get();
        if (snap.empty) return;

        logger.info(`[Sınıf] ${snap.size} aktif oturum kontrol ediliyor...`);

        for (const doc of snap.docs) {
            const session = { ...doc.data(), sessionId: doc.id };
            const classDef = getClassById(session.classId);
            const channel = client.channels.cache.get(session.channelId);

            if (!classDef || !channel) {
                await completeClassSession(db, session, null);
                continue;
            }

            const liveMembers = channel.members.filter((m) => !m.user.bot);
            if (liveMembers.size > 0) {
                for (const m of liveMembers.values()) {
                    markParticipantJoined(session, m.id, null);
                }
                await persistSessionParticipants(db, session);
                classSessions.set(classDef.id, session);
                logger.info(`[Sınıf] ${classDef.name} oturumu devam ettiriliyor (${liveMembers.size} üye kanalda).`);
            } else {
                await completeClassSession(db, session, channel.guild);
                logger.info(`[Sınıf] ${classDef.name} oturumu kanal boş olduğu için kapatıldı.`);
            }
        }
    } catch (e) {
        logger.error('[Sınıf] Aktif oturum kontrolü hatası: ' + e.message);
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
        if (oldChannel?.id === newChannel?.id) return;

        // Sınıf ses kanallarındaki veya aktif bir sınıf oturumunun olduğu kanaldaki hareketler
        const joinedClass = newChannel ? getClassDefForChannel(newChannel.id) : null;
        const leftClass = oldChannel ? getClassDefForChannel(oldChannel.id) : null;
        if (!joinedClass && !leftClass) return;

        const db = getFirestore();

        try {
            if (joinedClass) {
                await handleClassJoin(member, newChannel, guild, db, joinedClass);
            }
            if (leftClass && (!newChannel || newChannel.id !== oldChannel.id)) {
                await handleClassLeave(member, oldChannel, guild, db, leftClass);
            }
        } catch (e) {
            logger.error('[Sınıf] voiceStateUpdate hatası: ' + e.message);
        }
    }
};
