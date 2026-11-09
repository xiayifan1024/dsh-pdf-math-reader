<p align="center">
  <img src="assets/icon-512.png" width="120" height="120" alt="dsh-pdf-math-reader icon">
</p>

<h1 align="center">dsh-pdf-math-reader</h1>

> PDF Math Reader — an academic PDF workspace for reading, translation, notes and AI Q&A inside DeepSeek Harness.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![PDF.js](https://img.shields.io/badge/PDF.js-4.10.38-orange)](assets/PDFJS-LICENSE)
[![DeepSeek Harness](https://img.shields.io/badge/DeepSeek%20Harness-plugin-4f46e5)](https://github.com/deepseek-ai/deepseek-harness)
[![GitHub](https://img.shields.io/badge/GitHub-xiayifan1024%2Fdsh--pdf--math--reader-181717?logo=github)](https://github.com/xiayifan1024/dsh-pdf-math-reader)

**English** | [简体中文](README.md)

**dsh-pdf-math-reader** (shown as **PDF Math Reader** in the UI) is a PDF reading and academic
translation plugin for the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) Web
UI. Its design follows the
[PDFMathTranslate](https://github.com/PDFMathTranslate/PDFMathTranslate) principle of preserving
equations, citations and layout semantics, but implements it as **local reading with
paragraph-level bilingual alignment**, without modifying the original PDF.

It is meant for papers, technical reports, textbooks and any PDF with a text layer: the PDF is
rendered in the browser, and translation, glossary, reading notes and document Q&A all live in the
same panel.

<p align="center">
  <img src="docs/screenshot.jpg" alt="PDF Math Reader: outline on the left, PDF page in the middle, translation and notes on the right" width="100%">
</p>

## Contents

- [Features](#features)
- [Quick start](#quick-start)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [Configuration](#configuration)
- [Privacy and security](#privacy-and-security)
- [Architecture](#architecture)
- [Development](#development)
- [Limitations and roadmap](#limitations-and-roadmap)
- [FAQ](#faq)
- [Acknowledgements](#acknowledgements)
- [Contributing](#contributing)
- [License](#license)

## Features

### Reading

- A "PDF reader" sidebar entry, with outline navigation and real page thumbnails.
- PDFs are rendered locally, with paging, zoom, fit-to-width and two-column text reconstruction.
- Side panels are resizable by dragging the splitters; widths are saved automatically.
- The text layer uses PDF.js's native `TextLayer`, so selections line up with the page text.
- `←` / `→` turn pages and `↑` / `↓` scroll the current page; `A` / `D` also turn pages.
- The mouse wheel scrolls within a page; scrolling past the top or bottom turns to the previous or
  next page (with a 1-second cooldown).

### Translation

- Paragraph-level **bilingual / translation only / original only** views.
- Translate the current page, a text selection or the whole document, with progress and a stop
  button.
- The translation prompt requires equations, LaTeX, citations, DOIs, numbering, code and URLs to be
  kept verbatim.
- Glossary: one `source=target` or `source:target` entry per line; matched terms are forced to the
  given translation.
- Translations are cached per paragraph, so revisiting a page does not re-request them; the cache
  can be cleared in settings.
- The target language and glossary are stored in the browser's `localStorage`.

### Equations

- Display equations are detected as **regions**, using equation numbers, right alignment, math
  fonts, operators, sub/superscripts and vertical whitespace. Headings, page numbers, list numbers
  and table cells are not treated as equations.
- Each equation is shown as one complete block: a high-resolution crop of the PDF region plus its
  number, instead of splitting limits and fractions into several fragment cards.
- Text items inside an equation region are removed from the body paragraphs; in bilingual mode the
  equation is shown once, while the paragraphs before and after it keep both original and
  translation.
- Clicking an equation block locates and highlights the source region; long equations scroll
  horizontally and can be viewed enlarged.
- When automatic detection is wrong, use **Select equation** in the toolbar to draw a box around the
  full region, or choose **Not an equation** on the card to undo a false positive. Corrections are
  persisted per **document fingerprint + page number** and stay in effect after reopening the
  document; automatic detection can also be restored per page.
- Inline math is replaced with unique `⟦MATH_001⟧` placeholders in translation requests; the
  returned translation must contain each placeholder exactly once, with no unknown markers. A failed
  check marks that paragraph as failed and offers a retry instead of storing a wrong translation.
- Each equation block reserves a `latex` field. Phase 2 will render it with KaTeX alongside the
  original image; if recognition or rendering fails, the image is shown instead.

<p align="center">
  <img src="docs/equations-preview.png" alt="Attention paper: equations (1) and (2) and the MultiHead equation cropped as separate high-resolution blocks, with fractions, sub/superscripts and numbers intact" width="82%">
</p>

The image above is the actual crop produced from `tests/fixtures/attention.pdf`: the fraction and
the `T` and `d_k` scripts in equation (1) are not clipped, the scripts in equation (2) are complete,
and the equation number is shown separately in the card title.

### Notes

- Click a PDF paragraph, switch to the **Notes** tab on the right and start writing.
- Notes appear as tagged cards: page number, source excerpt and note text.
- Clicking a note card jumps to its page and locates the paragraph; clicking the paragraph again
  clears the highlight.
- Paragraphs with notes are highlighted in yellow on the page; the selected paragraph is
  highlighted in orange.
- Notes are stored in the local `localStorage`, keyed by document fingerprint, and can be edited or
  deleted.
- **Save all notes to a file** writes a Markdown file through the Host. The target directory is
  configurable and defaults to `pdf-reader-notes` under the DSH working directory; an existing file
  name gets a timestamp suffix instead of being overwritten.

### AI reading

- An **AI reading** tab on the right supports multi-turn Q&A.
- Context scope is selectable: **This + adjacent pages** or **Whole document**.
- Answers are grounded in the supplied document text; the model is not expected to "remember" a
  whole PDF.
- A **DSH Skill** can be imported, as can a custom reading method from a local `.md` / `.txt` file.
- Useful questions include: the core contribution, what an equation means, experimental conclusions,
  and how the method differs from the baselines.

### Export

- Export bilingual Markdown; display equations are kept as numbered equation text blocks.
- Export **Markdown + equation images ZIP**: the archive contains the `.md` file and
  `equations/*.png`, so equations remain visible when opened offline.
- Export printable comparison HTML; equation images are embedded as data URIs, with no external
  files. The page can be printed to PDF directly from the browser.

## Quick start

### Requirements

- DeepSeek Harness Desktop / Web UI, with a working model route in the current profile.
- Node.js 22+ and npm to build the client.
- No Python, BabelDOC or extra PDF tooling at runtime.

### Installing in DSH

Installing directly from GitHub is recommended:

```bash
dsh plugin --profile <your profile> add github:xiayifan1024/dsh-pdf-math-reader
```

You can also clone the repository and install the local bundle:

```text
plugin_manager install_bundle target=<absolute path to this repository>
```

For example:

```text
plugin_manager install_bundle target=D:\plugins\dsh-pdf-math-reader
```

After installation a "PDF reader" icon appears in the sidebar. If the Web UI was already open,
refresh the page (`Ctrl+Shift+R`) to load the new client bundle.

When the panel is opened for the first time, the plugin requests:

```text
GET /pdf-reader/api/health
```

to confirm the model service, provider, model and request limits.

### Usage

1. Click **PDF reader** in the sidebar.
2. Click **Open PDF**, or drag a PDF into the panel.
3. Check the equation blocks in the translation panel; if detection is wrong, use **Select
   equation** to correct it, or **Not an equation** on a card to undo a false positive.
4. In **Translation** on the right, translate the current page, the selection or the whole document.
5. Click a paragraph, then switch to **Notes** to record the key points.
6. Switch to **AI reading**, choose a context scope and ask questions; import a Skill if needed.
7. Export bilingual Markdown, a Markdown + equation images ZIP, or comparison HTML from the top
   right.

## Keyboard shortcuts

| Action | Shortcut |
|---|---|
| Previous / next page | `←` / `→`, or `A` / `D` |
| Scroll the current page up / down | `↑` / `↓` |
| Wheel paging | Keep scrolling after reaching the top / bottom; 1-second cooldown |
| Clear paragraph highlight, selection and equation box | `Esc` |
| Typing in an input field | Does not trigger the shortcuts above |

## Configuration

Configuration lives in `cordis.patch.yml` and can also be overridden in the profile's patch layer:

```yaml
config:
  provider: deepseek-account   # leave empty to use the profile default
  model: deepseek-flash
  maxSegmentsPerRequest: 5
  maxCharsPerRequest: 3800
  maxTextChars: 8000
  timeoutMs: 180000
  cacheEntries: 600
  chatMaxChars: 24000
  chatTimeoutMs: 150000
  chatMaxTokens: 2048
```

| Field | Default | Description |
|---|---:|---|
| `provider` | profile default | Overrides the model provider |
| `model` | profile default | Overrides the model id |
| `maxSegmentsPerRequest` | `5` | Maximum paragraphs per translation request |
| `maxCharsPerRequest` | `3800` | Maximum characters per translation request |
| `maxTextChars` | `8000` | Maximum characters in a single paragraph |
| `timeoutMs` | `180000` | Translation request timeout (ms) |
| `cacheEntries` | `600` | Number of translation results kept in memory |
| `chatMaxChars` | `24000` | Maximum AI reading context characters |
| `chatTimeoutMs` | `150000` | AI reading request timeout (ms) |
| `chatMaxTokens` | `2048` | Maximum output tokens for AI reading |

`maxSegmentsPerRequest` and `maxCharsPerRequest` are lowered by the bundled `cordis.patch.yml`;
without that patch the code fallbacks are `6` and `4200`.

## Privacy and security

- **PDFs are never uploaded**: files are read and rendered in the browser, and only the text you
  explicitly translate or ask about is sent to the model.
- **Your existing model is used**: the plugin stores no API key; translation and chat go through the
  model route of the current DSH profile.
- **Resource isolation**: PDF.js, CMaps and fonts are all served by this plugin's Host, and asset
  paths are containment-checked, rejecting drive-letter paths, absolute paths and directory
  traversal.
- **Prompt constraints**: document paragraphs are passed as data, the model is asked to preserve
  equations and citations, and AI answers are restricted to the supplied excerpts.
- **Local data**: the glossary, notes, panel widths and equation corrections live in the browser's
  `localStorage`; the translation cache exists only for the current page session. Saving notes to a
  file writes a local Markdown file through the Host and never uploads it.

## Architecture

```text
┌─────────────────────────────────────┐
│ Web UI (React, client.js)           │
│  PDF.js · TextLayer · notes         │
└───────────────┬─────────────────────┘
                │ same-origin HTTP
┌───────────────▼─────────────────────┐
│ DSH Host (index.js)                 │
│  static assets · translation ·      │
│  chat · skills                      │
└───────────────┬─────────────────────┘
                │ ctx.llm
┌───────────────▼─────────────────────┐
│ model route of the current profile  │
└─────────────────────────────────────┘
```

Host routes:

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/pdf-reader/api/health` | Model and limit information |
| `POST` | `/pdf-reader/api/translate` | Batch paragraph translation |
| `POST` | `/pdf-reader/api/chat` | AI document Q&A |
| `GET` | `/pdf-reader/api/skills` | List available DSH skills |
| `POST` | `/pdf-reader/api/skill` | Read a skill's content |
| `POST` | `/pdf-reader/api/save-notes` | Write all notes to a Markdown file |
| `GET` | `/pdf-reader/assets/*` | PDF.js runtime assets |

Implementation notes:

- A PDF page is rendered to a canvas first, then its text is extracted separately; a failing text
  layer does not block reading.
- Text reconstruction preserves PDF content-stream order and handles column changes, vertical jumps
  back up the page, paragraph indentation and line spacing.
- Equation regions are detected and merged with sub/superscripts, limits, fractions and numbers
  before the remaining text is reconstructed into paragraphs. The page model emits `blocks`
  (`paragraph` / `equation`) in reading order, and body paragraphs are derived from `blocks`, so
  older call sites (translation, notes, AI context) keep working.
- Equation `bbox` values are stored in scale-1 PDF page coordinates; highlighting and cropping
  convert through the viewport, so they stay consistent across zoom, sidebar resizing and reopening
  the document.
- Equation images are rendered on a dedicated canvas at display size × DPR under a maximum pixel
  budget. Cache keys include the document, page, crop rect and render resolution; a manual correction
  invalidates the matching cache.
- Inline math is isolated with `⟦MATH_xxx⟧` placeholders, and the Host validates every returned
  translation for completeness, duplicates and unknown markers.
- PDF.js may put a whole sentence and a trailing operator in the same text item. Extraction splits
  such items by math token ranges and replaces only the math fragment with a placeholder, instead of
  hiding the sentence. Equation-span expansion excludes stop words such as `of / is / a / the`; only
  variable-shaped short tokens (single letters, Greek letters, tokens containing digits or
  underscores, uppercase abbreviations, or known function names) are merged into the equation.
- Changing an equation region increments the translation epoch, cancels in-flight translations and
  clears loading state, so an old request cannot write results back under pre-rebuild paragraph ids.
- Each document has its own page-model cache; async work from a previously opened document cannot
  write into the new one.
- Opening a file carries a task id; consecutive opens destroy stale tasks so an old file cannot
  overwrite a new one.
- Translation and chat requests are bound to client-disconnect signals; stopping cancels model
  generation on the Host.
- Switching the target language aborts old requests and increments the epoch; stale results are not
  applied to the new language.

Equation block in the page model:

```js
{
  id: 'page6-equation1',
  type: 'equation',
  pageIndex: 5,
  bbox: [x0, y0, x1, y1],        // scale-1 PDF page coordinates, including number and padding
  imageBbox: [x0, y0, x1, y1],   // crop rect, excluding the number padding on the right
  equationNumber: '(1)',
  sourceItemIds: [],             // PDF.js text item indexes, for traceability
  latex: null,                   // filled in by phase 2
  detectionSource: 'automatic'   // or 'manual'
}
```

`blocks` mixes `paragraph` and `equation` entries in reading order; `paragraphs` is derived from
`blocks`, so translation, notes and export can still work on body paragraphs only.

## Development

```bash
npm install
npm run build
npm test
```

`client.js` is generated from `src/` and should not be edited directly. The build uses esbuild, with
React and the JSX runtime provided by the DSH browser module table.

```text
index.js                 Host entry: routes, model calls, skills, security checks
lib/                     Host pure functions with standalone tests (translation, chat, placeholder validation)
src/plugin.jsx           Main panel, reader, equation blocks, notes and AI reading UI
src/pdf.js               PDF.js loading, text reconstruction, equation crops, thumbnails, outline
src/equations.js         Equation region detection, bbox/crop sizing, manual correction merging
src/zip.js               Dependency-free ZIP (store) writer
src/api.js               Same-origin HTTP API client
src/locales.js           Chinese and English UI strings
src/styles.js            Styles built on --dsw-alias-* theme tokens
assets/                  PDF.js 4.10.38, CMaps, standard fonts (Apache-2.0)
tests/                   node:test unit tests and a fixed PDF regression fixture
tests/fixtures/          attention.pdf (Attention Is All You Need)
scripts/                 Build and Node-side smoke tests
client.js                Built artifact
```

Test coverage:

- `node:test` unit tests for pure functions: strict translation JSON parsing, glossary, batch
  splitting, chat history and prompts.
- Placeholder validation: complete, duplicated and unknown markers, empty-output fallback and
  failure marking.
- Equation detection: equations (1)/(2) in the real Attention PDF, fraction and script merging, table
  false positives, and zoom-invariant coordinates.
- Manual correction: deleting an automatic equation, re-boxing a region and restoring the original
  text items.
- Equation crop sizing: DPR, maximum pixel budget and the long-edge limit.
- Central directory and local blocks of the Markdown + images ZIP.
- Host routes, strict translation JSON parsing, skill loading, asset path traversal and
  client-disconnect cancellation.
- Client module-loader wrapper and slot registration.
- Joining adjacent text fragments and two-column paragraph boundaries.

### Equation regression fixture

The fixed fixture is `tests/fixtures/attention.pdf` (*Attention Is All You Need*, 15 pages). Current
heuristic detection results over the whole fixture:

| Page | Page content | Detection result |
|---:|---|---|
| 4 | Equation (1) `Attention(Q,K,V)` | 1 complete equation block, with number |
| 5 | `MultiHead`, `where head_i`, equation (2) `FFN` | 3 equation blocks (the first two are unnumbered) |
| 6 | The two positional-encoding equations | 2 equation blocks; table 1 is not misdetected |
| 7 | Learning-rate equation (3) | 1 complete equation block |
| 8 | Numbers and `·` in tables 2/3 | 0 equation blocks (tables are not misdetected) |
| Other pages | Title, body, references | 0 equation blocks |

The regression suite covers the full bbox of equations (1)/(2), fragments staying out of body
paragraphs, correct numbers, unchanged bbox after zooming, no table false positives, and manual
boxing / undoing / restoring. These numbers apply to this one sample only; coverage must be
re-evaluated when extending to other papers. The fixture is from Vaswani et al., *Attention Is All
You Need* ([arXiv:1706.03762](https://arxiv.org/abs/1706.03762)) and is used only for text extraction
and equation-region regression tests.

## Limitations and roadmap

- This is a **paragraph-aligned view inside the reader**; it does not produce a reflowed monolingual
  or bilingual PDF. The comparison HTML can be printed to PDF from the browser.
- Phase 1 of equation support is "region detection + high-resolution crop + placeholder protection".
  The `latex` field is reserved for phase 2; no equation recognition service is connected yet, and
  KaTeX rendering is not implemented.
- The boundary between inline math and body text, including baselines and line breaks, is the next
  task; display equations and placeholder validation are prioritised for now.
- Automatic detection is heuristic and needs evaluation on more papers. Manual correction is
  available through **Select equation**, **Not an equation** and **Restore auto-detection**.
- Scanned PDFs without a text layer are not OCR'd; the page reports that no text was found.
- Two-column and multi-column layouts use heuristic reconstruction; unusual layouts may need manual
  paragraph-boundary fixes.
- AI conversations live in the current document session and reset when the document changes; notes,
  glossary and equation corrections persist in browser storage.
- Roadmap: equation recognition service + KaTeX, BabelDOC bilingual PDF, OCR, cross-session note
  sync, multi-document bookshelf.

## FAQ

**The "PDF reader" icon is missing after installation.**  
Refresh the Web UI or reopen the panel, and confirm that `plugin_manager install_bundle` returned
`application: applied`.

**"Rendering page…" appears while paging.**  
That is a normal page-rendering indicator, not a model request. The model is only called for
translation, AI Q&A and the health check when the panel opens.

**The model is unavailable / translation fails.**  
Check `llm`, `provider` and `model` in the `/pdf-reader/api/health` response, make sure the current
profile has a signed-in model available, or override `provider` / `model` in the configuration.

**A scanned PDF has no text.**  
This version does not do OCR; the page reports that no text was found. OCR support is tracked on the
roadmap.

**Selection is misaligned with the text.**  
The plugin uses PDF.js's native `TextLayer`. A few PDFs with incomplete font metrics can still be
off by a little. Please report with a screenshot of the page and the PDF version.

## Acknowledgements

- [PDFMathTranslate / PDF2ZH](https://github.com/PDFMathTranslate/PDFMathTranslate): reference for
  academic PDF layout and translation philosophy.
- [PDF.js](https://github.com/mozilla/pdf.js): PDF rendering and the text layer.
- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness): plugin runtime and Web UI.

This project is not affiliated with the projects above; PDFMathTranslate's BabelDOC layout pipeline
is not included in this repository.

## Contributing

Issues and pull requests are welcome. Before submitting:

1. Run `npm test`.
2. If you changed anything under `src/`, run `npm run build` again and commit the generated
   `client.js`.
3. Describe the test environment, reproduction steps and screenshots (for UI changes) in the PR.
4. Do not commit personal PDFs, API keys, profile configuration or logs containing personal paths.

## License

The plugin code is released under the [MIT License](LICENSE). PDF.js is distributed under
Apache-2.0; see [assets/PDFJS-LICENSE](assets/PDFJS-LICENSE).
