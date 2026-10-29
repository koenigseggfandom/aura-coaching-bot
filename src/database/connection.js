import admin from 'firebase-admin';
import { MongoClient } from 'mongodb';
import { logger } from '../utils/logger.js';
import { createMongoFirestoreAdapter } from './mongoAdapter.js';

let db;
let mongoClient;

function detectKeyType(rawKey) {
    if (/-----BEGIN RSA PRIVATE KEY-----/.test(rawKey)) return 'RSA';
    if (/-----BEGIN PRIVATE KEY-----/.test(rawKey)) return 'PKCS8';
    return 'UNKNOWN';
}

function minimallyNormalizePrivateKey(rawKey) {
    if (!rawKey) return rawKey;
    let key = String(rawKey);
    if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) {
        key = key.slice(1, -1);
    }
    key = key.trim();
    key = key.replace(/\\n/g, '\n');
    key = key.replace(/\\r/g, '\r');
    key = key.replace(/\r\n/g, '\n');
    key = key.replace(/\r/g, '\n');
    key = key.trim() + '\n';
    return key;
}

function aggressivelyNormalizePrivateKey(rawKey) {
    if (!rawKey) return rawKey;

    let key = String(rawKey);
    if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) {
        key = key.slice(1, -1);
    }
    key = key.trim();
    key = key.replace(/\\n/g, '\n');
    key = key.replace(/\\r/g, '\r');
    key = key.replace(/\r\n/g, '\n');
    key = key.replace(/\r/g, '\n');

    const keyType = detectKeyType(key);
    const header = keyType === 'RSA' ? '-----BEGIN RSA PRIVATE KEY-----' : '-----BEGIN PRIVATE KEY-----';
    const footer = keyType === 'RSA' ? '-----END RSA PRIVATE KEY-----' : '-----END PRIVATE KEY-----';

    const base64Content = key
        .replace(/-----BEGIN (?:RSA )?PRIVATE KEY-----/g, '')
        .replace(/-----END (?:RSA )?PRIVATE KEY-----/g, '')
        .replace(/\s+/g, '')
        .trim();

    if (!base64Content) {
        throw new Error('Private key Base64 içeriği boş veya geçersiz');
    }

    const lineLength = 64;
    const lines = [];
    for (let i = 0; i < base64Content.length; i += lineLength) {
        lines.push(base64Content.slice(i, i + lineLength));
    }

    return `${header}\n${lines.join('\n')}\n${footer}\n`;
}

function tryBuildCredential(serviceAccount) {
    const aggressive = { ...serviceAccount };
    const minimal = { ...serviceAccount };

    if (aggressive.private_key) {
        try {
            aggressive.private_key = aggressivelyNormalizePrivateKey(aggressive.private_key);
            logger.info('✅ Private key aggressively formatted (attempt 1)');
            const cred = admin.credential.cert(aggressive);
            try {
                cred.getAccessToken();
            } catch (_) {}
            return { cred, account: aggressive, method: 'aggressive' };
        } catch (firstErr) {
            logger.warn('[PK] Agresif formatlama başarısız, minimal deneniyor: ' + firstErr.message);
        }
    }

    if (minimal.private_key) {
        try {
            minimal.private_key = minimallyNormalizePrivateKey(minimal.private_key);
            logger.info('✅ Private key minimally formatted (fallback)');
            const cred = admin.credential.cert(minimal);
            return { cred, account: minimal, method: 'minimal' };
        } catch (secondErr) {
            logger.error('[PK] Minimal formatlama da başarısız: ' + secondErr.message);
            throw secondErr;
        }
    }

    const cred = admin.credential.cert(serviceAccount);
    return { cred, account: serviceAccount, method: 'raw' };
}

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
    if (db) {
        return db;
    }

    // 1. Önce MONGO_URL kontrolü yap (Railway MongoDB)
    if (process.env.MONGO_URL) {
        try {
            mongoClient = await connectMongoWithRetry(process.env.MONGO_URL);

            let dbName = 'aura_database';
            try {
                const urlObj = new URL(process.env.MONGO_URL.replace('mongodb://', 'http://').replace('mongodb+srv://', 'http://'));
                const pathName = urlObj.pathname.replace(/^\//, '');
                if (pathName && pathName !== 'railway' && pathName !== 'admin') {
                    dbName = pathName;
                }
            } catch (_) {}

            if (process.env.MONGO_DB_NAME) {
                dbName = process.env.MONGO_DB_NAME;
            }

            const mongoDb = mongoClient.db(dbName);
            db = createMongoFirestoreAdapter(mongoDb);
            logger.info(`✅ MongoDB veritabanı bağlantısı kuruldu (db: ${dbName})`);
            return db;
        } catch (mongoErr) {
            logger.warn(`⚠️ MongoDB bağlantısı kurulamadı: ${mongoErr.message}. Firebase deneniyor...`);
        }
    }

    // 2. MONGO_URL yoksa veya MongoDB bağlanamazsa Firebase Firestore'a bağlan
    try {
        if (admin.apps.length > 0) {
            db = admin.firestore();
            return db;
        }

        let serviceAccount;
        if (process.env.FIREBASE_SERVICE_ACCOUNT) {
            const rawAccount = process.env.FIREBASE_SERVICE_ACCOUNT;
            try {
                serviceAccount = JSON.parse(rawAccount);
            } catch (firstErr) {
                try {
                    const unquoted = rawAccount.trim().replace(/^['"]/, '').replace(/['"]$/, '');
                    serviceAccount = JSON.parse(unquoted);
                } catch (secondErr) {
                    try {
                        const escaped = rawAccount
                            .replace(/\r\n/g, '\\n')
                            .replace(/\n/g, '\\n')
                            .replace(/\t/g, '\\t');
                        serviceAccount = JSON.parse(escaped);
                    } catch (thirdErr) {
                        logger.error('FIREBASE_SERVICE_ACCOUNT JSON olarak parse edilemedi: ' + firstErr.message);
                        throw firstErr;
                    }
                }
            }
        } else if (process.env.FIREBASE_PRIVATE_KEY) {
            serviceAccount = {
                type: 'service_account',
                project_id: process.env.FIREBASE_PROJECT_ID,
                private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
                private_key: process.env.FIREBASE_PRIVATE_KEY,
                client_email: process.env.FIREBASE_CLIENT_EMAIL,
                client_id: process.env.FIREBASE_CLIENT_ID,
                auth_uri: 'https://accounts.google.com/o/oauth2/auth',
                token_uri: 'https://oauth2.googleapis.com/token',
                auth_provider_x509_cert_url: 'https://www.googleapis.com/oauth2/v1/certs',
                client_x509_cert_url: process.env.FIREBASE_CLIENT_X509_CERT_URL
            };
        } else {
            throw new Error('Veritabanı bilgisi bulunamadı (ne MONGO_URL ne Firebase credentials)');
        }

        for (const key in serviceAccount) {
            if (typeof serviceAccount[key] === 'string') {
                serviceAccount[key] = serviceAccount[key].trim();
            }
        }

        const { cred, method } = tryBuildCredential(serviceAccount);
        logger.info(`🔐 Private key format seçildi: ${method}`);

        admin.initializeApp({ credential: cred });

        db = admin.firestore();
        logger.info('✅ Firebase Firestore bağlantısı kuruldu');
        return db;
    } catch (error) {
        logger.error('Veritabanı bağlantı hatası: ' + error.message);
        throw error;
    }
}

export function getFirestore() {
    if (!db) {
        throw new Error('Veritabanı henüz bağlanmadı! connectDatabase() çağırın.');
    }
    return db;
}
