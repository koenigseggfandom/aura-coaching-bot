import { logger } from './logger.js';

/**
 * Öğrenci dokümanı ile bot kaydı (registrations) arasındaki bağlantı alanı.
 * Şemanın ilk sürümünde bu bağlantı farklı bir adla tutuluyordu; eski kayıtlar
 * okunmaya devam edebilsin diye iki alan da desteklenir. Yazma tarafı yalnızca
 * STUDENT_LINK_FIELD'i kullanır.
 */
export const STUDENT_LINK_FIELD = 'studentDocId';
export const LEGACY_STUDENT_LINK_FIELD = 'firestoreStudentId';

/** Kayıttaki öğrenci bağlantısını döndürür; bağlantı yoksa null. */
export function readStudentLink(data) {
    if (!data) return null;
    if (data[STUDENT_LINK_FIELD] !== undefined) return data[STUDENT_LINK_FIELD];
    return data[LEGACY_STUDENT_LINK_FIELD] ?? null;
}

/**
 * Öğrenci dokümanına bağlı kayıtları bulur. Eski ve yeni şemadaki kayıtların
 * ikisi de yakalanır; aynı doküman iki alanda birden varsa tek kez döner.
 */
export async function findRegistrationsByStudentLink(db, studentId) {
    if (!studentId) return [];

    const found = new Map();
    for (const field of [STUDENT_LINK_FIELD, LEGACY_STUDENT_LINK_FIELD]) {
        try {
            const snap = await db.collection('registrations').where(field, '==', studentId).get();
            for (const doc of snap.docs) found.set(doc.id, doc);
        } catch (e) {
            logger.warn('[StudentLink] registrations araması başarısız (' + field + '): ' + e.message);
        }
    }
    return [...found.values()];
}
