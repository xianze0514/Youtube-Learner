async function lookupDictionaryWord(rawWord) {
  const word = String(rawWord || "")
    .trim()
    .toLocaleLowerCase();
  if (!/^[a-z]+(?:'[a-z]+)?$/i.test(word)) {
    throw new Error("这个内容不是可查询的英文单词");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const params = new URLSearchParams({
      method: "tools.translate",
      query: word,
      ft: "en2zh",
    });
    const response = await fetch(`https://quark.sm.cn/api/rest?${params}`, {
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`夸克查词暂时不可用（${response.status}）`);

    const payload = await response.json();
    const entry = payload?.data;
    if (payload?.error !== 0 || !entry?.entity) {
      throw new Error("夸克词典中没有找到这个单词");
    }

    const phonetics = (entry.entity.orig_auto || [])
      .slice(0, 2)
      .map((item, index) => ({
        label: index === 0 ? "英" : "美",
        text: stripQuarkMarkup(item?.orig_text).replace(/^(?:英音|美音)\s*/u, ""),
        audioUrl: `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(word)}&type=${index + 1}`,
      }))
      .filter((item) => item.text);
    const meanings = (entry.entity.explains?.explain_list || [])
      .map((meaning) => ({
        partOfSpeech: stripQuarkMarkup(meaning?.label) || "释义",
        definition: stripQuarkMarkup(meaning?.value),
      }))
      .filter((meaning) => meaning.definition)
      .slice(0, 5);
    if (meanings.length === 0) throw new Error("词典没有返回有效释义");

    const examples = (entry.basics?.sentence || [])
      .flatMap((group) => group?.sentences || [])
      .map((example) => ({
        en: stripQuarkMarkup(example?.en).replace(/^\d+\s*[·.]\s*/u, ""),
        zh: stripQuarkMarkup(example?.cn),
      }))
      .filter((example) => example.en || example.zh)
      .slice(0, 2);

    return {
      word: entry.entity.title || word,
      translation: stripQuarkMarkup(entry.head?.word),
      phonetic: phonetics
        .map((item) => `${item.label} ${item.text}`.trim())
        .join("  ·  "),
      phonetics,
      meanings,
      examples,
    };
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("查词超时，请稍后重试");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function stripQuarkMarkup(value) {
  return String(value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

export { lookupDictionaryWord };
