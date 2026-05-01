const prisma = require('./db');

async function sendHeartbeat() {
  try {
    await prisma.botHeartbeat.upsert({
      where: { id: 'singleton' },
      update: { lastSeen: new Date(), status: 'online' },
      create: { id: 'singleton', lastSeen: new Date(), status: 'online' },
    });
  } catch (err) {
    console.warn('[HEARTBEAT] Error:', err.message);
  }
}

function startHeartbeat() {
  console.log('[HEARTBEAT] Started (60s interval)');
  sendHeartbeat();
  setInterval(sendHeartbeat, 60_000);
}

module.exports = { startHeartbeat };