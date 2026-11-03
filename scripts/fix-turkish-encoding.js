/**
 * Türkçe karakter bozulmasını (mojibake) MongoDB'de onaran bakım betiği.
 *
 * Sorun: UTF-8 baytları Latin-1 gibi çözüldüğünde "Özkan" -> "Ã–zkan" biçiminde çift
 * kodlanmış metin veritabanına yazılır ve panelde bozuk görünür.
 *
 * Çözüm: Şüpheli metinleri Latin-1 baytlarına geri çevirip UTF-8 olarak yeniden çözer;
 * sonuç gerçekten düzeliyorsa (round-trip tutarlıysa) kaydı günceller.
 *
 * Kullanım:
 *   node scripts/fix-turkish-encoding.js                    # kuru çalıştırma (rapor)
 *   node scripts/fix-turkish-encoding.js --write             # düzeltmeleri uygula
 *   node scripts/fix-turkish-encoding.js --write --collections=students,applications
 *
 * Not: U+FFFD (�) karakterine dönüşmüş verilerde orijinal baytlar kaybolmuştur;
 * betim bunları düzeltemez, yalnızca raporlar. Bu kayıtların kaynağından yeniden
 * girilmesi gerekir.
 */
import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

const DEFAULT_COLLECTIONS = [
    'students', 'applications', 'registrations', 'coaches', 'lessonTypes',
    'lessonRecords', 'lesson_history', 'classSessions', 'classSchedules',
    'classConfig', 'notifications', 'settings', 'support_sessions', 'support_messages'
];

// Çift kodlanmış UTF-8'in tipik izleri (Latin-1 görünümü)
const MOJIBAKE_HINT = /[ÃÂ][\x80-\xBF€‚ƒ„…†‡ˆ‰Š‹ŒŽ''""•–—˜™š›œžŸ¡¢£¤¥¦§¨©ª«¬®¯°±²³´µ¶·¸¹º»¼½¾¿]/;

// Geri dönüşü olmayan kayıp karakter
const REPLACEMENT = /\uFFFD/;

function looksLikeMojibake(value) {
    return MOJIBAKE_HINT.test(value);
}

/** Latin-1'e geri çevirip UTF-8 olarak çözer; tutarlı değilse null döner. */
function fixString(value) {
    try {
        const bytes = Buffer.from(value, 'latin1');
        const fixed = bytes.toString('utf8');
        if (fixed === value) return null;              // zaten düzgün
        if (REPLACEMENT.test(fixed)) return null;      // çözüm başarısız, dokunma
        if (looksLikeMojibake(value)) return fixed;    // iz varsa uygula
        return null;                                   // iz yoksa riske girme
    } catch (_) {
        return null;
    }
}

/** Dokümanı yürügeç; düzeltilmiş alan sayısını döndürür (yerinde değiştirir). */
function fixValue(value, stats) {
    if (typeof value === 'string') {
        if (REPLACEMENT.test(value)) stats.lost++;
        const fixed = fixString(value);
        if (fixed !== null) {
            stats.fixed++;
            return fixed;
        }
        return value;
    }
    if (Array.isArray(value)) {
        return value.map((v) => fixValue(v, stats));
    }
    if (value && typeof value === 'object') {
        const out = {};
        for (const [k, v] of Object.entries(value)) {
            out[k] = k === '_id' ? v : fixValue(v, stats);
        }
        return out;
    }
    return value;
}

const args = process.argv.slice(2);
const apply = args.includes('--write');
const colArg = args.find((a) => a.startsWith('--collections='));
const collections = colArg ? colArg.split('=').pop().split(',').map((s) => s.trim()).filter(Boolean) : DEFAULT_COLLECTIONS;

const uri = process.env.MONGO_URL;
if (!uri) {
    console.error('MONGO_URL ortam değişkeni tanımlı değil (.env dosyasını kontrol edin).');
    process.exit(1);
}

const client = new MongoClient(uri, { serverSelectionTimeoutMS: 8000 });
await client.connect();
const db = client.db(process.env.MONGO_DB_NAME || 'aura_database');

let totalFixed = 0;
let totalLost = 0;

for (const name of collections) {
    const exists = await db.listCollections({ name }).hasNext();
    if (!exists) {
        console.log(`- ${name}: koleksiyon yok, atlandı`);
        continue;
    }

    let docsFixed = 0;
    let fieldsFixed = 0;
    let lost = 0;

    const cursor = db.collection(name).find({});
    for await (const doc of cursor) {
        const stats = { fixed: 0, lost: 0 };
        const repaired = fixValue(doc, stats);

        if (stats.lost > 0) lost += stats.lost;
        if (stats.fixed > 0) {
            fieldsFixed += stats.fixed;
            docsFixed++;
            if (apply) {
                const { _id, ...rest } = repaired;
                await db.collection(name).updateOne({ _id }, { $set: rest });
            }
        }
    }

    totalFixed += fieldsFixed;
    totalLost += lost;

    const tag = apply ? 'düzeltilen alan' : 'düzeltilecek alan';
    console.log(`- ${name}: ${docsFixed} doküman / ${fieldsFixed} ${tag}, ${lost} kurtarılamayan (�) karakter`);
}

console.log(apply
    ? `Tamamlandı: ${totalFixed} alan güncellendi. Kurtarılamayan karakter: ${totalLost}`
    : `Kuru çalıştırma: ${totalFixed} alan düzeltilecek, ${totalLost} kurtarılamayan (�) karakter var. Uygulamak için --write kullanın.`);

await client.close();
