import { MongoClient } from 'mongodb';
import { logger } from '../utils/logger.js';
import { createMongoFirestoreAdapter } from './mongoAdapter.js';

let db;
let mongoClient;

async function connectMongoWithRetry(mongoUrl, maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            logger.info(`📦 MongoDB bağlantısı kuruluyor... (Deneme ${attempt}/${maxRetries})`);
            const client = new MongoClient(mongoUrl, {
                maxPoolSize: 10,
                serverSelectionTimeoutMS: 8000,
                connectTimeoutMS: 10000
            });
            await client.connect();
            return client;
        } catch (err) {
            logger.warn(`[MongoDB] Deneme ${attempt} başarısız: ${err.message}`);
            if (attempt === maxRetries) throw err;
            await new Promise((res) => setTimeout(res, 2000));
        }
    }
}

export async function connectDatabase() {
    if (db) return db;

    if (!process.env.MONGO_URL) {
        throw new Error('MONGO_URL ortam değişkeni tanımlı değil!');
    }

    mongoClient = await connectMongoWithRetry(process.env.MONGO_URL);

    let dbName = process.env.MONGO_DB_NAME || 'aura_database';

    const mongoDb = mongoClient.db(dbName);
    db = createMongoFirestoreAdapter(mongoDb);
    logger.info(`✅ MongoDB veritabanı bağlantısı kuruldu (db: ${dbName})`);
    return db;
}

export function getFirestore() {
    if (!db) {
        throw new Error('Veritabanı henüz bağlanmadı! connectDatabase() çağırın.');
    }
    return db;
}
