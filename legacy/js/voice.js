/* Web Speech API wrapper — one-shot, music-safe, transcript-only.
 *
 * Why it is shaped like this (BUILD_SPEC §3):
 *  - `continuous = false` and a single recognition per explicit mic tap. Long-lived
 *    continuous listening is what makes Android duck or pause background media;
 *    short one-shot recognitions coexist with playback far better.
 *  - We never call getUserMedia and never construct an AudioContext, so the page
 *    does not take an audio focus of its own.
 *  - We only ever receive a transcript string. No MediaRecorder, no Blob, no
 *    IndexedDB write of anything audio-shaped. There is nothing to discard because
 *    nothing is ever captured — which is the strongest form of "audio is discarded".
 *  - Recognition is aborted the moment a result arrives, or after LISTEN_TIMEOUT_MS,
 *    so the mic is never held open longer than one phrase.
 *  - Every failure path resolves to the tap-to-text fallback in views/today.js.
 */

export const LISTEN_TIMEOUT_MS = 8000;

export const VoiceError = {
  UNSUPPORTED: 'unsupported',
  NOT_ALLOWED: 'not-allowed',
  NO_SPEECH: 'no-speech',
  ABORTED: 'aborted',
  TIMEOUT: 'timeout',
  FAILED: 'failed'
};

export const ERROR_MESSAGES = {
  [VoiceError.UNSUPPORTED]: 'Voice input is not available in this browser — type the set instead.',
  [VoiceError.NOT_ALLOWED]: 'Microphone access was blocked. Allow it in site settings, or type the set instead.',
  [VoiceError.NO_SPEECH]: "Didn't catch that — try again, or type the set instead.",
  [VoiceError.ABORTED]: 'Listening stopped.',
  [VoiceError.TIMEOUT]: 'Stopped listening — try again, or type the set instead.',
  [VoiceError.FAILED]: 'Voice input failed — type the set instead.'
};

function getRecognitionCtor() {
  return globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition || null;
}

export function isSupported() {
  return Boolean(getRecognitionCtor());
}

export class VoiceInputError extends Error {
  constructor(code) {
    super(ERROR_MESSAGES[code] || ERROR_MESSAGES[VoiceError.FAILED]);
    this.name = 'VoiceInputError';
    this.code = code;
  }
}

/**
 * Listens for exactly one phrase. Must be called from a user gesture.
 * @param {{lang?: string, timeoutMs?: number, onStart?: Function, onEnd?: Function}} options
 * @returns {Promise<{transcript: string, confidence: number, alternatives: string[]}>}
 */
export function listenOnce({ lang, timeoutMs = LISTEN_TIMEOUT_MS, onStart, onEnd } = {}) {
  const Ctor = getRecognitionCtor();
  if (!Ctor) return Promise.reject(new VoiceInputError(VoiceError.UNSUPPORTED));

  return new Promise((resolve, reject) => {
    const recognition = new Ctor();
    recognition.lang = lang || navigator.language || 'en-GB';
    recognition.continuous = false;      // one phrase, then release the mic
    recognition.interimResults = false;  // we only want the final transcript
    recognition.maxAlternatives = 3;

    let settled = false;
    let timer = null;

    const cleanup = () => {
      clearTimeout(timer);
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      recognition.onstart = null;
      onEnd?.();
    };

    const succeed = (payload) => {
      if (settled) return;
      settled = true;
      cleanup();
      try { recognition.abort(); } catch { /* already stopped */ }
      resolve(payload);
    };

    const fail = (code) => {
      if (settled) return;
      settled = true;
      cleanup();
      try { recognition.abort(); } catch { /* already stopped */ }
      reject(new VoiceInputError(code));
    };

    recognition.onstart = () => { onStart?.(); };

    recognition.onresult = (event) => {
      const result = event.results?.[0];
      if (!result || !result.length) return fail(VoiceError.NO_SPEECH);
      const alternatives = Array.from(result).map((alt) => alt.transcript.trim()).filter(Boolean);
      succeed({
        transcript: alternatives[0] || '',
        confidence: Number(result[0].confidence) || 0,
        alternatives
      });
    };

    recognition.onerror = (event) => {
      const code = {
        'not-allowed': VoiceError.NOT_ALLOWED,
        'service-not-allowed': VoiceError.NOT_ALLOWED,
        'no-speech': VoiceError.NO_SPEECH,
        aborted: VoiceError.ABORTED
      }[event.error] || VoiceError.FAILED;
      fail(code);
    };

    recognition.onend = () => { if (!settled) fail(VoiceError.NO_SPEECH); };

    timer = setTimeout(() => fail(VoiceError.TIMEOUT), timeoutMs);

    try {
      recognition.start();
    } catch {
      fail(VoiceError.FAILED);
    }
  });
}
