// Text-based American English linking candidates, not acoustic detections.
const VOWELS = new Set([..."aeiouɑɒæɛɜɞəɚɝɪɔʊʌɐ"]);
const CONSONANTS = new Set([..."pbtdkgɡfvθðszʃʒhmnŋlrɹwj", "tʃ", "dʒ"]);
const VOICELESS = new Set(["p", "t", "k", "f", "θ"]);
const SIBILANTS = new Set(["s", "z", "ʃ", "ʒ", "tʃ", "dʒ"]);

export function phonemes(ipa) {
  const clean = ipa.replace(/[\sˈˌˑ().]/gu, "");
  const result = clean.match(/tʃ|dʒ|eɪ|aɪ|ɔɪ|aʊ|oʊ|əʊ|ɪə|eə|ʊə|.ː|./gu) || [];
  return result.every(p => CONSONANTS.has(p) || VOWELS.has(p[0])) ? result : [];
}

export function parsePronunciations(entry, word) {
  if (String(entry?.word || "").toLowerCase() !== word) return [];
  const text = entry.phonetics?.find(item => item.label === "美")?.text || "";
  const content = text.match(/\[([^\]]+)\]/u)?.[1];
  if (!content) return []; // Audio buttons without IPA are not pronunciation data.
  return content.split(/[;；]/u).map(s => s.trim()).filter(s => phonemes(s).length);
}

export function tokenize(text) {
  return [...text.matchAll(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu)].map(m => ({
    word: m[0].toLowerCase().replace(/’/gu, "'"), start: m.index, end: m.index + m[0].length,
  }));
}

export function findLinkingCandidates(text, pronunciations) {
  const words = tokenize(text);
  return words.slice(0, -1).flatMap((left, i) => {
    const right = words[i + 1];
    if (!/^\s+$/u.test(text.slice(left.end, right.start))) return [];
    const a = pronunciations.get(left.word), b = pronunciations.get(right.word);
    if (!a?.length || !b?.length) return [];
    // All listed variants must agree about the C→V boundary. Do not guess a
    // context-dependent pronunciation or confuse spelling with the first sound.
    if (!a.every(ipa => CONSONANTS.has(phonemes(ipa).at(-1))) ||
        !b.every(ipa => VOWELS.has(phonemes(ipa)[0]?.[0]))) return [];
    return [{ leftStart: left.start, leftEnd: left.end, rightStart: right.start, rightEnd: right.end }];
  });
}

export function inflectionCandidates(word) {
  // Only regular morphology. An unknown form remains unknown when no exact
  // dictionary lemma is found; do not substitute spelling-based phonemes.
  const result = [];
  if (/^[a-z]+'s$/u.test(word)) result.push({ base: word.slice(0, -2), suffix: "s" });
  else if (word.endsWith("s") && !/(ss|us|is)$/u.test(word)) {
    if (word.endsWith("ies")) result.push({ base: word.slice(0, -3) + "y", suffix: "s" });
    result.push({ base: word.slice(0, -1), suffix: "s" });
    if (word.endsWith("es")) result.push({ base: word.slice(0, -2), suffix: "s" });
  } else if (word.endsWith("ed")) {
    if (word.endsWith("ied")) result.push({ base: word.slice(0, -3) + "y", suffix: "ed" });
    result.push({ base: word.slice(0, -1), suffix: "ed" }, { base: word.slice(0, -2), suffix: "ed" });
    if (/([b-df-hj-np-tv-z])\1ed$/u.test(word)) result.push({ base: word.slice(0, -3), suffix: "ed" });
  }
  return result.filter((item, i) => item.base.length >= 2 && result.findIndex(x => x.base === item.base) === i);
}

export function addInflection(ipa, suffix) {
  const last = phonemes(ipa).at(-1);
  if (!last) return "";
  if (suffix === "ed") return ipa + (["t", "d"].includes(last) ? "ɪd" :
    VOICELESS.has(last) || ["s", "ʃ", "tʃ"].includes(last) ? "t" : "d");
  return ipa + (SIBILANTS.has(last) ? "ɪz" : VOICELESS.has(last) ? "s" : "z");
}

export async function resolvePronunciations(word, lookup) {
  if (!/^[a-z]+(?:'[a-z]+)?$/u.test(word)) return [];
  const direct = await lookup(word);
  if (direct.length) return direct;
  const contraction = word.match(/^(i|you|we|they|he|she|it|that|there|who)'(ve|re|ll|m|d)$/u);
  if (contraction) {
    const base = await lookup(contraction[1]);
    const tail = { ve: "v", re: "r", ll: "l", m: "m", d: "d" }[contraction[2]];
    return base.map(ipa => ipa + tail);
  }
  for (const { base, suffix } of inflectionCandidates(word)) {
    const found = await lookup(base);
    if (found.length) return found.map(ipa => addInflection(ipa, suffix)).filter(Boolean);
  }
  return [];
}
