/**
 * Bot Heartbeat — Admin paneline bot'un online olduğunu bildirir.
 * 60 saniyede bir veritabanındaki bot_heartbeat tablosunu günceller.
 */

const prisma = require('./db');

async function sendHeartbeat() {
  try {
    await prisma.$executeRaw`
      INSERT INTO bot_heartbeat (id, "lastSeen", status)
      VALUES ('singleton', NOW(), 'online')
      ON CONFLICT (id) DO UPDATE SET "lastSeen" = NOW(), status = 'online'
    `;
  } catch (err) {
    // Tablo yoksa sessizce geç (admin paneli oluşturacak)
    console.warn('[HEARTBEAT] Table may not exist yet:', err.message);
  }
}

function startHeartbeat() {
  console.log('[HEARTBEAT] Started (60s interval)');
  sendHeartbeat();
  setInterval(sendHeartbeat, 60_000);
}

module.exports = { startHeartbeat };
