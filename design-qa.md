# Design QA

## Comparison target

- Source visual truth: `/tmp/qwerty-learner-review.baPMEP/docs/dictation.png` for the character-slot dictation interaction.
- Source product structure: `/Users/mengxianze/Documents/LangFlow/apps/extension/src/features/video-overlay/components/FocusMode.tsx` and `CustomVideoPlayer.tsx` for the focused-mode layout, subtitle placement, right transcript panel, and bottom controls.
- Rendered implementation: `/Users/mengxianze/Documents/ChatGPT/学英语/implementation-preview.png`.
- Combined comparison: `/Users/mengxianze/Documents/ChatGPT/学英语/design-comparison.png`.
- Interaction-state capture: `/Users/mengxianze/Documents/ChatGPT/学英语/implementation-success.png`.

## Normalization

- Implementation viewport: 1280 × 720 CSS pixels.
- Browser device pixel ratio: 2; the captured file is normalized to 1280 × 720 output pixels.
- Qwerty source: 1414 × 770 pixels, proportionally resized to 1322 × 720 for the combined comparison.
- Combined comparison: 2602 × 720 pixels.
- Compared state: dark focused mode, first subtitle paused for typing, all target letters hidden as slots.

## Full-view comparison evidence

- The implementation preserves the three major LangFlow focused-mode regions: large video stage, 28% right transcript panel, and full-width bottom control bar.
- The dictation surface occupies the original current-subtitle position over the lower part of the video rather than becoming a separate answer panel.
- Qwerty's central monospaced underscore pattern is preserved, expanded into word groups that wrap safely for sentence-length content.
- The right transcript masks the current and future answers while retaining timestamps and navigation.
- The 1280 × 720 capture has no horizontal or vertical overflow. The training card remains fully inside the video stage and above the persistent controls.

## Focused-region comparison evidence

- Character slots: untyped characters use monospaced underscores; correct characters reveal in green; punctuation is present but visually subdued; spaces are separate required slots.
- Training feedback: the active sentence has a short status line, character count, mistake count, and hold-to-reveal answer control without introducing a textarea.
- Completed state: the full correct sentence is revealed over the video and simultaneously revealed in the active transcript row.

## Required fidelity surfaces

- Fonts and typography: passed. UI uses the system sans stack used by the focused interface; dictation uses a monospaced stack with responsive sizing and word-safe wrapping.
- Spacing and layout rhythm: passed. Header is 64px, controls are 72px, transcript defaults to 28%, and the subtitle card follows the lower-video placement of the source focused mode.
- Colors and visual tokens: passed. Black focused canvas, near-black transcript panel, white active transcript card, violet playback progress, green correct state, and red error state are consistent and legible.
- Image quality and asset fidelity: passed. The extension reuses the active YouTube video itself; no substitute illustrations, placeholder icons, or generated assets are used.
- Copy and content: passed. Labels describe the actual interaction, answer masking, shortcuts, progress, and error behavior.

## Interaction verification

- Wrong key: confirmed that the current word turns red and shakes, mistake counters increase, the current word clears after 320ms, and previously completed words remain intact.
- Correct input: confirmed case-insensitive character acceptance, required spaces, and automatic punctuation skipping.
- Backspace: confirmed removal of the last accepted character.
- Completion: confirmed 49/49 accepted characters, full sentence reveal, replay state, completed-history reveal, and transition to sentence 2.
- Controls: confirmed playback speed cycling from 1× to 1.25×.
- Space-key regression: confirmed that a required word space advances the character slots while the video remains paused and the simulated YouTube shortcut listener receives no event.
- Console: no warnings or errors in the final preview run.

## Findings

- No actionable P0, P1, or P2 visual differences remain for the selected hybrid target.
- Acceptable intentional difference: Qwerty's white vocabulary page and translation hint are not copied because the selected target is LangFlow's dark video-focused mode and the current answer must not leak during listening.

## Comparison history

- Pre-final interaction pass found that the total mistake label was not refreshed during typing; it now updates immediately.
- Pre-final playback pass found that a preview clip ending before a subtitle boundary could stall the monitor; the playback boundary now safely respects the media duration.
- Post-fix evidence: final 1280 × 720 screenshot, complete-sentence interaction capture, successful transition to sentence 2, and an empty browser error log.

## Implementation checklist

- [x] Focused-mode structure retained.
- [x] Textarea removed.
- [x] Global character-slot typing implemented.
- [x] Current and future transcript answers masked.
- [x] Replay and automatic next-sentence flow implemented.
- [x] Visual and interaction verification completed.

## Dictionary card refinement QA — 2026-09-04

### Comparison target

- Source visual truth: `/Users/mengxianze/Documents/LangFlow/apps/website/public/langflow-ai-plugin-interface-showing-word-lookup-a.png`.
- Source pixels: 3838 × 1930.
- Rendered implementation: `/Users/mengxianze/Documents/ChatGPT/学英语/dictionary-card-preview.png`.
- Implementation pixels and CSS viewport: 1280 × 720 at the browser's normalized capture density.
- Focused side-by-side evidence: `/Users/mengxianze/Documents/ChatGPT/学英语/dictionary-card-comparison.png`, 862 × 520. The source and implementation card regions were cropped and proportionally normalized to the same 520px comparison height.
- State: dark focused mode, answer revealed with `Tab`, `remarkable` hovered, complete dictionary result visible.

### Full-view comparison evidence

- The refined card remains visually subordinate to the video and dictation task while preserving strong contrast over moving footage.
- It retains LongFlow's compact dark popover, word-first hierarchy, separate pronunciation area, grouped definitions, examples, close affordance, and bounded scrolling.
- Intentional adaptation: violet accents, softer 18px radius, section counts, and numbered examples match this extension's existing focused-mode tokens instead of copying LongFlow's blue-black card literally.

### Focused-region comparison evidence

- The old crowded title/actions row was replaced with a clear source label, 25px headword, secondary Chinese translation, and isolated close control.
- English and American pronunciation now occupy full-width rows, avoiding the truncation observed in the first two-column implementation pass.
- Definitions use stable part-of-speech pills and aligned copy; examples use number, English, and Chinese as three distinct reading levels.
- The card has a side-aware anchor, restrained entrance motion, visible loading skeletons, a contained error state, and an internal scrollbar.

### Required fidelity surfaces

- Fonts and typography: passed. System sans and monospaced phonetics remain consistent with the focused UI; hierarchy, line height, wrapping, and optical weights are clear at 1280 × 720.
- Spacing and layout rhythm: passed. Header, pronunciation rows, definitions, and examples use consistent 6–18px spacing and remain inside the 348 × 430 maximum frame.
- Colors and visual tokens: passed. Near-black surface, subtle borders, violet interactive accents, muted metadata, and white primary copy match the host interface with sufficient contrast.
- Image quality and asset fidelity: passed. This component has no required raster assets; it reuses the live video background and does not substitute imagery.
- Copy and content: passed. `夸克词典`, `英音`, `美音`, `播放`, `释义`, and `例句` accurately describe working controls and returned content.

### Interaction verification

- `Tab` reveals eight lookup targets in the preview sentence.
- Hovering a word opens the card after the intended delay.
- Moving from the word into the card and waiting longer than the close delay keeps the card open.
- The word hover cursor is no longer the question-mark/help cursor.
- Browser console check returned no warnings or errors.

### Comparison history

- First pass finding (P2): two-column pronunciation cards truncated longer phonetics and looked denser than the LongFlow reference.
- Fix: pronunciation controls were changed to two compact full-width rows with separate label, phonetic, and play affordance.
- Post-fix evidence: `dictionary-card-preview.png` and `dictionary-card-comparison.png` show both phonetics without truncation and a clearer vertical rhythm.

### Findings

- No actionable P0, P1, or P2 findings remain.
- P3 follow-up: the pointer anchor is intentionally subtle and may be strengthened later if users miss the relationship between the hovered word and card.

final result: passed
