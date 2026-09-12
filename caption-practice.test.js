const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const context = { __ELT_TEST__: true, Intl, console, setTimeout, clearTimeout };
context.globalThis = context;
context.window = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, "content/captions.js"), "utf8"), context);
const { buildPracticeSegments: build, splitAtTimedSentenceBoundaries: split,
  calibratePracticeTimings: calibrate, parseCaptionBody,
  collectTimedTokens, getCompletedSentence } = context.__ELT_TEST_API__;
const cue = (text, startMs, endMs, tokens = []) => ({ text, startMs, endMs, tokens });
const plain = (value) => JSON.parse(JSON.stringify(value));

// TED 8KkKuTCFvzI, 1:44–2:04. 人工 cue 的从句、短片段和专名均保持原边界。
const ted = [
  cue("What if we could study people from the time that they were teenagers", 104088, 108048),
  cue("all the way into old age", 108088, 110838),
  cue("to see what really keeps people happy and healthy?", 110838, 114213),
  cue("We did that.", 115548, 116756),
  cue("The Harvard Study of Adult Development", 117631, 119881),
  cue("may be the longest study of adult life that's ever been done.", 119881, 124631),
];
const before = JSON.stringify(ted);
const practice = build(ted);
assert.deepEqual(plain(practice.map(({ text, startMs, endMs }) => ({ text, startMs, endMs }))),
  ted.map(({ text, startMs, endMs }) => ({ text, startMs, endMs })));
assert.equal(JSON.stringify(ted), before, "source cues must not be mutated");
assert.equal(practice[0].sentence.id, practice[2].sentence.id);
assert.notEqual(practice[2].sentence.id, practice[3].sentence.id);
assert.equal(getCompletedSentence(practice, 1, new Set([0, 1])), null, "future answers stay hidden");
assert.equal(getCompletedSentence(practice, 2, new Set([0, 1, 2])).text,
  ted.slice(0, 3).map(x => x.text).join(" "));
assert.equal(getCompletedSentence(practice, 3, new Set([3])), null, "no redundant single-cue context");
assert.deepEqual(plain(practice[4].sourceCues), [{ index: 4, text: ted[4].text, startMs: 117631, endMs: 119881 }]);

const repeated = [cue("I said very", 0, 1000), cue("very clearly.", 1000, 2000)];
assert.equal(build(repeated).map(x => x.text).join(" "), "I said very very clearly.");
assert.equal(build([cue("Try the exercise", 0, 1800), cue("again.", 1820, 2200)]).length, 1);
assert.equal(build([cue("Try the exercise", 0, 1800), cue("again.", 4000, 4400)]).length, 2);
assert.equal(build([cue("Stop.", 0, 500), cue("Go now.", 550, 1000)]).length, 2);
assert.equal(build([cue("(Laughter)", 0, 1000), cue("Hello there.", 2000, 3000)]).length, 1);
assert.equal(build([cue("a", NaN, 200), cue("b", 500, 400)]).length, 0);

const rolling = [cue("I think this is", 0, 1800), cue("this is a good idea.", 1200, 3000)];
assert.equal(build(rolling, { isAutomatic: true })[0].text, "I think this is a good idea.");
assert.equal(build(rolling)[0].text, "I think this is", "manual cues do not use rolling dedup");
const timedRolling = [rolling[0], { ...rolling[1], tokens:
  ["this", "is", "a", "good", "idea"].map((text, index) => ({
    text, startMs: 1200 + index * 300, endMs: 1500 + index * 300,
  })) }];
assert.deepEqual(plain(build(timedRolling, { isAutomatic: true }).map(x => [x.text, x.startMs, x.endMs])),
  [["I think this is", 0, 1800], ["a good idea.", 1800, 3000]]);

const multiple = build([cue("Listen first. Then speak clearly.", 0, 5000)]);
assert.equal(split(multiple, []).length, 1, "no word timings means no invented internal cut");
const words = ["Listen", "first", "Then", "speak", "clearly"].map((text, index) => ({
  text, startMs: index * 1000, endMs: (index + 1) * 1000,
}));
const aligned = split(multiple, collectTimedTokens([{ tokens: words }]));
assert.deepEqual(plain(aligned.map(x => [x.text, x.startMs, x.endMs])), [
  ["Listen first.", 0, 2000], ["Then speak clearly.", 2000, 5000],
]);
assert.equal(split(multiple, collectTimedTokens([{ tokens: words.slice(0, 2) }])).length, 1,
  "partial alignment must fall back to the original cue");
const estimated = words.map((word, index) => ({ ...word, hasEstimatedStart: index === 2 }));
assert.equal(split(multiple, collectTimedTokens([{ tokens: estimated }])).length, 1,
  "interpolated token offsets cannot certify a split");
const long = build([cue("A complete and naturally flowing thought can remain longer than fourteen words when no reliable internal timing is available.", 0, 12000)]);
assert.equal(split(long, []).length, 1);
assert.equal(long[0].hasEstimatedStart, false);

// eIho2S0ZahI: real manual/ASR JSON3 offsets, fetched from YouTube during diagnosis.
// The fourth subtitle appears at 21.093s, but its first word starts at 20.400s.
context.document = { createElement: () => ({ set innerHTML(value) { this.value = value; } }) };
const speakingManual = { events: [
  { tStartMs: 18610, dDurationMs: 2459, segs: [{ utf8: "It's the most powerful sound in the world, probably." }] },
  { tStartMs: 21093, dDurationMs: 2823, segs: [{ utf8: 'It\'s the only one that can start a war or say "I love you."' }] },
] };
const event = (tStartMs, dDurationMs, words) => ({ tStartMs, dDurationMs,
  segs: words.map(([utf8, tOffsetMs]) => ({ utf8, tOffsetMs })) });
const speakingAsr = { events: [
  event(18480, 2559, [["it's", 0], [" the", 240], [" most", 320], [" powerful", 559], [" sound", 879], [" in", 1120], [" the", 1200]]),
  event(19760, 2320, [["world", 0], [" probably", 240], [" it's", 640], [" the", 800], [" only", 880], [" one", 1040], [" that", 1200]]),
  event(21039, 3681, [["can", 0], [" start", 240], [" a", 481], [" war", 641]]),
  event(22080, 4400, [["or", 0], [" say", 240], [" i", 560], [" love", 720], [" you", 959], [" and", 1840], [" yet", 2000], [" many", 2240], [" people", 2480]]),
] };
const speakingSource = build(parseCaptionBody(JSON.stringify(speakingManual)));
const speakingSourceBefore = JSON.stringify(speakingSource);
const speakingTokens = collectTimedTokens(parseCaptionBody(JSON.stringify(speakingAsr)));
const speakingFixed = split(calibrate(speakingSource, speakingTokens), speakingTokens);
assert.deepEqual(plain(speakingFixed.map(x => [x.startMs, x.endMs])), [[18480, 20400], [20400, 23920]]);
assert.deepEqual(plain(speakingFixed.map(x => x.text)), plain(speakingSource.map(x => x.text)));
assert.equal(JSON.stringify(speakingSource), speakingSourceBefore, "keep original timing/provenance immutable");
assert.equal(speakingFixed[1].sourceCues[0].startMs, 21093);
assert.equal(speakingFixed[1].sentence.startMs, 20400, "context must use corrected times");
assert.equal(speakingFixed[1].sentence.endMs, 23920);
assert.equal(calibrate(speakingSource, []), speakingSource);
assert.equal(calibrate(speakingSource, speakingTokens.slice(0, 4))[0].startMs, 18610,
  "partial word matches must not change playback timing");
const estimatedOnset = speakingTokens.map(x => ({ ...x, hasEstimatedStart: true }));
assert.ok(calibrate(speakingSource, estimatedOnset).every(x => !x.timingCalibrated));
const lateTokens = speakingTokens.map(x => ({ ...x, startMs: x.startMs + 10000, endMs: x.endMs + 10000 }));
assert.ok(calibrate(speakingSource, lateTokens).every(x => !x.timingCalibrated));
const onlyFourthTokens = speakingTokens.filter(x => x.startMs >= 20400);
assert.equal(calibrate(speakingSource, onlyFourthTokens)[1].startMs, 21093,
  "do not move a cue into an uncalibrated preceding cue");
const conflictingSource = [speakingSource[0], { ...speakingSource[1], startMs: 20100, text: "Unmatched words." }];
assert.equal(calibrate(conflictingSource, speakingTokens)[0].startMs, 18610,
  "fall back when the next unaligned cue would cut off the last matched word");
const contextSource = speakingSource.map(x => ({ ...x, sentence: { id: 0, text: "context", startMs: 18610, endMs: 23916 } }));
const contextFixed = calibrate(contextSource, speakingTokens);
assert.equal(contextFixed[0].sentence, contextFixed[1].sentence);
assert.equal(contextFixed[0].sentence.startMs, 18480);
assert.equal(contextFixed[0].sentence.endMs, 23920);

// Playback tests use a deterministic video/animation stub; no network or media required.
let frame;
const noop = () => {};
context.document = { documentElement: { dataset: {} } };
context.chrome = { runtime: { onMessage: { addListener: noop } } };
context.requestAnimationFrame = (callback) => { frame = callback; return 1; };
context.cancelAnimationFrame = () => { frame = null; };
const modules = context.EnglishListeningTyping;
modules.createAudioController = () => ({ playTypingSound: noop });
modules.createTranscriptLoader = () => ({});
modules.createDictionaryController = () => ({ closeDictionaryImmediately: noop });
modules.createRenderer = () => ({ render: noop, renderTypingState: noop, updatePlaybackProgress: noop });
vm.runInContext(fs.readFileSync(path.join(__dirname, "content/main.js"), "utf8"), context);
const api = context.__ELT_TEST_API__;
Object.assign(api.state, {
  overlay: {}, segments: practice, index: 2, typedText: "saved answer",
  completedIndices: new Set([0, 1, 2]), phase: "reviewing",
  settings: { translationEnabled: false, completionMode: "auto" },
  video: { currentTime: 0, duration: 300, ended: false, paused: true,
    pause() { this.paused = true; }, async play() { this.paused = false; } },
});
(async () => {
  assert.equal(api.getSegmentPlaybackStartMs(practice[2]), practice[2].startMs,
    "preroll must not replay the preceding contiguous cue");
  await api.replayCompletedSentence();
  assert.equal(api.state.video.currentTime, (practice[0].startMs - 120) / 1000);
  api.state.video.currentTime = practice[2].endMs / 1000;
  frame();
  assert.equal(api.state.phase, "reviewing", "context replay stays on the current exercise even in auto mode");
  assert.equal(api.state.index, 2);
  assert.equal(api.state.typedText, "saved answer");
  assert.equal(api.state.completedIndices.size, 3);
  assert.equal(api.state.playbackSegment, practice[2]);
  const originalPlay = api.state.video.play;
  const originalConsole = context.console;
  context.console = { ...console, error: noop };
  api.state.video.play = async () => { throw new Error("autoplay blocked"); };
  await api.replayCompletedSentence();
  assert.equal(api.state.phase, "reviewing", "failed context playback must allow retry");
  assert.equal(api.state.playbackSegment, practice[2]);
  assert.equal(api.state.typedText, "saved answer");
  api.state.video.play = originalPlay;
  context.console = originalConsole;
  await api.playSegment(practice.length - 1, "listening", true);
  api.skipSentence();
  assert.equal(api.state.phase, "complete");
  assert.equal(frame, null, "finishing training cancels the old playback monitor");
  api.state.segments = speakingFixed;
  await api.playSegment(0, "listening", true);
  api.state.video.currentTime = 20.4;
  frame();
  assert.equal(api.state.video.paused, true, "third cue stops before fourth cue words");
  await api.playSegment(1, "listening", true);
  assert.equal(api.state.video.currentTime, 20.4, "fourth cue starts at it's, not can");
  api.skipSentence();

  vm.runInContext(fs.readFileSync(path.join(__dirname, "content/transcript.js"), "utf8"), context);
  context.document.createElement = () => ({ set innerHTML(value) { this.value = value; } });
  const requests = [];
  context.chrome.runtime.sendMessage = async (message) => {
    requests.push(message);
    return { text: JSON.stringify({ events: ted.map(x => ({
      tStartMs: x.startMs, dDurationMs: x.endMs - x.startMs, segs: [{ utf8: x.text }],
    })) }), track: { languageCode: "en", name: { simpleText: "English" } }, clientName: "WEB" };
  };
  const loaded = await modules.createTranscriptLoader(modules.captions, noop).loadSubtitleSegments({
    videoId: "8KkKuTCFvzI", apiKey: "test-only", captionTracks: [{
      baseUrl: "https://www.youtube.com/test-only", languageCode: "en", name: { simpleText: "English" },
    }],
  });
  assert.deepEqual(plain(loaded.segments.map(x => [x.text, x.startMs, x.endMs])),
    ted.map(x => [x.text, x.startMs, x.endMs]), "actual loader must use the cue-preserving pipeline");
  assert.equal(requests.length, 2, "seek ASR timing even when every cue is already a sentence");
  assert.equal(requests[1].options.isAutomatic, true);
  requests.length = 0;
  context.chrome.runtime.sendMessage = async (message) => {
    requests.push(message);
    const automatic = message.options.isAutomatic;
    return { text: JSON.stringify(automatic ? speakingAsr : speakingManual),
      track: { languageCode: "en", ...(automatic ? { kind: "asr" } : {}) } };
  };
  const fixed = await modules.createTranscriptLoader(modules.captions, noop).loadSubtitleSegments({
    videoId: "eIho2S0ZahI", apiKey: "test-only", captionTracks: [
      { baseUrl: "https://www.youtube.com/test-only", languageCode: "en" },
      { baseUrl: "https://www.youtube.com/test-only", languageCode: "en", kind: "asr" },
    ],
  });
  assert.equal(requests.length, 2);
  assert.deepEqual(plain(fixed.segments.map(x => [x.startMs, x.endMs])), [[18480, 20400], [20400, 23920]],
    "real loader must calibrate existing sentence boundaries, not just internal splits");
  assert.match(fixed.trackLabel, /逐词校准/);
  context.chrome.runtime.sendMessage = async (message) => {
    if (message.options.isAutomatic) throw new Error("ASR unavailable");
    return { text: JSON.stringify(speakingManual), track: { languageCode: "en" } };
  };
  context.fetch = async () => ({ ok: false, status: 503 });
  context.console = { ...console, warn: noop };
  const fallback = await modules.createTranscriptLoader(modules.captions, noop).loadSubtitleSegments({
    videoId: "eIho2S0ZahI", apiKey: "test-only", captionTracks: [
      { baseUrl: "https://www.youtube.com/test-only", languageCode: "en" },
    ],
  });
  context.console = console;
  assert.deepEqual(plain(fallback.segments.map(x => [x.startMs, x.endMs])), [[18610, 21069], [21093, 23916]],
    "unavailable ASR must not prevent loading the original practice");
  assert.doesNotMatch(fallback.trackLabel, /逐词校准/);
  console.log("caption practice and playback tests: passed");
})().catch(error => { console.error(error); process.exitCode = 1; });
