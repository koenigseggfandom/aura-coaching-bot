const { handleVoiceUpdate } = require('../utils/voiceTracker');

module.exports = {
  name: 'voiceStateUpdate',
  async execute(oldState, newState, client) {
    await handleVoiceUpdate(oldState, newState, client);
  },
};
