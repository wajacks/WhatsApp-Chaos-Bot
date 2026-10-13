const voiceSelections = new Map();

const EDGE_TTS_VOICES = {
    male: {
        name: 'American Male',
        voice: 'en-US-GuyNeural'
    },

    female: {
        name: 'American Female',
        voice: 'en-US-JennyNeural'
    },

    aria: {
        name: 'American Female - Aria',
        voice: 'en-US-AriaNeural'
    },

    british: {
        name: 'British Female',
        voice: 'en-GB-SoniaNeural'
    },

    britishmale: {
        name: 'British Male',
        voice: 'en-GB-RyanNeural'
    },

    kenya: {
        name: 'Kenyan Female',
        voice: 'en-KE-AsiliaNeural'
    },

    kenyanmale: {
        name: 'Kenyan Male',
        voice: 'en-KE-ChilembaNeural'
    },

    indian: {
        name: 'Indian Female',
        voice: 'en-IN-NeerjaNeural'
    },

    indianmale: {
        name: 'Indian Male',
        voice: 'en-IN-PrabhatNeural'
    }
};

const DEFAULT_EDGE_VOICE = 'female';
const VOICE_COOLDOWN_MS = 8000;

const speakCooldowns = new Map();
const voiceCooldowns = new Map();

module.exports = { voiceSelections, EDGE_TTS_VOICES, DEFAULT_EDGE_VOICE, VOICE_COOLDOWN_MS, speakCooldowns, voiceCooldowns };
