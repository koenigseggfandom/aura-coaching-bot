module.exports = {
  name: 'ready',
  once: true,
  async execute(client) {
    console.log(`[BOT] Ready! Logged in as ${client.user.tag}`);
    client.user.setPresence({
      activities: [{ name: '🎮 AURA Coaching | /yardım', type: 0 }],
      status: 'online',
    });
  },
};
