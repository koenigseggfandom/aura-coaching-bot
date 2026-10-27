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

export async function connectDatabase() {
    try {
        if (db) {
            return db;
        }

        // 1. Önce MONGO_URL kontrolü yap (Railway MongoDB)
        if (process.env.MONGO_URL) {
            logger.info('📦 MONGO_URL tespit edildi, MongoDB bağlantısı kuruluyor...');
            mongoClient = new MongoClient(process.env.MONGO_URL, {
                maxPoolSize: 10,
                serverSelectionTimeoutMS: 10000
            });
            await mongoClient.connect();
            const urlObj = new URL(process.env.MONGO_URL.replace('mongodb://', 'http://').replace('mongodb+srv://', 'http://'));
            const dbName = urlObj.pathname.replace(/^\//, '') || 'aura_database';
            const mongoDb = mongoClient.db(dbName);
            db = createMongoFirestoreAdapter(mongoDb);
            logger.info(`✅ MongoDB veritabanı bağlantısı kuruldu (db: ${dbName})`);
            return db;
        }

        // 2. MONGO_URL yoksa Firebase Firestore'a bağlan
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
                        logger.error('FIREBASE_SERVICE_ACCOUNT JSON olarak parse edilemedi. Lütfen tüm satırların tek string oldugundan emin olun: ' + firstErr.message);
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
            throw new Error('Firebase credentials not found in .env');
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
        logger.error('Firebase bağlantı hatası: ' + error.message);
        throw error;
    }
}

export function getFirestore() {
    if (!db) {
        throw new Error('Veritabanı henüz bağlanmadı! connectDatabase() çağırın.');
    }
    return db;
}
