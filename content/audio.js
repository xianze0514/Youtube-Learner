(() => {
  const TYPING_SOUND_MASTER_GAIN = 2.4;

  function createAudioController(state) {
  function playTypingSound(kind) {
    if (!state.soundEnabled) return;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;

    if (!state.typingAudioContext) {
      state.typingAudioContext = new AudioContextClass();
      state.typingAudioMasterGain = state.typingAudioContext.createGain();
      state.typingAudioMasterGain.gain.value = TYPING_SOUND_MASTER_GAIN;
      state.typingAudioMasterGain.connect(state.typingAudioContext.destination);
    }
    const context = state.typingAudioContext;
    if (context.state === "suspended") {
      void context.resume().catch(() => {});
    }

    const now = context.currentTime;
    if (kind === "key") {
      playMechanicalKeySound(context, now, 0.026);
      return;
    }
    if (kind === "delete") {
      playTone(context, now, 310, 0.035, 0.022, "triangle", 250);
      return;
    }
    if (kind === "wrong") {
      playTone(context, now, 190, 0.13, 0.05, "square", 135);
      return;
    }
    if (kind === "word") {
      playTone(context, now, 660, 0.075, 0.025, "sine", 760);
      return;
    }

    playTone(context, now, 523.25, 0.1, 0.035, "sine", 587.33);
    playTone(context, now + 0.085, 659.25, 0.12, 0.032, "sine", 783.99);
  }

  function playMechanicalKeySound(context, startTime, volume) {
    const duration = 0.032;
    const length = Math.max(1, Math.floor(context.sampleRate * duration));
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const samples = buffer.getChannelData(0);
    for (let index = 0; index < length; index += 1) {
      const envelope = 1 - index / length;
      samples[index] = (Math.random() * 2 - 1) * envelope;
    }

    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    filter.type = "highpass";
    filter.frequency.setValueAtTime(1350, startTime);
    gain.gain.setValueAtTime(volume, startTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
    source.buffer = buffer;
    source
      .connect(filter)
      .connect(gain)
      .connect(state.typingAudioMasterGain || context.destination);
    source.start(startTime);
    source.stop(startTime + duration);
  }

  function playTone(
    context,
    startTime,
    frequency,
    duration,
    volume,
    waveform,
    endFrequency,
  ) {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = waveform;
    oscillator.frequency.setValueAtTime(frequency, startTime);
    if (endFrequency) {
      oscillator.frequency.exponentialRampToValueAtTime(
        endFrequency,
        startTime + duration,
      );
    }
    gain.gain.setValueAtTime(volume, startTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
    oscillator
      .connect(gain)
      .connect(state.typingAudioMasterGain || context.destination);
    oscillator.start(startTime);
    oscillator.stop(startTime + duration);
  }


    return Object.freeze({ playTypingSound });
  }

  const namespace = (globalThis.EnglishListeningTyping ||= {});
  namespace.createAudioController = createAudioController;
})();
