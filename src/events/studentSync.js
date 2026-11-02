import { getFirestore } from '../database/connection.js';
import { logger } from '../utils/logger.js';

const processedStudentIds = new Set();
let studentsUnsubscribe = null;

export function startStudentSync(client) {
    const db = getFirestore();
    
    logger.info('[Sync] MongoDB/Firestore öğrenci senkronizasyonu başlatıldı.');

    async function handleRemovedStudent(client, studentId, data) {
        try {
            const guild = await getGuild(client);
            if (!guild) return;
            const role = await getStudentRole(guild);
            if (!role) return;
            const member = await findMember(guild, data.discord, data, studentId);
            if (!member) return;
            if (!member.roles.cache.has(role.id)) return;

            await member.roles.remove(role);
            logger.info(`[Sync] Öğrenci silindi, rol geri alındı: ${member.user.tag} -> ${data.fullName || studentId}`);
        } catch (e) {
            logger.error(`[Sync] removed hatası: ${e.message}`);
        }
    }

    studentsUnsubscribe = db.collection('students').onSnapshot(
        (snap) => {
            snap.docChanges().forEach(async (change) => {
                const doc = change.doc;
                const id = doc.id;
                const data = change.doc.data();

                if (change.type === 'added') {
                    if (processedStudentIds.has(id)) return;
                    processedStudentIds.add(id);
                    await handleNewStudent(client, id, data);
                } else if (change.type === 'modified') {
                    await handleStudentUpdate(client, id, data);
                } else if (change.type === 'removed') {
                    processedStudentIds.delete(id);
                    logger.info(`[Sync] Öğrenci silindi: ${data?.fullName || id}`);
                    handleRemovedStudent(client, id, data || {});
                }
            });
        },
        (err) => {
            logger.error('[Sync] Öğrenci snapshot hatası: ' + err.message);
            setTimeout(() => startStudentSync(client), 5000);
        }
    );
}

async function handleNewStudent(client, studentId, data) {
    const guild = await getGuild(client);
    if (!guild) return;

    const member = await findMember(guild, data.discord, data, studentId);
    if (!member) {
        logger.warn(`[Sync] Kayıt bulundu ama Discord hesabı eşleşmedi: ${data.fullName || data.name} (${data.discord || data.discordId})`);
        return;
    }

    // Rol Belirleme (Koç mu Öğrenci mi?)
    const isCoachData = data.role === 'coach' || data.isCoach === true;
    const role = isCoachData ? await getCoachRole(guild) : await getStudentRole(guild);
    
    if (role && !member.roles.cache.has(role.id)) {
        try {
            await member.roles.add(role);
            logger.info(`[Sync] ${member.user.tag} kullanıcısına ${role.name} rolü verildi.`);
            
            if (!isCoachData) {
                logWelcome(data, member.user.tag);
            }
        } catch (error) {
            logger.error(`[Sync] Rol verme hatası: ${error.message}`);
        }
    }
}

function logWelcome(data, userTag) {
    logger.info(
        '[Welcome] Yeni öğrenci kaydı: ' + userTag +
        ' | Paket: ' + (data.packageName || 'Standart Paket') +
        ' | Toplam Ders: ' + (data.totalLessons || 0) +
        ' | Kalan: ' + (data.remainingLessons || data.totalLessons || 0)
    );
}

async function getCoachRole(guild) {
    const roleId = process.env.COACH_ROLE_ID;
    if (roleId) return guild.roles.cache.get(roleId) || await guild.roles.fetch(roleId).catch(() => null);
    return guild.roles.cache.find(r => r.name.toLowerCase().includes('koç') || r.name.toLowerCase().includes('coach'));
}

async function handleStudentUpdate(client, studentId, data) {
    const guild = await getGuild(client);
    if (!guild) return;

    const member = await findMember(guild, data.discord, data, studentId);
    if (!member) return;

    const role = await getStudentRole(guild);
    const isActive = data.isActive !== false;

    if (role) {
        if (isActive && !member.roles.cache.has(role.id)) {
            await member.roles.add(role);
            
            const db = getFirestore();
            const snap = await db.collection('registrations')
                .where('firestoreStudentId', '==', studentId)
                .limit(1)
                .get()
                .catch(() => ({ empty: true }));
            const isReactivation = !snap.empty;
            
            if (!isReactivation) {
                logWelcome(data, member.user.tag);
            } else {
                logger.info(`[Sync] ${member.user.tag} kullanıcısı tekrar aktif edildi.`);
            }
        } else if (!isActive && member.roles.cache.has(role.id)) {
            await member.roles.remove(role);
            logger.info(`[Sync] ${member.user.tag} kullanıcısından @Öğrenci rolü geri alındı (Pasif).`);
        }
    }
}

async function getGuild(client) {
    const guildId = process.env.GUILD_ID;
    if (guildId) return client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
    return client.guilds.cache.first();
}

async function getStudentRole(guild) {
    const roleId = process.env.STUDENT_ROLE_ID;
    if (roleId) return guild.roles.cache.get(roleId) || await guild.roles.fetch(roleId).catch(() => null);
    return guild.roles.cache.find(r => r.name.toLowerCase().includes('öğrenci') || r.name.toLowerCase().includes('student'));
}

export async function findMember(guild, discordIdentifier, data = {}, studentId = null) {
    if (!guild) return null;

    // 1. data.discordId numeric snowflake (17-21 hane)
    const directId = data.discordId || (typeof discordIdentifier === 'string' && /^\d{17,21}$/.test(discordIdentifier.trim()) ? discordIdentifier.trim() : null);
    if (directId) {
        const member = await guild.members.fetch(String(directId)).catch(() => null);
        if (member) return member;
    }

    // 2. Mention formatı: <@123456789012345678> veya <@!123456789012345678>
    const str = String(discordIdentifier || data.discord || '').trim();
    const mentionMatch = str.match(/<@!?(\d{17,21})>/);
    if (mentionMatch) {
        const member = await guild.members.fetch(mentionMatch[1]).catch(() => null);
        if (member) {
            autoLinkDiscordId(member.id, studentId || data.id);
            return member;
        }
    }

    // 3. registrations tablosu üzerinden eşleşme kontrolü
    const sid = studentId || data.id;
    if (sid) {
        try {
            const db = getFirestore();
            const regSnap = await db.collection('registrations')
                .where('firestoreStudentId', '==', sid)
                .limit(1)
                .get();
            if (!regSnap.empty) {
                const regData = regSnap.docs[0].data();
                const regStudentId = String(regData.studentId || '').trim();
                if (/^\d{17,21}$/.test(regStudentId)) {
                    const member = await guild.members.fetch(regStudentId).catch(() => null);
                    if (member) {
                        autoLinkDiscordId(member.id, sid);
                        return member;
                    }
                }
            }
        } catch (_) {}
    }

    if (!str) return null;

    // 4. @ işaretini temizle
    const cleanTag = str.startsWith('@') ? str.slice(1).trim() : str;

    // 5. User#1234 discriminator
    if (cleanTag.includes('#')) {
        const [username, discriminator] = cleanTag.split('#');
        try {
            const members = await guild.members.fetch({ query: username, limit: 50 }).catch(() => null);
            if (members) {
                const found = members.find(m => m.user.discriminator === discriminator || m.user.username.toLowerCase() === username.toLowerCase());
                if (found) {
                    autoLinkDiscordId(found.id, sid);
                    return found;
                }
            }
        } catch (_) {}
    }

    // 6. Username / DisplayName arama
    try {
        const members = await guild.members.fetch({ query: cleanTag, limit: 10 }).catch(() => null);
        if (members && members.size > 0) {
            const exactUser = members.find(m => m.user.username.toLowerCase() === cleanTag.toLowerCase());
            if (exactUser) {
                autoLinkDiscordId(exactUser.id, sid);
                return exactUser;
            }
            const exactNick = members.find(m => m.displayName.toLowerCase() === cleanTag.toLowerCase());
            if (exactNick) {
                autoLinkDiscordId(exactNick.id, sid);
                return exactNick;
            }
            const first = members.first();
            autoLinkDiscordId(first.id, sid);
            return first;
        }
    } catch (_) {}

    // 7. Cache araması
    const lower = cleanTag.toLowerCase();
    const cached = guild.members.cache.find(m => 
        m.user.username.toLowerCase() === lower || 
        m.user.tag.toLowerCase() === lower ||
        m.displayName.toLowerCase() === lower
    );
    if (cached) {
        autoLinkDiscordId(cached.id, sid);
        return cached;
    }

    return null;
}

function autoLinkDiscordId(discordId, studentId) {
    if (!discordId || !studentId) return;
    try {
        const db = getFirestore();
        db.collection('students').doc(studentId).update({
            discordId: String(discordId),
            updatedAt: new Date().toISOString()
        }).catch(() => {});
    } catch (_) {}
}
