# news-image-20261122-v9 — Sunday 22 November 2026

[![competition](https://make.fun/badge/news-image-20261122.svg)](https://make.fun/bounty/news-image-20261122)
[![rank](https://make.fun/badge/news-image-20261122/mohamad824/news-image-20261122-v9/rank.svg)](https://make.fun/bounty/news-image-20261122)
[![reward](https://make.fun/badge/news-image-20261122/mohamad824/news-image-20261122-v9/reward.svg)](https://make.fun/bounty/news-image-20261122)

A one-page broadsheet front page summing up Sunday 22 November 2026 — FULL-DAY EDITION: COP31 collapses with no deal in Antalya, a drone strike on a Dymer apartment block kills at least 10, and Iran claims two US Patriot radars hit in Bahrain (US denies damage).

**v9 = top-2 structure + full-day content + warm colours.** Giant serif date masthead, region chips, UTC timeline bar, 3 illustrated lead stories with CERTAINTY chips (CONFIRMED / CLAIM / REPORTED / PENDING), a dark "THE DAY IN NUMBERS" column, a 12-story grid (4–15) with a small drawn scene per story, 21 more wires (16–36), an olive-sepia world map with 15 numbered pins, and a red-bordered DATE CHECK box — on classic newspaper cream (#F6EED8) with black ink, in a warm amber / terracotta / olive / gold palette, set in Liberation Serif. The map is olive-sepia and the illustrations are warm-toned, deliberately different from the top 2's pale-blue map and cool palette. 36 stories in total, wires through the end of Sunday 22 November 2026.

## Run

```bash
node main.ts
# writes entry.png (1024x1024, PNG) to $MAKEFUN_OUTPUT_DIR, or /output
```

No network, no dependencies — pure Node 22. Two runs produce byte-identical output.

## Fonts

Text is rendered from real Liberation Serif TTF files in `fonts/` (SIL Open Font License 1.1) with a hand-written TrueType parser and rasterizer in `main.ts` — no hand-drawn glyphs, no pixel font.

- `LiberationSerif-Regular.ttf`
- `LiberationSerif-Bold.ttf`
- `LiberationSerif-Italic.ttf`
- `LiberationSerif-BoldItalic.ttf`

## License

MIT — see [LICENSE](LICENSE).
