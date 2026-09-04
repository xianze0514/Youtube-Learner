(() => {
  const TIMING_ALIGNMENT_WINDOW_BEFORE_MS = 2500;
  const TIMING_ALIGNMENT_WINDOW_AFTER_MS = 3500;
  const SOFT_SENTENCE_GAP_MS = 650;
  const HARD_SENTENCE_GAP_MS = 1500;
  const MAX_SENTENCE_DURATION_MS = 24000;
  const MAX_SENTENCE_CHARACTERS = 280;
  const PRACTICE_TARGET_WORDS = 11;
  const PRACTICE_MAX_WORDS = 14;
  const PRACTICE_MIN_WORDS = 5;
  const PRACTICE_MAX_CHARACTERS = 96;
  const PRACTICE_MAX_DURATION_MS = 8500;

function parseCaptionBody(body) {
  try {
    const data = JSON.parse(body);
    return parseJson3Cues(data.events || []);
  } catch {
    return parseXmlCues(body);
  }
}

function parseJson3Cues(events) {
  return events
    .filter((event) => Array.isArray(event.segs))
    .map((event) => {
      const text = cleanCaptionText(
        event.segs.map((segment) => segment.utf8 || "").join(""),
      );
      const startMs = Number(event.tStartMs) || 0;
      const durationMs = Math.max(Number(event.dDurationMs) || 0, 250);
      const endMs = startMs + durationMs;
      const hasOffsets = event.segs.some(
        (segment) =>
          Number.isFinite(Number(segment.tOffsetMs)) &&
          Number(segment.tOffsetMs) > 0,
      );
      const tokens = hasOffsets
        ? event.segs.flatMap((segment, index) => {
            const value = cleanCaptionText(segment.utf8 || "");
            if (!value) return [];

            const nextSegment = event.segs[index + 1];
            const tokenStartMs = Number.isFinite(Number(segment.tOffsetMs))
              ? startMs + Number(segment.tOffsetMs)
              : startMs;
            const tokenEndMs = Number.isFinite(Number(nextSegment?.tOffsetMs))
              ? startMs + Number(nextSegment.tOffsetMs)
              : endMs;
            const words = value.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu) ||
              value.split(/\s+/u).filter(Boolean);
            const wordDuration = Math.max(1, tokenEndMs - tokenStartMs) /
              Math.max(1, words.length);

            return words.map((word, wordIndex) => ({
              text: word,
              startMs: tokenStartMs + wordDuration * wordIndex,
              endMs: tokenStartMs + wordDuration * (wordIndex + 1),
            }));
          })
        : [];
      return { text, startMs, endMs, tokens };
    })
    .filter((cue) => cue.text);
}

function hasWordTiming(cues) {
  return cues.some((cue) => Array.isArray(cue.tokens) && cue.tokens.length > 1);
}

function collectTimedTokens(cues) {
  const tokens = cues
    .flatMap((cue) => cue.tokens || [])
    .filter(
      (token) =>
        normalizeAlignmentWord(token.text) &&
        Number.isFinite(token.startMs) &&
        Number.isFinite(token.endMs) &&
        token.endMs >= token.startMs,
    )
    .sort((left, right) => left.startMs - right.startMs);
  const unique = [];

  for (const token of tokens) {
    const previous = unique[unique.length - 1];
    const isDuplicate =
      previous &&
      normalizeAlignmentWord(previous.text) ===
        normalizeAlignmentWord(token.text) &&
      Math.abs(previous.startMs - token.startMs) <= 80;
    if (!isDuplicate) unique.push(token);
  }

  return unique.map((token, index) => ({ ...token, timingIndex: index }));
}

function applyWordTimingsToSegments(segments, timedTokens) {
  if (segments.length === 0 || timedTokens.length === 0) return segments;

  let nextTimingIndex = 0;
  const aligned = segments.map((segment) => {
    const candidates = timedTokens.filter(
      (token) =>
        token.timingIndex >= Math.max(0, nextTimingIndex - 2) &&
        token.endMs >= segment.startMs - TIMING_ALIGNMENT_WINDOW_BEFORE_MS &&
        token.startMs <= segment.endMs + TIMING_ALIGNMENT_WINDOW_AFTER_MS,
    );
    const alignment = alignSegmentWords(segment.text, candidates);
    if (!alignment) return { ...segment };

    const firstMatch = alignment.matches.find(
      (match) => match.sourceIndex === 0,
    );
    const lastSourceIndex = alignment.sourceWordCount - 1;
    const lastMatch = [...alignment.matches]
      .reverse()
      .find((match) => match.sourceIndex === lastSourceIndex);
    const finalMatch = alignment.matches[alignment.matches.length - 1];
    if (finalMatch) {
      nextTimingIndex = Math.max(nextTimingIndex, finalMatch.token.timingIndex + 1);
    }

    return {
      ...segment,
      startMs: firstMatch ? firstMatch.token.startMs : segment.startMs,
      hasExactStart: Boolean(firstMatch),
      hasEstimatedStart: firstMatch ? false : segment.hasEstimatedStart,
      alignedEndMs: lastMatch?.token.endMs,
      timingConfidence: alignment.coverage,
    };
  });

  return aligned.map((segment, index) => {
    const next = aligned[index + 1];
    let endMs = segment.endMs;
    let hasExactEnd = false;

    // 下一个句子的第一个词是最可靠的停播边界：当前句在它开始前结束，
    // 下次则从同一个时间点稍作前置播放，不会吞掉首词。
    if (
      next?.hasExactStart &&
      next.startMs > segment.startMs + 150 &&
      next.startMs <= segment.endMs + TIMING_ALIGNMENT_WINDOW_AFTER_MS
    ) {
      endMs = next.startMs;
      hasExactEnd = true;
    } else if (
      Number.isFinite(segment.alignedEndMs) &&
      segment.alignedEndMs > segment.startMs
    ) {
      endMs = segment.alignedEndMs;
      hasExactEnd = true;
    }

    const { alignedEndMs, ...cleanSegment } = segment;
    return {
      ...cleanSegment,
      endMs: Math.max(endMs, segment.startMs + 200),
      hasExactEnd,
    };
  });
}

function alignSegmentWords(text, candidateTokens) {
  const sourceWords = getAlignmentWords(text);
  if (sourceWords.length === 0 || candidateTokens.length === 0) return null;

  const rowCount = sourceWords.length + 1;
  const columnCount = candidateTokens.length + 1;
  const scores = new Float64Array(rowCount * columnCount);
  const directions = new Uint8Array(rowCount * columnCount);
  const sourceGapPenalty = 2.4;
  const timingGapPenalty = 1.15;

  for (let sourceIndex = 1; sourceIndex < rowCount; sourceIndex += 1) {
    scores[sourceIndex * columnCount] = -sourceGapPenalty * sourceIndex;
    directions[sourceIndex * columnCount] = 2;
  }

  // 自动字幕窗口前后的上下文可以免费跳过，只对句子本身要求覆盖。
  for (let timingIndex = 1; timingIndex < columnCount; timingIndex += 1) {
    scores[timingIndex] = 0;
    directions[timingIndex] = 3;
  }

  for (let sourceIndex = 1; sourceIndex < rowCount; sourceIndex += 1) {
    for (let timingIndex = 1; timingIndex < columnCount; timingIndex += 1) {
      const cell = sourceIndex * columnCount + timingIndex;
      const similarity = getWordSimilarity(
        sourceWords[sourceIndex - 1],
        normalizeAlignmentWord(candidateTokens[timingIndex - 1].text),
      );
      const diagonal =
        scores[(sourceIndex - 1) * columnCount + timingIndex - 1] +
        (similarity > 0 ? similarity : -3.2);
      const skipSource =
        scores[(sourceIndex - 1) * columnCount + timingIndex] -
        sourceGapPenalty;
      const skipTiming = scores[cell - 1] - timingGapPenalty;

      if (diagonal >= skipSource && diagonal >= skipTiming) {
        scores[cell] = diagonal;
        directions[cell] = 1;
      } else if (skipSource >= skipTiming) {
        scores[cell] = skipSource;
        directions[cell] = 2;
      } else {
        scores[cell] = skipTiming;
        directions[cell] = 3;
      }
    }
  }

  let sourceIndex = sourceWords.length;
  let timingIndex = 0;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (let index = 1; index < columnCount; index += 1) {
    const score = scores[sourceIndex * columnCount + index];
    if (score > bestScore) {
      bestScore = score;
      timingIndex = index;
    }
  }

  const matches = [];
  while (sourceIndex > 0 && timingIndex > 0) {
    const direction = directions[sourceIndex * columnCount + timingIndex];
    if (direction === 1) {
      const similarity = getWordSimilarity(
        sourceWords[sourceIndex - 1],
        normalizeAlignmentWord(candidateTokens[timingIndex - 1].text),
      );
      if (similarity > 0) {
        matches.push({
          sourceIndex: sourceIndex - 1,
          token: candidateTokens[timingIndex - 1],
        });
      }
      sourceIndex -= 1;
      timingIndex -= 1;
    } else if (direction === 2) {
      sourceIndex -= 1;
    } else if (direction === 3) {
      timingIndex -= 1;
    } else {
      break;
    }
  }
  matches.reverse();

  const coverage = matches.length / sourceWords.length;
  const requiredMatches = Math.min(3, sourceWords.length);
  if (matches.length < requiredMatches || coverage < 0.6) return null;

  return {
    matches,
    coverage,
    sourceWordCount: sourceWords.length,
  };
}

function getAlignmentWords(text) {
  return (
    text.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu) || []
  ).map(normalizeAlignmentWord);
}

function normalizeAlignmentWord(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[‘’]/g, "'")
    .toLocaleLowerCase()
    .replace(/^[^\p{L}\p{N}']+|[^\p{L}\p{N}']+$/gu, "");
}

function getWordSimilarity(source, candidate) {
  if (!source || !candidate) return 0;
  if (source === candidate) return 4;
  if (source.replace(/'/g, "") === candidate.replace(/'/g, "")) return 3.5;
  if (
    Math.min(source.length, candidate.length) >= 5 &&
    hasSingleEditDifference(source, candidate)
  ) {
    return 1.5;
  }
  return 0;
}

function hasSingleEditDifference(left, right) {
  if (Math.abs(left.length - right.length) > 1) return false;
  if (left.length === right.length) {
    let differences = 0;
    for (let index = 0; index < left.length; index += 1) {
      if (left[index] !== right[index]) differences += 1;
      if (differences > 1) return false;
    }
    return differences === 1;
  }

  const shorter = left.length < right.length ? left : right;
  const longer = left.length < right.length ? right : left;
  let shortIndex = 0;
  let longIndex = 0;
  let skipped = false;
  while (shortIndex < shorter.length && longIndex < longer.length) {
    if (shorter[shortIndex] === longer[longIndex]) {
      shortIndex += 1;
      longIndex += 1;
    } else if (skipped) {
      return false;
    } else {
      skipped = true;
      longIndex += 1;
    }
  }
  return true;
}

function parseXmlCues(xml) {
  const documentNode = new DOMParser().parseFromString(xml, "text/xml");
  return [...documentNode.querySelectorAll("text")]
    .map((node) => {
      const startMs = Number(node.getAttribute("start") || 0) * 1000;
      const durationMs = Number(node.getAttribute("dur") || 0) * 1000;
      return {
        text: cleanCaptionText(node.textContent || ""),
        startMs,
        endMs: startMs + Math.max(durationMs, 250),
      };
    })
    .filter((cue) => cue.text);
}

function cleanCaptionText(text) {
  const decoder = document.createElement("textarea");
  decoder.innerHTML = stripCaptionMarkup(String(text || ""));
  return stripNonSpeechCues(stripCaptionMarkup(decoder.value))
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripNonSpeechCues(text) {
  const cleaned = String(text || "")
    // YouTube 使用方括号或花括号标注声音、说话人和编辑提示；这些都不属于对白。
    .replace(/\[[^\]\n]{1,80}\]|\{[^{}\n]{1,80}\}/gu, " ")
    // 圆括号可能是真实插入语，只删除明确属于非语言声音的内容。
    .replace(/\([^()\n]{1,80}\)/gu, (wrappedCue) => {
      const cue = wrappedCue.slice(1, -1);
      return isNonSpeechCue(cue) ? " " : wrappedCue;
    });

  const trimmed = cleaned
    .replace(/^\s*[,;:·–—-]+\s*/u, "")
    .replace(/\s+/gu, " ")
    .trim();
  return trimmed;
}

function isNonSpeechCue(value) {
  const cue = String(value || "")
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[.!?…,:;·_–—-]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  if (!cue || cue.length > 80) return false;

  return /\b(?:music|applause|clapping|laughter|laughs?|laughing|chuckles?|chuckling|giggles?|giggling|cheers?|cheering|sighs?|sighing|gasps?|gasping|coughs?|coughing|groans?|groaning|cries|crying|sobs?|sobbing|screams?|screaming|whispers?|whispering|singing|humming|mumbling|murmuring|panting|grunts?|yells?|shouts?|inaudible|unintelligible|silence|chatter|background noise|crowd noise|audience noise|sound effects?|footsteps?|knocking|beeping|buzzing|thunder|rain|wind blowing|engine revving|phone ring(?:s|ing)?|door slam(?:s|ming)?|bell ring(?:s|ing)?)\b/u.test(
    cue,
  );
}

function stripCaptionMarkup(text) {
  return text
    .replace(/<br\s*\/?>/gi, " ")
    .replace(
      /<\/?(?:b|i|u|strong|em|font|ruby|rt|v|c(?:\.[^\s>]+)?)(?:\s[^>]*)?>/gi,
      "",
    );
}

function mergeCuesIntoSentences(cues) {
  const results = [];
  let current = null;
  const sentenceFragments = cues
    .flatMap(splitCueIntoSentenceFragments)
    .filter((cue) => cue.text?.trim())
    .sort((left, right) => left.startMs - right.startMs);

  sentenceFragments.forEach((cue, cueIndex) => {
    const nextCue = sentenceFragments[cueIndex + 1];
    if (!current) {
      current = { ...cue };
    } else {
      current.text = joinCaptionText(current.text, cue.text);
      current.endMs = Math.max(current.endMs, cue.endMs);
    }

    const duration = current.endMs - current.startMs;
    const gapAfter = nextCue ? nextCue.startMs - cue.endMs : Infinity;
    const sentenceEnded = hasTerminalSentencePunctuation(current.text);
    const hasHardTimeBoundary = gapAfter >= HARD_SENTENCE_GAP_MS;
    const hasSoftSemanticBoundary =
      gapAfter >= SOFT_SENTENCE_GAP_MS &&
      looksSemanticallyComplete(current.text) &&
      nextCue &&
      looksLikeNewSentence(nextCue.text);
    const reachedSafetyLimit =
      (duration >= MAX_SENTENCE_DURATION_MS ||
        current.text.length >= MAX_SENTENCE_CHARACTERS) &&
      !looksSyntacticallyIncomplete(current.text);
    const shouldFinish =
      sentenceEnded ||
      hasHardTimeBoundary ||
      hasSoftSemanticBoundary ||
      reachedSafetyLimit ||
      !nextCue;

    if (shouldFinish) {
      results.push({
        id: results.length,
        text: current.text.trim(),
        startMs: current.startMs,
        endMs: Math.max(current.endMs, current.startMs + 400),
        hasEstimatedStart: Boolean(current.hasEstimatedStart),
      });
      current = null;
    }
  });

  return repairDanglingSentenceFragments(results)
    .filter((segment) => segment.text.length > 0)
    .map((segment, index) => ({ ...segment, id: index }));
}

function splitSegmentsForPractice(segments) {
  return segments
    .flatMap(splitSegmentForPractice)
    .filter((segment) => segment.text?.trim())
    .map((segment, index) => ({ ...segment, id: index }));
}

function splitSegmentForPractice(segment) {
  const text = String(segment?.text || "").trim();
  const words = getWordsWithOffsets(text);
  const duration = Math.max(1, segment.endMs - segment.startMs);
  const shouldSplit =
    words.length > PRACTICE_MAX_WORDS ||
    text.length > PRACTICE_MAX_CHARACTERS ||
    duration > PRACTICE_MAX_DURATION_MS;
  if (!shouldSplit || words.length < PRACTICE_MIN_WORDS * 2) {
    return [{ ...segment, text }];
  }

  const desiredChunkCount = Math.max(
    2,
    Math.ceil(words.length / PRACTICE_TARGET_WORDS),
    Math.ceil(text.length / PRACTICE_MAX_CHARACTERS),
    Math.ceil(duration / PRACTICE_MAX_DURATION_MS),
  );
  const targetWords = Math.max(
    PRACTICE_MIN_WORDS,
    Math.ceil(words.length / desiredChunkCount),
  );
  const breakWordIndices = findPracticeBreaks(text, words, targetWords);
  if (breakWordIndices.length <= 1) return [{ ...segment, text }];

  let startWordIndex = 0;
  return breakWordIndices.map((endWordIndex, chunkIndex) => {
    const startCharacter =
      startWordIndex === 0 ? 0 : words[startWordIndex].start;
    const endCharacter =
      endWordIndex >= words.length ? text.length : words[endWordIndex].start;
    const chunkText = text.slice(startCharacter, endCharacter).trim();
    const startRatio = startWordIndex / words.length;
    const endRatio = endWordIndex / words.length;
    const chunk = {
      ...segment,
      text: chunkText,
      startMs: segment.startMs + duration * startRatio,
      endMs: segment.startMs + duration * endRatio,
      hasEstimatedStart:
        chunkIndex > 0 || Boolean(segment.hasEstimatedStart),
    };
    startWordIndex = endWordIndex;
    return chunk;
  });
}

function findPracticeBreaks(text, words, targetWords) {
  const wordCount = words.length;
  const costs = new Float64Array(wordCount + 1);
  const previous = new Int16Array(wordCount + 1);
  costs.fill(Number.POSITIVE_INFINITY);
  previous.fill(-1);
  costs[0] = 0;

  for (let start = 0; start < wordCount; start += 1) {
    if (!Number.isFinite(costs[start])) continue;
    const remainingAtStart = wordCount - start;
    const minimumEnd = Math.min(
      wordCount,
      start + (remainingAtStart <= PRACTICE_MAX_WORDS ? 1 : PRACTICE_MIN_WORDS),
    );
    const maximumEnd = Math.min(wordCount, start + PRACTICE_MAX_WORDS);

    for (let end = minimumEnd; end <= maximumEnd; end += 1) {
      const remaining = wordCount - end;
      if (remaining > 0 && remaining < PRACTICE_MIN_WORDS) continue;

      const chunkWords = end - start;
      // 每多切一段都付出固定成本，避免为了追求平均字数而拆散完整短语。
      let cost = costs[start] + 50 + (chunkWords - targetWords) ** 2 * 2;
      if (chunkWords < PRACTICE_MIN_WORDS) cost += 80;
      if (end < wordCount) {
        cost += getPracticeBoundaryCost(text, words, end);
      }

      if (cost < costs[end]) {
        costs[end] = cost;
        previous[end] = start;
      }
    }
  }

  if (previous[wordCount] < 0) return [wordCount];
  const breaks = [];
  let cursor = wordCount;
  while (cursor > 0) {
    breaks.push(cursor);
    cursor = previous[cursor];
    if (cursor < 0) return [wordCount];
  }
  return breaks.reverse();
}

function getPracticeBoundaryCost(text, words, endWordIndex) {
  const previousWord = words[endWordIndex - 1];
  const nextWord = words[endWordIndex];
  const between = text.slice(previousWord.end, nextWord.start);
  const previousNormalized = previousWord.normalized;
  const nextNormalized = nextWord.normalized;
  let cost = 0;

  if (/[.!?]["'’”)]?\s*$/u.test(between)) {
    cost -= 100;
  } else if (/[;:]["'’”)]?\s*$/u.test(between)) {
    cost -= 72;
  } else if (/[,]["'’”)]?\s*$/u.test(between)) {
    cost -= 58;
  } else if (/[–—]\s*$/u.test(between)) {
    cost -= 50;
  }

  if (
    new Set([
      "and",
      "but",
      "or",
      "so",
      "yet",
      "because",
      "although",
      "though",
      "if",
      "when",
      "while",
      "which",
      "who",
      "whose",
      "where",
      "what",
      "how",
    ]).has(nextNormalized)
  ) {
    cost -= 22;
  }

  if (
    new Set([
      "a",
      "an",
      "the",
      "to",
      "of",
      "for",
      "with",
      "from",
      "into",
      "onto",
      "at",
      "by",
      "about",
      "as",
      "than",
      "and",
      "or",
      "but",
      "is",
      "are",
      "was",
      "were",
      "be",
      "been",
      "being",
      "have",
      "has",
      "had",
      "do",
      "does",
      "did",
      "will",
      "would",
      "can",
      "could",
      "should",
      "may",
      "might",
      "must",
    ]).has(previousNormalized)
  ) {
    cost += 68;
  }

  return cost;
}

function hasTerminalSentencePunctuation(text) {
  return /[.!?]["'’”)]?$/.test(String(text || "").trim());
}

function looksSemanticallyComplete(text) {
  const words = getAlignmentWords(text);
  return words.length >= 2 && !looksSyntacticallyIncomplete(text);
}

function looksSyntacticallyIncomplete(text) {
  const normalized = String(text || "")
    .trim()
    .toLocaleLowerCase()
    .replace(/["'’”)]*$/u, "");
  if (!normalized) return true;
  if (/[,;:\-–—]$/u.test(normalized)) return true;

  const words = getAlignmentWords(normalized);
  const lastWord = words[words.length - 1] || "";
  const strongContinuationWords = new Set([
    "a",
    "an",
    "the",
    "and",
    "or",
    "but",
    "because",
    "although",
    "though",
    "if",
    "unless",
    "when",
    "while",
    "that",
    "which",
    "who",
    "whose",
    "where",
    "how",
    "to",
    "of",
    "for",
    "with",
    "from",
    "into",
    "onto",
    "at",
    "by",
    "about",
    "as",
    "than",
    "without",
    "within",
    "between",
    "among",
    "through",
    "during",
    "before",
    "after",
    "over",
    "under",
  ]);
  if (strongContinuationWords.has(lastWord)) return true;

  return /\b(?:i|you|we|they|he|she|it|there|this|that)\s+(?:am|is|are|was|were|have|has|had|do|does|did|can|could|would|should|will|may|might|must)$/u.test(
    normalized,
  );
}

function looksLikeNewSentence(text) {
  const value = String(text || "").trim();
  const firstLetter = value.match(/\p{L}/u)?.[0] || "";
  if (!firstLetter || firstLetter !== firstLetter.toLocaleUpperCase()) {
    return false;
  }

  const firstWord = getAlignmentWords(value)[0] || "";
  return !new Set([
    "and",
    "or",
    "but",
    "because",
    "although",
    "though",
    "that",
    "which",
    "who",
    "whose",
    "when",
    "while",
    "where",
    "if",
    "unless",
    "than",
    "to",
    "of",
    "for",
    "with",
    "from",
    "into",
    "onto",
    "at",
    "by",
    "about",
    "as",
    "without",
    "within",
    "between",
    "among",
    "through",
    "during",
    "before",
    "after",
    "over",
    "under",
  ]).has(firstWord);
}

function repairDanglingSentenceFragments(segments) {
  const repaired = [];

  for (const segment of segments) {
    const previous = repaired[repaired.length - 1];
    if (previous && isRepeatedOverlappingSegment(previous, segment)) {
      previous.endMs = Math.max(previous.endMs, segment.endMs);
      continue;
    }
    if (!previous || !shouldMergeDanglingPair(previous, segment)) {
      repaired.push({ ...segment });
      continue;
    }

    previous.text = joinCaptionText(previous.text, segment.text);
    previous.endMs = Math.max(previous.endMs, segment.endMs);
  }

  return repaired;
}

function shouldMergeDanglingPair(previous, next) {
  const gap = next.startMs - previous.endMs;
  if (gap >= HARD_SENTENCE_GAP_MS || hasTerminalSentencePunctuation(previous.text)) {
    return false;
  }

  const nextValue = String(next.text || "").trim();
  const firstLetter = nextValue.match(/\p{L}/u)?.[0] || "";
  const startsLowercase =
    firstLetter && firstLetter === firstLetter.toLocaleLowerCase();

  return (
    looksSyntacticallyIncomplete(previous.text) ||
    startsLowercase
  );
}

function isRepeatedOverlappingSegment(previous, next) {
  if (next.startMs > previous.endMs) return false;
  const normalize = (value) =>
    getAlignmentWords(value).join(" ").toLocaleLowerCase();
  const previousText = normalize(previous.text);
  const nextText = normalize(next.text);
  return Boolean(previousText && previousText === nextText);
}

function splitCueIntoSentenceFragments(cue) {
  const text = cue.text?.trim();
  if (!text || !/[.!?]/.test(text)) return text ? [{ ...cue, text }] : [];

  const sentenceParts = segmentTextIntoSentences(text);
  if (sentenceParts.length <= 1) return [{ ...cue, text }];

  const duration = Math.max(1, cue.endMs - cue.startMs);
  return sentenceParts.map((part, index) => {
    const nextPart = sentenceParts[index + 1];
    const startRatio = part.index / text.length;
    const endRatio = nextPart ? nextPart.index / text.length : 1;
    return {
      ...cue,
      text: part.text,
      startMs: cue.startMs + duration * startRatio,
      endMs: cue.startMs + duration * endRatio,
      hasEstimatedStart: index > 0,
    };
  });
}

function segmentTextIntoSentences(text) {
  if (typeof Intl?.Segmenter === "function") {
    const segmenter = new Intl.Segmenter("en", {
      granularity: "sentence",
    });
    const parts = [...segmenter.segment(text)]
      .map((part) => ({ index: part.index, text: part.segment.trim() }))
      .filter((part) => part.text);
    const mergedParts = mergeAbbreviationFragments(parts);
    if (mergedParts.length > 1) return mergedParts;
  }

  const parts = [];
  const boundaryPattern = /[.!?]["'’”)]*(?=\s+\S)/g;
  let startIndex = 0;
  let match;

  while ((match = boundaryPattern.exec(text))) {
    const endIndex = match.index + match[0].length;
    const sentence = text.slice(startIndex, endIndex).trim();
    if (sentence) parts.push({ index: startIndex, text: sentence });
    startIndex = endIndex;
    while (/\s/.test(text[startIndex] || "")) startIndex += 1;
  }

  const remainder = text.slice(startIndex).trim();
  if (remainder) parts.push({ index: startIndex, text: remainder });
  return mergeAbbreviationFragments(parts);
}

function mergeAbbreviationFragments(parts) {
  const abbreviationPattern = /(?:^|\s)(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|Mt|Gen|Rep|Sen|Gov|Lt|Col|Sgt|Capt|Rev|Hon|vs|etc|e\.g|i\.e|a\.m|p\.m|U\.S|U\.K)\.$/i;
  const initialPattern = /(?:^|\s)[A-Z]\.$/;
  const merged = [];
  let pending = null;

  for (const part of parts) {
    pending = pending
      ? { ...pending, text: `${pending.text} ${part.text}` }
      : { ...part };

    if (
      abbreviationPattern.test(pending.text) ||
      initialPattern.test(pending.text)
    ) {
      continue;
    }

    merged.push(pending);
    pending = null;
  }

  if (pending) merged.push(pending);

  return merged;
}

function joinCaptionText(previous, next) {
  if (!previous) return next;
  if (!next) return previous;

  const overlap = findCaptionWordOverlap(previous, next);
  if (overlap > 0) {
    const nextWords = getWordsWithOffsets(next);
    if (overlap >= nextWords.length) {
      const trailingPunctuation = next.slice(nextWords.at(-1)?.end || 0).trim();
      if (
        trailingPunctuation &&
        !new RegExp(`${escapeRegExp(trailingPunctuation)}$`).test(previous)
      ) {
        return `${previous.replace(/\s+$/u, "")}${trailingPunctuation}`;
      }
      return previous;
    }

    const remainder = next.slice(nextWords[overlap].start).trimStart();
    return joinCaptionTextWithoutOverlap(previous, remainder);
  }

  return joinCaptionTextWithoutOverlap(previous, next);
}

function joinCaptionTextWithoutOverlap(previous, next) {
  if (/[-–—]$/.test(previous) || /^[,.;:!?%)}\]]/.test(next)) {
    return `${previous}${next}`;
  }
  return `${previous} ${next}`;
}

function findCaptionWordOverlap(previous, next) {
  const previousWords = getWordsWithOffsets(previous);
  const nextWords = getWordsWithOffsets(next);
  const maxOverlap = Math.min(16, previousWords.length, nextWords.length);

  for (let size = maxOverlap; size >= 1; size -= 1) {
    if (
      size === 1 &&
      !(previousWords.length === 1 && nextWords.length === 1)
    ) {
      continue;
    }

    const previousStart = previousWords.length - size;
    const matches = Array.from(
      { length: size },
      (_, index) =>
        previousWords[previousStart + index].normalized ===
        nextWords[index].normalized,
    ).every(Boolean);
    if (matches) return size;
  }

  return 0;
}

function getWordsWithOffsets(text) {
  const words = [];
  const pattern = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu;
  let match;
  while ((match = pattern.exec(String(text || "")))) {
    words.push({
      normalized: normalizeAlignmentWord(match[0]),
      start: match.index,
      end: match.index + match[0].length,
    });
  }
  return words;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findStartingIndex(segments, currentTimeMs) {
  const activeIndex = segments.findIndex(
    (segment) =>
      currentTimeMs >= segment.startMs && currentTimeMs <= segment.endMs,
  );
  if (activeIndex >= 0) return activeIndex;

  const nextIndex = segments.findIndex(
    (segment) => segment.startMs >= currentTimeMs,
  );
  return nextIndex >= 0 ? nextIndex : 0;
}

  const api = Object.freeze({
    parseCaptionBody,
    hasWordTiming,
    collectTimedTokens,
    applyWordTimingsToSegments,
    mergeCuesIntoSentences,
    splitSegmentsForPractice,
    joinCaptionText,
    segmentTextIntoSentences,
    findStartingIndex,
  });
  const namespace = (globalThis.EnglishListeningTyping ||= {});
  namespace.captions = api;
  if (globalThis.__ELT_TEST__) globalThis.__ELT_TEST_API__ = api;
})();
