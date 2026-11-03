import { getFirestore } from '../database/connection.js';
import { logger } from '../utils/logger.js';

const processedStudentIds = new Set();
let studentsUnsubscribe = null;

export function startStudentSync(client) {
    const db = getFirestore();
    
    logger.info('[Sync] Firestore öğrenci senkronizasyonu başlatıldı.');

    async function handleRemovedStudent(client, studentId, data) {
        try {
            const guild = await getGuild(client);
            if (!guild) return;
            const role = await getStudentRole(guild);
            if (!role) return;
            const member = await findMember(guild, data.discord);
            if (!member) return;
            if (!member.roles.cache.has(role.id)) return;

            await member.roles.remove(role);
            logger.info(`[Sync] Öğrenci Firestore'dan silindi, rol geri alındı: ${member.user.tag} -> ${data.fullName || studentId}`);
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
                    logger.info(`[Sync] Öğrenci silindi (Firestore): ${data?.fullName || id}`);
                    handleRemovedStudent(client, id, data || {});
                }
            });
        },
        (err) => {
            logger.error('[Sync] Firestore snapshot hatası: ' + err.message);
            setTimeout(() => startStudentSync(client), 5000);
        }
    );
}

async function handleNewStudent(client, studentId, data) {
    const guild = await getGuild(client);
    if (!guild) return;

    const member = await findMember(guild, data.discord);
    if (!member) {
        logger.warn(`[Sync] Kayıt bulundu ama Discord hesabı eşleşmedi: ${data.fullName || data.name} (${data.discord})`);
        return;
    }

    // Rol Belirleme (Koç mu Öğrenci mi?)
    const isCoachData = data.role === 'coach' || data.isCoach === true;
    const role = isCoachData ? await getCoachRole(guild) : await getStudentRole(guild);
    
    if (role && !member.roles.cache.has(role.id)) {
        try {
            await member.roles.add(role);
            logger.info(`[Sync] ${member.user.tag} kullanıcısına ${role.name} rolü verildi.`);
            
            // Sadece loga yaz, DM ATMA
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
    // Güncelleme mantığı (gerekirse rol geri alma vb.)
    const guild = await getGuild(client);
    if (!guild) return;

    const member = await findMember(guild, data.discord);
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
                logger.info(`[Sync] ${member.user.tag} kullanıcısı tekrar aktif edildi (DM atılmadı, loglandı).`);
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

async function findMember(guild, discordIdentifier) {
    if (!discordIdentifier) return null;
    
    // ID ise
    if (/^\d{17,19}$/.test(discordIdentifier)) {
        return await guild.members.fetch(discordIdentifier).catch(() => null);
    }
    
    // Tag ise (User#0000)
    if (discordIdentifier.includes('#')) {
        const [username, discriminator] = discordIdentifier.split('#');
        const members = await guild.members.fetch({ query: username, limit: 100 });
        return members.find(m => m.user.discriminator === discriminator);
    }

    // Sadece username ise
    const members = await guild.members.fetch({ query: discordIdentifier, limit: 1 });
    return members.first();
}
