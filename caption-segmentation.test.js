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
  fs.readFileSync(path.join(__dirname, "content.js"), "utf8"),
  context,
);

const { joinCaptionText, mergeCuesIntoSentences } = context.__ELT_TEST_API__;
const cue = (text, startMs, endMs) => ({ text, startMs, endMs });
const texts = (cues) =>
  Array.from(mergeCuesIntoSentences(cues), (item) => item.text);

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

console.log("caption segmentation tests: passed");
