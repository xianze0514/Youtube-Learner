"""Offline rule probe; consumes project segments and captured Quark responses.

Usage: python3 research/linking-rule-probe.py SEGMENTS_JSON QUARK_JSON OUTPUT_JSON
This experiment does not change the extension or establish acoustic ground truth.
Rules reference: https://www.teachingenglish.org.uk/professional-development/teachers/knowing-subject/connected-speech-part-2
"""
import itertools
import json
import re
import sys
from collections import Counter
from pathlib import Path

VOWELS = set('aeiouɑɒæɛɜɞəɚɝɪɔʊʌɐ')
DIPHTHONGS = {'eɪ', 'aɪ', 'ɔɪ', 'aʊ', 'oʊ', 'əʊ', 'ɪə', 'eə', 'ʊə'}
VOWEL_PHONES = VOWELS | DIPHTHONGS | {v + 'ː' for v in VOWELS}
CONSONANTS = set('pbtdkgɡfvθðszʃʒhmnŋlrɹwj')
VOICLESS = {'p', 't', 'k', 'f', 'θ'}
SIBILANTS = {'s', 'z', 'ʃ', 'ʒ', 'tʃ', 'dʒ'}
WORD = re.compile(r"[A-Za-z]+(?:['’][A-Za-z]+)*")


def parse_ipa(entry):
    """Require actual bracketed American IPA; a pronunciation button is not IPA."""
    for item in entry.get('rawPhonetics', []):
        raw = re.sub(r'<[^>]+>', '', item.get('orig_text', ''))
        if '美音' not in raw:
            continue
        match = re.search(r'\[([^\]]+)\]', raw)
        if match:
            return [v.strip() for v in re.split(r'[;；]', match[1]) if v.strip()]
    return []


def phones(ipa):
    # Parenthetical schwa does not affect the boundaries in this sample.
    clean = re.sub(r'[\sˈˌˑ().]', '', ipa)
    result = re.findall(r'tʃ|dʒ|eɪ|aɪ|ɔɪ|aʊ|oʊ|əʊ|ɪə|eə|ʊə|.ː|.', clean)
    if any(p not in VOWEL_PHONES | CONSONANTS | {'tʃ', 'dʒ'} for p in result):
        return []
    return result


def suffix(ipa, kind):
    last = phones(ipa)[-1]
    if kind == 'ed':
        return ipa + ('ɪd' if last in {'t', 'd'} else 't' if last in VOICLESS | {'s', 'ʃ', 'tʃ'} else 'd')
    return ipa + ('ɪz' if last in SIBILANTS else 's' if last in VOICLESS else 'z')


def resolve(word, dictionary, fallback=False):
    ipa = parse_ipa(dictionary.get(word, {}))
    if ipa:
        return {'ipa': ipa, 'source': 'quark-direct'}
    if fallback:
        # Explicit sample-specific lemma decisions, not a general lemmatizer.
        lemmas = {'billed': ('bill', 'ed'), "world's": ('world', 's'),
                  'wallets': ('wallet', 's'), 'phones': ('phone', 's'),
                  'powers': ('power', 's'), 'yorkers': ('yorker', 's')}
        if word in lemmas:
            lemma, kind = lemmas[word]
            base = parse_ipa(dictionary.get(lemma, {}))
            if base:
                return {'ipa': [suffix(v, kind) for v in base],
                        'source': 'quark-lemma+inflection', 'lemma': lemma}
        if word == "i've":
            base = parse_ipa(dictionary.get('i', {}))
            have = parse_ipa(dictionary.get('have', {}))
            if base and have and all(phones(v)[-1] == 'v' for v in have):
                return {'ipa': [v + 'v' for v in base],
                        'source': 'quark-i+contracted-have'}
    return {'ipa': [], 'source': 'missing'}


def classify(left, right):
    a, b = phones(left), phones(right)
    if not a or not b:
        return None
    if a[-1] in CONSONANTS | {'tʃ', 'dʒ'} and b[0] in VOWEL_PHONES:
        return 'CV'
    if a[-1] == b[0] and a[-1] in CONSONANTS | {'tʃ', 'dʒ'}:
        return 'same-consonant'
    if b[0] in VOWEL_PHONES:
        normalized = re.sub(r'[ˈˌ\s]', '', left)
        if re.search(r'(iː?|eɪ|aɪ|ɔɪ)$', normalized):
            return 'j-glide'
        if re.search(r'(uː?|oʊ|əʊ|aʊ)$', normalized):
            return 'w-glide'
    return None


def analyze(segment, dictionary, fallback):
    text = segment['text']
    tokens = [{'word': m.group(), 'start': m.start(), 'end': m.end(),
               **resolve(m.group().lower().replace('’', "'"), dictionary, fallback)}
              for m in WORD.finditer(text)]
    boundaries = []
    for i, (a, b) in enumerate(zip(tokens, tokens[1:])):
        separator = text[a['end']:b['start']]
        item = {'leftIndex': i + 1, 'rightIndex': i + 2}
        if not separator.isspace():
            boundaries.append({**item, 'status': 'punctuation-or-hyphen'})
            continue
        if not a['ipa'] or not b['ipa']:
            boundaries.append({**item, 'status': 'missing-ipa'})
            continue
        outcomes = {classify(x, y) for x, y in itertools.product(a['ipa'], b['ipa'])}
        kinds = sorted(k for k in outcomes if k)
        edges = sorted({phones(x)[-1] + ' → ' + phones(y)[0]
                        for x, y in itertools.product(a['ipa'], b['ipa']) if phones(x) and phones(y)})
        boundaries.append({**item, 'status': 'candidate' if kinds else 'no-rule-match',
                           'types': kinds, 'variantDependent': None in outcomes or len(kinds) > 1,
                           'edges': edges,
                           'inferredPronunciation': a['source'] != 'quark-direct' or b['source'] != 'quark-direct'})
    return {'startMs': segment['startMs'], 'endMs': segment['endMs'],
            'tokens': tokens, 'boundaries': boundaries}


def main():
    segments = json.loads(Path(sys.argv[1]).read_text())[:30]
    dictionary = json.loads(Path(sys.argv[2]).read_text())
    words = {m.group().lower().replace('’', "'") for s in segments for m in WORD.finditer(s['text'])}
    runs = {}
    for name, fallback in [('direct', False), ('withInflection', True)]:
        rows = [analyze(s, dictionary, fallback) for s in segments]
        counts = Counter(k for row in rows for b in row['boundaries'] for k in b.get('types', []))
        runs[name] = {'missingWords': sorted(w for w in words if not resolve(w, dictionary, fallback)['ipa']),
                      'counts': dict(counts), 'rows': rows}
    result = {'videoId': 'h3M00JI8Iwo', 'scope': 'first 30 project practice segments; manual English captions',
              'audioVerified': False, 'uniqueWords': len(words),
              'tokenCount': sum(len(WORD.findall(s['text'])) for s in segments),
              'rules': 'American dictionary IPA; punctuation blocks boundaries; no cross-segment inference',
              'runs': runs}
    Path(sys.argv[3]).write_text(json.dumps(result, ensure_ascii=False, indent=2))
    print(json.dumps({k: {f: v[f] for f in ['missingWords', 'counts']} for k, v in runs.items()}, ensure_ascii=False))
    for i, row in enumerate(runs['withInflection']['rows'], 1):
        matches = []
        for b in row['boundaries']:
            if b['status'] == 'candidate':
                a, z = row['tokens'][b['leftIndex']-1], row['tokens'][b['rightIndex']-1]
                matches.append(f"{a['word']}‿{z['word']} [{','.join(b['types'])}{'?' if b['variantDependent'] else ''}] ({'; '.join(b['edges'])})")
        print(i, ' | '.join(matches) or '—')


if __name__ == '__main__':
    main()
