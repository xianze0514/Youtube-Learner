const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const context = {
  __ELT_TEST__: true,
  chrome: {
    runtime: {
      onMessage: { addListener() {} },
    },
  },
  console,
  document: {
    documentElement: { dataset: {} },
  },
  setTimeout,
  clearTimeout,
  Intl,
};
context.globalThis = context;
context.window = context;

vm.createContext(context);
vm.runInContext(
  fs.readFileSync(path.join(__dirname, "content/captions.js"), "utf8"),
  context,
);

const {
  joinCaptionText,
  mergeCuesIntoSentences,
  splitSegmentsForPractice,
} = context.__ELT_TEST_API__;
const cue = (text, startMs, endMs) => ({ text, startMs, endMs });
const texts = (cues) =>
  Array.from(mergeCuesIntoSentences(cues), (item) => item.text);
const practiceSegments = (text, startMs = 0, endMs = 15000) =>
  Array.from(
    splitSegmentsForPractice([
      { id: 0, text, startMs, endMs, hasEstimatedStart: false },
    ]),
  );
const wordCount = (text) =>
  Array.from(text.matchAll(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu)).length;

assert.equal(
  joinCaptionText("I think this is", "this is a much better way."),
  "I think this is a much better way.",
  "rolling captions should not repeat their shared words",
);

assert.deepEqual(
  texts([
    cue("Because the first subtitle", 0, 2100),
    cue("ends too early,", 2120, 3600),
    cue("the final words belong here.", 3620, 5400),
  ]),
  ["Because the first subtitle ends too early, the final words belong here."],
  "adjacent grammatical fragments should form one sentence",
);

assert.deepEqual(
  texts([
    cue("We repeated the process twenty", 0, 10800),
    cue("times.", 10900, 11600),
  ]),
  ["We repeated the process twenty times."],
  "a trailing word must not be left as its own exercise sentence",
);

assert.deepEqual(
  texts([
    cue("That approach worked.", 0, 1300),
    cue("The weather changed suddenly.", 1450, 3100),
  ]),
  ["That approach worked.", "The weather changed suddenly."],
  "complete unrelated sentences must remain separate",
);

assert.deepEqual(
  texts([
    cue("We finished the first experiment", 0, 1200),
    cue("The second experiment failed", 2050, 3300),
  ]),
  ["We finished the first experiment", "The second experiment failed"],
  "capitalization plus a real pause should separate unpunctuated sentences",
);

assert.deepEqual(
  texts([
    cue("because of the", 0, 1000),
    cue("Next topic starts here.", 2800, 4300),
  ]),
  ["because of the", "Next topic starts here."],
  "a long pause must not join unrelated material even if the first fragment is incomplete",
);

assert.deepEqual(
  texts([
    cue("Practice slowly. Then increase your speed.", 0, 3600),
  ]),
  ["Practice slowly.", "Then increase your speed."],
  "multiple sentences in one cue should split cleanly",
);

assert.deepEqual(
  texts([
    cue("This line is repeated.", 0, 1600),
    cue("This line is repeated.", 1200, 2200),
  ]),
  ["This line is repeated."],
  "overlapping duplicate subtitle events should only appear once",
);

const screenshotSentence =
  "By locking in on you for the next 600 seconds, I'm very confident that you're going to walk away with what I think is the single best hack for longevity, purpose and living the type of lives that we want to live.";
const screenshotChunks = practiceSegments(screenshotSentence, 0, 17000);
assert.ok(
  screenshotChunks.length >= 3,
  "a long beginner exercise should become several manageable chunks",
);
assert.deepEqual(
  screenshotChunks.map((segment) => segment.text),
  [
    "By locking in on you for the next 600 seconds,",
    "I'm very confident that you're going to walk away",
    "with what I think is the single best hack for longevity,",
    "purpose and living the type of lives that we want to live.",
  ],
  "the reported TED sentence should split at natural phrase and punctuation boundaries",
);
assert.ok(
  screenshotChunks.every((segment) => wordCount(segment.text) <= 14),
  "practice chunks should stay within the beginner word limit",
);
assert.equal(
  screenshotChunks.map((segment) => segment.text).join(" "),
  screenshotSentence,
  "practice splitting must preserve every word and punctuation mark",
);
assert.equal(screenshotChunks[0].startMs, 0);
assert.equal(screenshotChunks.at(-1).endMs, 17000);
for (let index = 1; index < screenshotChunks.length; index += 1) {
  assert.equal(
    screenshotChunks[index - 1].endMs,
    screenshotChunks[index].startMs,
    "estimated practice timings should remain continuous",
  );
  assert.equal(screenshotChunks[index].hasEstimatedStart, true);
}

const commaSentence =
  "I want you to spend the next 10 minutes being absurdly self-indulgent, which is advice I would almost never otherwise give people.";
assert.deepEqual(
  practiceSegments(commaSentence, 0, 10000).map((segment) => segment.text),
  [
    "I want you to spend the next 10 minutes being absurdly self-indulgent,",
    "which is advice I would almost never otherwise give people.",
  ],
  "a natural comma and clause boundary should be preferred over a period-only split",
);

assert.deepEqual(
  practiceSegments("Practice makes unfamiliar sounds feel natural.", 0, 4200).map(
    (segment) => segment.text,
  ),
  ["Practice makes unfamiliar sounds feel natural."],
  "a short exercise should remain unchanged",
);

console.log("caption segmentation tests: passed");
