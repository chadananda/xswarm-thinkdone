// Speech interaction profiles — pairs a TTS + STT provider into a single selectable profile.
// Pure data module. No side effects, no browser/server dependencies.
//
// costPerHour: estimated USD per hour of conversation (used for sorting + display)
// costTier: 0=Free, 1=$, 2=$$, 3=$$$ (visual shorthand)
// Sorted cheapest-first.

export const SPEECH_PROFILES = [
  {
    id: 'browser-native',
    name: 'Browser Native',
    icon: '\uD83D\uDCBB',
    tts: { provider: 'Web Speech API', description: 'Built-in browser synthesis' },
    stt: { provider: 'Web Speech API', description: 'Built-in browser recognition' },
    costPerHour: 0,
    costTier: 0,
    available: true,
  },
  {
    id: 'gemini-live',
    name: 'Gemini Live',
    icon: '\u2756',
    tts: { provider: 'Gemini Live', description: 'Speech-to-speech, native multimodal' },
    stt: { provider: 'Gemini Live', description: 'Speech-to-speech, native multimodal' },
    costPerHour: 0.20,
    costTier: 1,
    available: true,
    s2s: true,
  },
  {
    id: 'whisper-direct',
    name: 'OpenAI Whisper',
    icon: '\u25CE',
    tts: { provider: 'Web Speech API', description: 'Built-in browser synthesis' },
    stt: { provider: 'OpenAI Whisper', description: 'High-accuracy transcription' },
    costPerHour: 0.36,
    costTier: 1,
    available: true,
  },
  {
    id: 'deepgram',
    name: 'Deepgram',
    icon: '\u25C9',
    tts: { provider: 'Browser TTS', description: 'Built-in browser synthesis' },
    stt: { provider: 'Deepgram Nova-2', description: 'Fast streaming transcription' },
    costPerHour: 0.42,
    costTier: 1,
    available: true,
  },
  {
    id: 'google-cloud-speech',
    name: 'Google Cloud',
    icon: '\u2726',
    tts: { provider: 'Google Cloud TTS', description: 'WaveNet & Neural2 voices' },
    stt: { provider: 'Google Cloud STT', description: 'Streaming recognition' },
    costPerHour: 1.32,
    costTier: 2,
    available: true,
  },
  {
    id: 'playht-whisper',
    name: 'PlayHT + Whisper',
    icon: '\u25B6',
    tts: { provider: 'PlayHT', description: 'Ultra-realistic voices' },
    stt: { provider: 'OpenAI Whisper', description: 'High-accuracy transcription' },
    costPerHour: 1.56,
    costTier: 2,
    available: true,
  },
  {
    id: 'azure-speech',
    name: 'Azure Speech',
    icon: '\u25A3',
    tts: { provider: 'Azure TTS', description: 'Neural voices with SSML' },
    stt: { provider: 'Azure STT', description: 'Continuous recognition' },
    costPerHour: 1.56,
    costTier: 2,
    available: true,
  },
  {
    id: 'amazon-polly',
    name: 'Amazon Polly + Transcribe',
    icon: '\u25EC',
    tts: { provider: 'AWS Polly', description: 'Neural & standard voices' },
    stt: { provider: 'AWS Transcribe', description: 'Real-time transcription' },
    costPerHour: 1.68,
    costTier: 2,
    available: true,
  },
  {
    id: 'elevenlabs-direct',
    name: 'ElevenLabs',
    icon: '\u2261',
    tts: { provider: 'ElevenLabs', description: 'Premium neural voices' },
    stt: { provider: 'Web Speech API', description: 'Built-in browser recognition' },
    costPerHour: 1.80,
    costTier: 2,
    available: true,
  },
  {
    id: 'openai-realtime-mini',
    name: 'OpenAI Realtime Mini',
    icon: '\u25CE',
    tts: { provider: 'OpenAI Realtime', description: 'Speech-to-speech, GPT-4o-mini voice' },
    stt: { provider: 'OpenAI Realtime', description: 'Speech-to-speech, GPT-4o-mini voice' },
    costPerHour: 2.00,
    costTier: 2,
    available: true,
    s2s: true,
  },
  {
    id: 'elevenlabs-whisper',
    name: 'ElevenLabs + Whisper',
    icon: '\u2261',
    tts: { provider: 'ElevenLabs', description: 'Premium neural voices' },
    stt: { provider: 'OpenAI Whisper', description: 'High-accuracy transcription' },
    costPerHour: 2.16,
    costTier: 3,
    available: true,
  },
];

export const SPEECH_PROFILE_MAP = Object.fromEntries(
  SPEECH_PROFILES.map(p => [p.id, p])
);

export const DEFAULT_SPEECH_PROFILE = 'browser-native';
