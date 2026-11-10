export const CSS = String.raw`
.pmr-root {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 420px;
  overflow: hidden;
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  font-family: inherit;
  font-size: 13px;
  line-height: 1.45;
}
.pmr-root *, .pmr-root *::before, .pmr-root *::after { box-sizing: border-box; }
.pmr-root button, .pmr-root input, .pmr-root select, .pmr-root textarea { font: inherit; }
.pmr-root button { color: var(--dsw-alias-label-primary); -webkit-tap-highlight-color: transparent; }
.pmr-root .pmr-btn-primary { color: #fff; }
.pmr-root .pmr-btn-primary:hover { color: #fff; }

.pmr-topbar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 0 0 auto;
  min-height: 54px;
  padding: 8px 12px 8px 14px;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-1);
}
.pmr-brand { display: flex; align-items: center; gap: 9px; min-width: 0; }
.pmr-brand-mark {
  display: block;
  width: 30px;
  height: 30px;
  border-radius: 9px;
  object-fit: cover;
  flex: 0 0 auto;
}
.pmr-brand-text { min-width: 0; }
.pmr-brand-title { font-size: 13px; font-weight: 650; letter-spacing: .01em; white-space: nowrap; }
.pmr-brand-sub { font-size: 11px; color: var(--dsw-alias-label-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pmr-doc-title { font-size: 12px; color: var(--dsw-alias-label-secondary); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.pmr-toolbar { display: flex; align-items: center; gap: 4px; margin-left: auto; flex-wrap: nowrap; }
.pmr-group {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 2px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 9px;
  background: var(--dsw-alias-bg-base);
}
.pmr-btn, .pmr-iconbtn, .pmr-tabbtn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
  white-space: nowrap;
  transition: background .12s ease, color .12s ease, border-color .12s ease;
}
.pmr-btn { height: 30px; padding: 0 10px; font-size: 12px; }
.pmr-iconbtn { width: 30px; height: 30px; }
.pmr-btn:hover, .pmr-iconbtn:hover, .pmr-tabbtn:hover { background: var(--dsw-alias-bg-layer-2); }
.pmr-btn:disabled, .pmr-iconbtn:disabled, .pmr-tabbtn:disabled { opacity: .42; cursor: default; }
.pmr-btn:focus-visible, .pmr-iconbtn:focus-visible, .pmr-tabbtn:focus-visible,
.pmr-select:focus-visible, .pmr-input:focus-visible, .pmr-textarea:focus-visible,
.pmr-model-select:focus-visible,
.pmr-viewswitch button:focus-visible, .pmr-fontctl button:focus-visible,
.pmr-seg button:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px;
}
.pmr-btn-primary {
  background: var(--dsw-alias-brand-primary);
  color: #fff;
  border: 1px solid transparent;
  height: 30px;
  padding: 0 12px;
  font-weight: 600;
}
.pmr-btn-primary:hover { filter: brightness(1.06); background: var(--dsw-alias-brand-primary); }
.pmr-btn-ghost { border: 1px solid var(--dsw-alias-border-l1); }
.pmr-btn-danger { color: var(--dsw-alias-state-error-primary); }
.pmr-divider { width: 1px; height: 22px; background: var(--dsw-alias-border-l1); margin: 0 2px; }
.pmr-select, .pmr-input {
  height: 30px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 8px;
  background: var(--dsw-alias-bg-base);
  padding: 0 8px;
  font-size: 12px;
  color: var(--dsw-alias-label-primary);
}
.pmr-select { max-width: 132px; }
.pmr-input { width: 58px; text-align: center; }

.pmr-body { display: flex; flex: 1 1 auto; min-height: 0; }
.pmr-rail {
  flex: 0 0 218px;
  min-width: 0;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-1);
  overflow: hidden;
}
.pmr-rail-head {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
  padding: 8px;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
}
.pmr-tabbtn { height: 26px; padding: 0 9px; font-size: 11px; color: var(--dsw-alias-label-secondary); }
.pmr-tabbtn.is-active { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); font-weight: 600; }
.pmr-iconbtn.is-active { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-brand-primary); }
.pmr-rail-scroll { flex: 1 1 auto; overflow: auto; padding: 6px; }
.pmr-outline-row {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  width: 100%;
  padding: 5px 7px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  text-align: left;
  cursor: pointer;
  font-size: 11.5px;
  line-height: 1.35;
}
.pmr-outline-row:hover { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.pmr-outline-row.is-current { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.pmr-outline-num { flex: 0 0 auto; font-variant-numeric: tabular-nums; color: var(--dsw-alias-label-secondary); opacity: .75; }
.pmr-outline-title { min-width: 0; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.pmr-empty-note { padding: 18px 12px; color: var(--dsw-alias-label-secondary); font-size: 11.5px; line-height: 1.5; }
.pmr-reference-list { display: flex; flex-direction: column; gap: 2px; }
.pmr-reference-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 3px 7px 7px;
  color: var(--dsw-alias-label-secondary);
  font-size: 10px;
  letter-spacing: .06em;
  text-transform: uppercase;
}
.pmr-reference-copyall {
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
}
.pmr-reference-copyall:hover { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.pmr-reference-row {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: 6px;
  width: 100%;
  padding: 6px 26px 6px 7px;
  border-radius: 6px;
  color: var(--dsw-alias-label-secondary);
  font-size: 10.5px;
  line-height: 1.45;
  text-align: left;
  user-select: text;
  -webkit-user-select: text;
}
.pmr-reference-copy {
  position: absolute;
  top: 4px;
  right: 2px;
  width: 20px;
  height: 20px;
  opacity: 0;
}
.pmr-reference-row:hover .pmr-reference-copy { opacity: 1; }
@media (hover: none) { .pmr-reference-copy { opacity: .8; } }
.pmr-reference-num {
  flex: 0 0 auto;
  min-width: 17px;
  text-align: right;
  color: var(--dsw-alias-label-secondary);
  font-variant-numeric: tabular-nums;
  opacity: .75;
}
.pmr-reference-text {
  min-width: 0;
  overflow-wrap: anywhere;
}
.pmr-search { display: flex; flex-direction: column; gap: 6px; }
.pmr-search-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 7px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 7px;
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-secondary);
}
.pmr-search-bar:focus-within { border-color: var(--dsw-alias-brand-primary); }
.pmr-search-input {
  flex: 1 1 auto;
  min-width: 0;
  height: 24px;
  padding: 0;
  border: 0;
  outline: none;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 11.5px;
}
.pmr-search-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 0 3px;
  color: var(--dsw-alias-label-secondary);
  font-size: 10.5px;
  line-height: 1.45;
}
.pmr-search-meta.is-error { color: var(--dsw-alias-state-error-primary); }
.pmr-search-progress { font-variant-numeric: tabular-nums; opacity: .8; }
.pmr-search-results { display: flex; flex-direction: column; gap: 1px; }
.pmr-search-group {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 3px 0;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
}
.pmr-search-group:last-child { border-bottom: 0; }
.pmr-search-hit {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  width: 100%;
  padding: 4px 6px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  text-align: left;
  cursor: pointer;
  font-size: 10.5px;
  line-height: 1.45;
}
.pmr-search-hit:hover { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.pmr-search-pageno {
  flex: 0 0 20px;
  text-align: right;
  color: var(--dsw-alias-label-secondary);
  font-variant-numeric: tabular-nums;
  font-size: 10px;
  opacity: .75;
}
.pmr-search-snippet { min-width: 0; overflow-wrap: anywhere; }
.pmr-search-snippet mark {
  padding: 0 1px;
  border-radius: 2px;
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 18%, transparent);
  color: var(--dsw-alias-label-primary);
}
.pmr-search-more {
  padding: 2px 26px 3px;
  color: var(--dsw-alias-label-secondary);
  font-size: 9.5px;
  line-height: 1.45;
  opacity: .8;
}
.pmr-search-overlay {
  position: absolute;
  z-index: 18;
  top: 62px;
  right: 12px;
  display: flex;
  flex-direction: column;
  width: min(420px, calc(100% - 24px));
  max-height: calc(100% - 76px);
  padding: 8px;
  overflow: hidden;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 12px;
  background: var(--dsw-alias-bg-overlay);
  box-shadow: 0 18px 50px rgba(0,0,0,.22);
}
.pmr-search-overlay .pmr-search { flex: 1 1 auto; min-height: 0; }
.pmr-search-overlay .pmr-search-results { flex: 1 1 auto; min-height: 0; overflow: auto; }
.pmr-thumbs { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.pmr-thumb {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 6px 4px 5px;
  border: 1px solid transparent;
  border-radius: 7px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font-size: 10.5px;
  cursor: pointer;
}
.pmr-thumb:hover { background: var(--dsw-alias-bg-layer-2); }
.pmr-thumb.is-active { border-color: var(--dsw-alias-brand-primary); color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-layer-2); }
.pmr-thumb-page {
  position: relative;
  width: 100%;
  aspect-ratio: 0.72;
  border-radius: 3px;
  background: #fff;
  box-shadow: 0 1px 4px rgba(0,0,0,.16);
  display: grid;
  place-items: center;
  overflow: hidden;
  color: #475569;
  font-size: 15px;
  font-weight: 650;
}
.pmr-thumb-canvas { width: 100% !important; height: 100% !important; display: block; object-fit: contain; }
.pmr-thumb-img { width: 100%; height: 100%; display: block; object-fit: contain; }
.pmr-thumb-loading {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  background: color-mix(in srgb, var(--dsw-alias-bg-layer-2) 82%, #fff);
}
.pmr-thumb-failed {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  color: var(--dsw-alias-state-error-primary);
  background: var(--dsw-alias-bg-layer-2);
  font-size: 16px;
}

.pmr-viewer {
  position: relative;
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: var(--dsw-alias-bg-layer-2);
}
.pmr-viewer-scroll { flex: 1 1 auto; overflow: auto; padding: 22px 18px 34px; min-height: 0; }
.pmr-stage { display: flex; justify-content: center; align-items: flex-start; min-width: min-content; }
.pmr-page {
  position: relative;
  flex: 0 0 auto;
  background: #fff;
  box-shadow: 0 1px 2px rgba(0,0,0,.18), 0 12px 34px rgba(0,0,0,.16);
  border-radius: 1px;
  overflow: hidden;
}
.pmr-canvas { display: block; background: #fff; }
.pmr-highlights { position: absolute; inset: 0; pointer-events: none; z-index: 0; }
.pmr-hl {
  position: absolute;
  border-radius: 2px;
  background: rgba(245,158,11,.22);
  box-shadow: inset 0 0 0 1px rgba(245,158,11,.35);
}
.pmr-hl.pmr-note-hl {
  background: rgba(250,204,21,.24);
  box-shadow: inset 0 0 0 1px rgba(202,138,4,.32);
}
.pmr-hl.pmr-search-hl {
  background: rgba(37,99,235,.17);
  box-shadow: inset 0 0 0 1px rgba(37,99,235,.32);
}
.pmr-hl.pmr-search-hl.is-current {
  background: rgba(250,204,21,.42);
  box-shadow: inset 0 0 0 1.5px rgba(202,138,4,.7);
}
.pmr-textlayer {
  position: absolute;
  inset: 0;
  overflow: clip;
  line-height: 1;
  text-align: initial;
  text-size-adjust: none;
  forced-color-adjust: none;
  transform-origin: 0 0;
  caret-color: CanvasText;
  z-index: 1;
  user-select: text;
  -webkit-user-select: text;
}
.pmr-textlayer > :not(.markedContent),
.pmr-textlayer .markedContent span:not(.markedContent) {
  z-index: 1;
}
.pmr-textlayer :is(span, br) {
  color: transparent;
  position: absolute;
  white-space: pre;
  cursor: text;
  transform-origin: 0% 0%;
}
.pmr-textlayer .markedContent { top: 0; height: 0; }
.pmr-textlayer span[role="img"] { user-select: none; cursor: default; }
.pmr-textlayer ::selection { background: rgba(37,99,235,.30); }
.pmr-textlayer br::selection { background: transparent; }
.pmr-textlayer .endOfContent {
  display: block;
  position: absolute;
  inset: 100% 0 0;
  z-index: -1;
  cursor: default;
  user-select: none;
}
.pmr-resizer {
  flex: 0 0 6px;
  cursor: col-resize;
  position: relative;
  z-index: 4;
  background: transparent;
  touch-action: none;
}
.pmr-resizer::after {
  content: "";
  position: absolute;
  top: 12px;
  bottom: 12px;
  left: 2px;
  width: 2px;
  border-radius: 2px;
  background: var(--dsw-alias-border-l1);
  opacity: .55;
  transition: opacity .12s ease, background .12s ease;
}
.pmr-resizer:hover::after, .pmr-root.is-resizing .pmr-resizer::after {
  opacity: 1;
  background: var(--dsw-alias-brand-primary);
}
.pmr-page-loading {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  background: rgba(255,255,255,.75);
  color: #334155;
  font-size: 12px;
}

.pmr-translation {
  flex: 0 0 390px;
  min-width: 0;
  display: flex;
  flex-direction: column;
  border-left: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-1);
  overflow: hidden;
}
.pmr-tr-head { flex: 0 0 auto; padding: 10px 14px 11px; border-bottom: 1px solid var(--dsw-alias-border-l1); }
.pmr-tr-headrow { display: flex; align-items: center; gap: 8px; min-height: 24px; }
.pmr-tr-title { font-size: 12px; font-weight: 650; }
.pmr-tr-pageno { font-size: 11.5px; font-weight: 600; color: var(--dsw-alias-label-secondary); letter-spacing: .015em; }
.pmr-tr-actions { margin-left: auto; display: inline-flex; gap: 4px; }
.pmr-fontctl {
  display: inline-flex;
  align-items: center;
  gap: 1px;
  height: 24px;
  padding: 0 2px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 7px;
  background: var(--dsw-alias-bg-base);
}
.pmr-fontctl button {
  display: grid;
  place-items: center;
  width: 24px;
  height: 19px;
  padding: 0;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font-size: 10.5px;
  font-weight: 600;
  cursor: pointer;
}
.pmr-fontctl button:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.pmr-fontctl button:disabled { opacity: .35; cursor: default; }
.pmr-fontctl-value { min-width: 18px; text-align: center; color: var(--dsw-alias-label-secondary); font-size: 9.5px; font-variant-numeric: tabular-nums; }
.pmr-modelbar { display: flex; align-items: center; gap: 6px; margin-top: 8px; min-width: 0; }
.pmr-model-field { display: flex; align-items: center; gap: 5px; min-width: 0; flex: 1 1 0; }
.pmr-model-field > span {
  flex: 0 0 auto;
  color: var(--dsw-alias-label-secondary);
  font-size: 9.5px;
  font-weight: 650;
  letter-spacing: .08em;
  text-transform: uppercase;
}
.pmr-model-field.is-reasoning { flex: 0 1 122px; }
.pmr-model-select {
  flex: 1 1 auto;
  min-width: 0;
  height: 26px;
  padding: 0 5px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 7px;
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  font-size: 10.5px;
}
.pmr-model-select:disabled { opacity: .6; }
.pmr-model-state { flex: 0 0 auto; color: var(--dsw-alias-label-secondary); font-size: 9.5px; white-space: nowrap; }
.pmr-seg {
  display: inline-flex;
  padding: 2px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 7px;
  background: var(--dsw-alias-bg-base);
}
.pmr-seg button { height: 23px; border: 0; border-radius: 5px; background: transparent; color: var(--dsw-alias-label-secondary); padding: 0 7px; font-size: 10.5px; cursor: pointer; }
.pmr-seg button.is-active { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); font-weight: 600; }
.pmr-viewswitch {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 3px;
  margin-top: 8px;
  padding: 3px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 9px;
  background: var(--dsw-alias-bg-base);
}
.pmr-viewswitch button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  height: 29px;
  padding: 0 5px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font-size: 11.5px;
  white-space: nowrap;
  cursor: pointer;
}
.pmr-viewswitch button:hover { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.pmr-viewswitch button.is-active {
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 11%, var(--dsw-alias-bg-base));
  color: var(--dsw-alias-brand-primary);
  font-weight: 650;
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--dsw-alias-brand-primary) 26%, transparent);
}
.pmr-tr-hint { display: flex; align-items: center; gap: 5px; margin-top: 8px; color: var(--dsw-alias-label-secondary); font-size: 10.5px; }
.pmr-tr-tabs { display: flex; align-items: center; gap: 3px; }
.pmr-rtab {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 28px;
  padding: 0 8px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
  cursor: pointer;
  white-space: nowrap;
}
.pmr-rtab:hover { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.pmr-rtab.is-active { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); font-weight: 600; }
.pmr-tab-badge {
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 8px;
  background: var(--dsw-alias-brand-primary);
  color: #fff;
  font-size: 9px;
  font-weight: 600;
  display: grid;
  place-items: center;
}
.pmr-tr-scroll {
  flex: 1 1 auto;
  overflow: auto;
  padding: 13px 14px 32px;
  font-size: var(--pmr-reading-size, 16px);
  user-select: text;
  -webkit-user-select: text;
}
.pmr-seg-src, .pmr-seg-tr, .pmr-title-src, .pmr-title-tr,
.pmr-abstract-src, .pmr-abstract-tr, .pmr-keywords-src, .pmr-keywords-tr,
.pmr-author-name, .pmr-author-meta { user-select: text; -webkit-user-select: text; }
.pmr-notes-pane { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; }
.pmr-return-row { flex: 0 0 auto; padding: 8px 10px 0; }
.pmr-return-row .pmr-btn { height: 25px; padding: 0 8px; font-size: 10.5px; }
.pmr-notes-toolbar { flex: 0 0 auto; display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 10px 0; color: var(--dsw-alias-label-secondary); font-size: 10px; }
.pmr-notes-toolbar .pmr-btn { height: 24px; padding: 0 8px; font-size: 10px; }
.pmr-note-compose { flex: 0 0 auto; padding: 9px 10px 10px; border-bottom: 1px solid var(--dsw-alias-border-l1); }
.pmr-note-target { display: flex; align-items: flex-start; gap: 6px; margin-bottom: 7px; min-width: 0; }
.pmr-note-quote {
  min-width: 0;
  max-height: 56px;
  overflow: auto;
  color: var(--dsw-alias-label-secondary);
  font-size: 10.5px;
  line-height: 1.5;
  white-space: pre-wrap;
}
.pmr-tag {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  height: 18px;
  padding: 0 5px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 5px;
  color: var(--dsw-alias-label-secondary);
  background: var(--dsw-alias-bg-base);
  font-size: 9.5px;
  font-weight: 600;
}
.pmr-note-textarea { min-height: 76px; }
.pmr-note-actions { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 6px; }
.pmr-note-mode { font-size: 10px; color: var(--dsw-alias-label-secondary); }
.pmr-note-list { flex: 1 1 auto; overflow: auto; padding: 9px 10px 18px; }
.pmr-note-card {
  padding: 9px 10px;
  margin-bottom: 8px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 8px;
  background: var(--dsw-alias-bg-base);
  cursor: pointer;
  transition: border-color .12s ease, background .12s ease;
}
.pmr-note-card:hover, .pmr-note-card:focus-visible { border-color: var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-2); outline: none; }
.pmr-note-meta { display: flex; align-items: center; gap: 6px; margin-bottom: 5px; }
.pmr-note-count { font-size: 9.5px; color: var(--dsw-alias-label-secondary); margin-left: auto; }
.pmr-note-copy { width: 20px; height: 20px; flex: 0 0 auto; }
.pmr-note-copy:hover { color: var(--dsw-alias-label-primary); }
.pmr-note-delete { width: 20px; height: 20px; border: 0; border-radius: 5px; background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; display: grid; place-items: center; }
.pmr-note-delete:hover { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-state-error-primary); }
.pmr-note-source { color: var(--dsw-alias-label-secondary); font-size: 10.5px; line-height: 1.5; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.pmr-note-body { margin-top: 6px; color: var(--dsw-alias-label-primary); font-size: 12px; line-height: 1.55; white-space: pre-wrap; overflow-wrap: anywhere; }
.pmr-chat-pane { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; }
.pmr-chat-toolbar { flex: 0 0 auto; display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-bottom: 1px solid var(--dsw-alias-border-l1); }
.pmr-chat-toolbar .pmr-btn { margin-left: auto; height: 24px; padding: 0 8px; font-size: 10.5px; }
.pmr-chat-pane > .pmr-modelbar { padding: 0 10px; }
.pmr-skill-row { flex: 0 0 auto; display: flex; align-items: center; gap: 5px; padding: 7px 10px 0; }
.pmr-skill-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  max-width: 100%;
  height: 26px;
  padding: 0 9px;
  border: 1px dashed var(--dsw-alias-border-l2);
  border-radius: 7px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font-size: 10.5px;
  cursor: pointer;
}
.pmr-skill-chip span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pmr-skill-chip:hover { color: var(--dsw-alias-label-primary); border-color: var(--dsw-alias-brand-primary); }
.pmr-skill-chip.has-skill { border-style: solid; color: var(--dsw-alias-label-primary); background: color-mix(in srgb, var(--dsw-alias-brand-primary) 8%, var(--dsw-alias-bg-base)); }
.pmr-skill-remove { width: 22px; height: 22px; border: 0; border-radius: 5px; background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; display: grid; place-items: center; }
.pmr-skill-remove:hover { color: var(--dsw-alias-state-error-primary); background: var(--dsw-alias-bg-layer-2); }
.pmr-skill-panel { flex: 0 0 auto; margin: 7px 10px 8px; padding: 7px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; background: var(--dsw-alias-bg-overlay); box-shadow: 0 8px 24px rgba(0,0,0,.12); }
.pmr-skill-panel-head { display: flex; align-items: center; gap: 6px; padding: 2px 2px 6px; font-size: 11px; font-weight: 600; }
.pmr-skill-list { max-height: 180px; overflow: auto; display: flex; flex-direction: column; gap: 3px; }
.pmr-skill-item { display: flex; flex-direction: column; gap: 2px; width: 100%; padding: 6px 7px; border: 0; border-radius: 6px; background: transparent; text-align: left; cursor: pointer; }
.pmr-skill-item:hover { background: var(--dsw-alias-bg-layer-2); }
.pmr-skill-name { color: var(--dsw-alias-label-primary); font-size: 10.5px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pmr-skill-desc { color: var(--dsw-alias-label-secondary); font-size: 10px; line-height: 1.4; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.pmr-skill-state { display: flex; align-items: center; gap: 6px; padding: 8px 4px; color: var(--dsw-alias-label-secondary); font-size: 10.5px; }
.pmr-skill-state.is-error { color: var(--dsw-alias-state-error-primary); }
.pmr-skill-file { display: flex; align-items: center; gap: 7px; margin-top: 6px; padding-top: 6px; border-top: 1px solid var(--dsw-alias-border-l1); color: var(--dsw-alias-label-secondary); font-size: 9.5px; }
.pmr-skill-file .pmr-btn { height: 24px; padding: 0 8px; font-size: 10px; }
.pmr-chat-scroll { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 10px; }
.pmr-chat-empty { height: auto; min-height: 100%; }
.pmr-chat-examples { display: flex; flex-direction: column; gap: 6px; width: 100%; max-width: 280px; margin-top: 4px; }
.pmr-chat-examples button {
  width: 100%;
  padding: 7px 9px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 7px;
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-secondary);
  font-size: 10.5px;
  line-height: 1.4;
  text-align: left;
  cursor: pointer;
}
.pmr-chat-examples button:hover { border-color: var(--dsw-alias-border-l2); color: var(--dsw-alias-label-primary); }
.pmr-msg { position: relative; display: flex; flex-direction: column; gap: 3px; margin-bottom: 10px; align-items: flex-start; }
.pmr-msg-copy { position: absolute; top: 2px; right: 2px; width: 22px; height: 22px; opacity: 0; }
.pmr-msg:hover .pmr-msg-copy, .pmr-msg-copy:focus-visible { opacity: 1; }
.pmr-msg.is-user { align-items: flex-end; }
.pmr-msg-role { font-size: 9.5px; color: var(--dsw-alias-label-secondary); padding: 0 3px; }
.pmr-msg-body {
  max-width: 94%;
  padding: 8px 10px;
  border-radius: 9px;
  background: var(--dsw-alias-bg-base);
  border: 1px solid var(--dsw-alias-border-l1);
  color: var(--dsw-alias-label-primary);
  font-size: 11.5px;
  line-height: 1.6;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.pmr-msg.is-user .pmr-msg-body { background: color-mix(in srgb, var(--dsw-alias-brand-primary) 9%, var(--dsw-alias-bg-base)); border-color: color-mix(in srgb, var(--dsw-alias-brand-primary) 24%, var(--dsw-alias-border-l1)); }
.pmr-msg-loading { display: flex; align-items: center; gap: 6px; color: var(--dsw-alias-label-secondary); }
.pmr-chat-compose { flex: 0 0 auto; display: flex; gap: 7px; align-items: flex-end; padding: 8px 10px; border-top: 1px solid var(--dsw-alias-border-l1); }
.pmr-chat-compose .pmr-textarea { min-height: 56px; flex: 1 1 auto; resize: vertical; }
.pmr-chat-compose .pmr-btn { height: 30px; flex: 0 0 auto; }
.pmr-chat-foot { flex: 0 0 auto; padding: 0 10px 8px; color: var(--dsw-alias-label-secondary); font-size: 9.5px; line-height: 1.4; }
.pmr-block-copy, .pmr-msg-copy, .pmr-note-copy, .pmr-reference-copy {
  display: grid;
  place-items: center;
  padding: 0;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 6px;
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  opacity: .42;
  transition: opacity .12s ease, color .12s ease;
}
.pmr-block-copy { position: absolute; top: 4px; right: 4px; z-index: 2; width: 22px; height: 22px; }
.pmr-block-copy:hover, .pmr-msg-copy:hover, .pmr-note-copy:hover, .pmr-reference-copy:hover,
.pmr-block-copy:focus-visible, .pmr-msg-copy:focus-visible, .pmr-note-copy:focus-visible,
.pmr-reference-copy:focus-visible {
  opacity: 1;
  color: var(--dsw-alias-label-primary);
}
.pmr-seg-card:hover .pmr-block-copy,
.pmr-title-block:hover .pmr-block-copy,
.pmr-author-block:hover .pmr-block-copy,
.pmr-article-block:hover .pmr-block-copy { opacity: 1; }
@media (hover: none) { .pmr-block-copy { opacity: .8; } }
.pmr-seg-card {
  position: relative;
  margin: 0 2px 12px;
  padding: 6px 24px 7px 8px;
  border: 1px solid transparent;
  border-radius: 9px;
  cursor: pointer;
  transition: background .12s ease, border-color .12s ease;
}
.pmr-seg-card:hover { background: var(--dsw-alias-bg-layer-2); }
.pmr-seg-card.is-active { border-color: var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-2); }
.pmr-seg-src {
  font-size: calc(var(--pmr-reading-size, 16px) - 2.5px);
  line-height: 1.62;
  color: color-mix(in srgb, var(--dsw-alias-label-primary) 76%, transparent);
  letter-spacing: .004em;
}
.pmr-seg-tr {
  margin-top: 5px;
  font-size: var(--pmr-reading-size, 16px);
  line-height: 1.74;
  color: var(--dsw-alias-label-primary);
  letter-spacing: .006em;
}
.pmr-seg-card.is-heading { margin-top: 28px; margin-bottom: 10px; padding: 2px 5px; }
.pmr-seg-card.is-heading .pmr-seg-src {
  font-size: calc(var(--pmr-reading-size, 16px) - 1px);
  font-weight: 650;
  line-height: 1.42;
  color: var(--dsw-alias-label-primary);
}
.pmr-seg-card.is-heading .pmr-seg-tr {
  margin-top: 4px;
  font-size: calc(var(--pmr-reading-size, 16px) + 1px);
  font-weight: 650;
  line-height: 1.42;
}
.pmr-seg-tr.is-placeholder { color: var(--dsw-alias-label-secondary); font-style: italic; font-size: 12px; }

.pmr-title-block {
  position: relative;
  margin: 4px 0 10px;
  padding: 8px 26px 15px 5px;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
  border-radius: 9px;
  cursor: pointer;
}
.pmr-title-src {
  font-size: calc(var(--pmr-reading-size, 16px) + 5px);
  line-height: 1.3;
  font-weight: 720;
  letter-spacing: -.012em;
  color: var(--dsw-alias-label-primary);
}
.pmr-title-tr {
  margin-top: 9px;
  font-size: calc(var(--pmr-reading-size, 16px) + 4px);
  line-height: 1.38;
  font-weight: 700;
  letter-spacing: -.004em;
  color: var(--dsw-alias-label-primary);
}
.pmr-title-tr.is-placeholder { margin-top: 6px; font-size: 12px; font-weight: 400; color: var(--dsw-alias-label-secondary); font-style: italic; }
.pmr-title-block.is-active { background: color-mix(in srgb, var(--dsw-alias-brand-primary) 5%, transparent); }

.pmr-author-block {
  position: relative;
  margin: 2px 0 20px;
  padding: 2px 26px 2px 5px;
  border-radius: 9px;
  cursor: pointer;
}
.pmr-author-block.is-active { background: color-mix(in srgb, var(--dsw-alias-brand-primary) 5%, transparent); }
.pmr-article-head { display: flex; align-items: baseline; gap: 8px; margin: 0 0 8px; }
.pmr-article-label {
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: .13em;
  text-transform: uppercase;
  color: var(--dsw-alias-brand-primary);
}
.pmr-article-orig { font-size: 10.5px; color: var(--dsw-alias-label-secondary); letter-spacing: .02em; }
.pmr-author-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 8px 14px; }
.pmr-author { min-width: 0; }
.pmr-author-name {
  font-size: calc(var(--pmr-reading-size, 16px) - 1.5px);
  font-weight: 650;
  line-height: 1.35;
  color: var(--dsw-alias-label-primary);
}
.pmr-author-marks { margin-left: 1px; font-size: .62em; font-weight: 500; color: var(--dsw-alias-brand-primary); }
.pmr-author-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 1px 8px;
  margin-top: 2px;
  font-size: calc(var(--pmr-reading-size, 16px) - 4.5px);
  line-height: 1.5;
  color: var(--dsw-alias-label-secondary);
}
.pmr-author-aff { color: color-mix(in srgb, var(--dsw-alias-label-primary) 72%, transparent); }
.pmr-author-aff-tr { color: var(--dsw-alias-label-secondary); }
.pmr-author-aff-tr::before { content: '· '; }
.pmr-author-email { color: color-mix(in srgb, var(--dsw-alias-brand-primary) 82%, var(--dsw-alias-label-primary)); text-decoration: none; overflow-wrap: anywhere; }
.pmr-author-email:hover { text-decoration: underline; }

.pmr-article-block { position: relative; margin: 18px 0 20px; padding: 2px 26px 2px 5px; border-radius: 9px; cursor: pointer; }
.pmr-abstract.is-continuation { margin-top: -10px; }
.pmr-article-block.is-active { background: color-mix(in srgb, var(--dsw-alias-brand-primary) 5%, transparent); }
.pmr-abstract-src {
  font-size: calc(var(--pmr-reading-size, 16px) - 2px);
  line-height: 1.68;
  color: color-mix(in srgb, var(--dsw-alias-label-primary) 78%, transparent);
}
.pmr-abstract-tr {
  margin-top: 7px;
  font-size: var(--pmr-reading-size, 16px);
  line-height: 1.8;
  color: var(--dsw-alias-label-primary);
}
.pmr-abstract-tr.is-placeholder, .pmr-keywords-tr.is-placeholder {
  color: var(--dsw-alias-label-secondary);
  font-style: italic;
  font-size: 12px;
}
.pmr-keywords { margin-top: 14px; }
.pmr-keywords-src {
  font-size: calc(var(--pmr-reading-size, 16px) - 2px);
  line-height: 1.65;
  color: color-mix(in srgb, var(--dsw-alias-label-primary) 78%, transparent);
}
.pmr-keywords-tr { margin-top: 5px; font-size: var(--pmr-reading-size, 16px); line-height: 1.7; color: var(--dsw-alias-label-primary); }

.pmr-tr-scroll[data-mode="translation"] .pmr-seg-card {
  margin: 0 0 14px;
  padding: 0 24px 0 5px;
  border-color: transparent;
  background: transparent;
}
.pmr-tr-scroll[data-mode="translation"] .pmr-seg-card:hover { background: transparent; }
.pmr-tr-scroll[data-mode="translation"] .pmr-seg-card.is-active {
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 5%, transparent);
}
.pmr-tr-scroll[data-mode="translation"] .pmr-seg-card.is-heading { margin-top: 28px; margin-bottom: 10px; }
.pmr-tr-scroll[data-mode="translation"] .pmr-seg-tr { margin-top: 0; }
.pmr-tr-scroll[data-mode="translation"] .pmr-title-block,
.pmr-tr-scroll[data-mode="translation"] .pmr-author-block,
.pmr-tr-scroll[data-mode="translation"] .pmr-article-block {
  background: transparent;
}
.pmr-seg-err { margin-top: 5px; font-size: 11px; color: var(--dsw-alias-state-error-primary); }
.pmr-seg-skeleton { height: 10px; margin-top: 7px; border-radius: 4px; background: var(--dsw-alias-bg-layer-2); animation: pmr-pulse 1.25s ease-in-out infinite; }
.pmr-seg-skeleton.short { width: 62%; }
.pmr-seg-err { display: flex; align-items: center; gap: 8px; margin-top: 5px; font-size: 11px; color: var(--dsw-alias-state-error-primary); }
.pmr-seg-err span { min-width: 0; }
.pmr-seg-retry {
  margin-left: auto;
  flex: 0 0 auto;
  height: 22px;
  padding: 0 7px;
  border: 1px solid color-mix(in srgb, var(--dsw-alias-state-error-primary) 40%, var(--dsw-alias-border-l1));
  border-radius: 5px;
  background: transparent;
  color: var(--dsw-alias-state-error-primary);
  font-size: 10px;
  cursor: pointer;
}
.pmr-seg-retry:hover { background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 8%, transparent); }
.pmr-tr-waiting { height: auto; min-height: 150px; margin-bottom: 6px; }

.pmr-eq-card {
  margin: 6px 0 9px;
  padding: 7px 8px 8px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 9px;
  background: var(--dsw-alias-bg-base);
  transition: border-color .12s ease, box-shadow .12s ease;
}
.pmr-eq-card.is-active {
  border-color: var(--dsw-alias-brand-primary);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--dsw-alias-brand-primary) 45%, transparent);
}
.pmr-eq-head { display: flex; align-items: center; gap: 6px; min-width: 0; margin-bottom: 6px; }
.pmr-eq-label { font-size: 11px; font-weight: 650; white-space: nowrap; }
.pmr-eq-badge {
  flex: 0 0 auto;
  height: 17px;
  padding: 0 6px;
  display: inline-flex;
  align-items: center;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 999px;
  color: var(--dsw-alias-label-secondary);
  font-size: 9px;
}
.pmr-eq-badge.is-manual {
  color: var(--dsw-alias-brand-primary);
  border-color: color-mix(in srgb, var(--dsw-alias-brand-primary) 40%, var(--dsw-alias-border-l1));
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 8%, transparent);
}
.pmr-eq-actions { margin-left: auto; display: inline-flex; gap: 1px; }
.pmr-eq-actions button {
  width: 22px;
  height: 22px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
}
.pmr-eq-actions button:hover { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.pmr-eq-actions button:disabled { opacity: .35; cursor: default; }
.pmr-eq-actions .pmr-eq-remove:hover { color: var(--dsw-alias-state-error-primary); }
.pmr-eq-scroll {
  display: flex;
  align-items: center;
  min-height: 46px;
  padding: 8px;
  overflow-x: auto;
  overflow-y: hidden;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 6px;
  background: #fff;
  cursor: pointer;
}
.pmr-eq-scroll:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.pmr-eq-image { display: block; flex: 0 0 auto; max-width: none; height: auto; }
.pmr-eq-loading { display: flex; align-items: center; gap: 7px; padding: 8px 4px; color: #64748b; font-size: 10.5px; }
.pmr-eq-fallback { padding: 4px; color: #334155; font-size: 11px; line-height: 1.45; white-space: pre-wrap; }
.pmr-eq-foot { display: flex; align-items: center; gap: 8px; margin-top: 5px; color: var(--dsw-alias-label-secondary); font-size: 9.5px; }
.pmr-eq-count { margin-left: auto; font-variant-numeric: tabular-nums; opacity: .7; }
.pmr-eq-count-badge { margin-left: auto; color: var(--dsw-alias-label-secondary); font-size: 9.5px; }
.pmr-count-badges { margin-left: auto; display: inline-flex; gap: 6px; }
.pmr-count-badges .pmr-eq-count-badge { margin-left: 0; }
.pmr-fig-labels { margin-top: 6px; padding-top: 5px; border-top: 1px dashed var(--dsw-alias-border-l1); }
.pmr-fig-labels summary {
  cursor: pointer;
  color: var(--dsw-alias-label-secondary);
  font-size: 10px;
  list-style-position: inside;
}
.pmr-fig-labels summary:hover { color: var(--dsw-alias-label-primary); }
.pmr-fig-note { margin: 5px 0 0; color: var(--dsw-alias-label-secondary); font-size: 9.5px; line-height: 1.45; }
.pmr-fig-label-list { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 5px; }
.pmr-fig-label {
  max-width: 100%;
  padding: 1px 6px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 4px;
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-secondary);
  font-size: 9.5px;
  line-height: 1.5;
  overflow-wrap: anywhere;
}
.pmr-fig-card .pmr-eq-scroll { min-height: 60px; }
.pmr-eq-reset { display: flex; justify-content: center; padding: 4px 0 10px; }
.pmr-eq-reset .pmr-btn { height: 24px; padding: 0 8px; font-size: 10px; }
.pmr-eq-hl { background: rgba(37,99,235,.16); box-shadow: inset 0 0 0 1.5px rgba(37,99,235,.5); }
.pmr-eq-selector {
  position: absolute;
  inset: 0;
  z-index: 5;
  cursor: crosshair;
  touch-action: none;
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 5%, transparent);
}
.pmr-eq-box {
  position: absolute;
  border: 1.5px dashed var(--dsw-alias-brand-primary);
  border-radius: 2px;
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 14%, transparent);
  pointer-events: none;
}
.pmr-eq-modal {
  position: fixed;
  inset: 0;
  z-index: 70;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(15, 23, 42, .64);
}
.pmr-eq-modal-body {
  display: flex;
  flex-direction: column;
  max-width: 94vw;
  max-height: 90vh;
  overflow: hidden;
  border-radius: 10px;
  background: var(--dsw-alias-bg-overlay);
  box-shadow: 0 24px 70px rgba(0,0,0,.35);
}
.pmr-eq-modal-head { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-bottom: 1px solid var(--dsw-alias-border-l1); font-size: 11.5px; font-weight: 600; }
.pmr-eq-modal-head .pmr-iconbtn { width: 24px; height: 24px; margin-left: auto; }
.pmr-eq-modal-scroll { overflow: auto; padding: 12px; background: #fff; }
.pmr-eq-modal-scroll img { display: block; height: auto; }
.pmr-tr-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; height: 100%; min-height: 160px; padding: 26px 22px; text-align: center; color: var(--dsw-alias-label-secondary); }
.pmr-tr-empty strong { color: var(--dsw-alias-label-primary); font-size: 12.5px; font-weight: 600; }
.pmr-tr-empty p { margin: 0; font-size: 11.5px; line-height: 1.55; max-width: 260px; }
.pmr-selection {
  flex: 0 0 auto;
  margin: 0 10px 10px;
  padding: 9px 10px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 9px;
  background: var(--dsw-alias-bg-overlay);
  box-shadow: 0 8px 24px rgba(0,0,0,.12);
}
.pmr-selection-head { display: flex; align-items: center; gap: 6px; margin-bottom: 5px; font-size: 10.5px; color: var(--dsw-alias-label-secondary); }
.pmr-selection-src { font-size: 11.5px; line-height: 1.5; max-height: 58px; overflow: auto; color: var(--dsw-alias-label-primary); }
.pmr-selection-tr { margin-top: 6px; padding-top: 6px; border-top: 1px dashed var(--dsw-alias-border-l1); font-size: 12px; line-height: 1.55; }
.pmr-selection-actions { display: flex; justify-content: flex-end; gap: 5px; margin-top: 6px; }
.pmr-selection-actions .pmr-btn { height: 26px; padding: 0 8px; font-size: 11px; }

.pmr-footer {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 30px;
  padding: 0 12px;
  border-top: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-secondary);
  font-size: 10.5px;
}
.pmr-status-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--dsw-alias-state-idle-primary); flex: 0 0 auto; }
.pmr-status-dot.is-ok { background: var(--dsw-alias-state-success-primary); }
.pmr-status-dot.is-error { background: var(--dsw-alias-state-error-primary); }
.pmr-status-dot.is-busy { background: var(--dsw-alias-state-warn-primary); animation: pmr-pulse 1s ease-in-out infinite; }
.pmr-foot-spacer { flex: 1 1 auto; }
.pmr-foot-item { display: inline-flex; align-items: center; gap: 5px; white-space: nowrap; }

.pmr-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1 1 auto;
  min-height: 0;
  padding: 30px;
  background:
    radial-gradient(circle at 25% 20%, color-mix(in srgb, var(--dsw-alias-brand-primary) 8%, transparent), transparent 42%),
    var(--dsw-alias-bg-base);
}
.pmr-empty-card { width: min(560px, 100%); text-align: center; }
.pmr-empty-icon {
  width: 62px;
  height: 62px;
  margin: 0 auto 16px;
  display: grid;
  place-items: center;
  border-radius: 18px;
  color: var(--dsw-alias-brand-primary);
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 11%, var(--dsw-alias-bg-layer-1));
  border: 1px solid var(--dsw-alias-border-l1);
}
.pmr-empty h1 { margin: 0 0 6px; font-size: 21px; letter-spacing: -.015em; font-weight: 680; }
.pmr-empty p { margin: 0 auto; max-width: 440px; color: var(--dsw-alias-label-secondary); font-size: 12.5px; line-height: 1.65; }
.pmr-empty-actions { display: flex; justify-content: center; align-items: center; gap: 10px; margin-top: 18px; flex-wrap: wrap; }
.pmr-empty-actions .pmr-btn-primary { height: 36px; padding: 0 18px; font-size: 12.5px; }
.pmr-drop-hint { margin-top: 12px; font-size: 11px; color: var(--dsw-alias-label-secondary); }
.pmr-features { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-top: 28px; text-align: left; }
.pmr-feature { padding: 11px 12px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; background: var(--dsw-alias-bg-layer-1); }
.pmr-feature-title { display: flex; align-items: center; gap: 6px; font-size: 11.5px; font-weight: 600; }
.pmr-feature-desc { margin-top: 5px; font-size: 10.5px; line-height: 1.5; color: var(--dsw-alias-label-secondary); }

.pmr-settings {
  position: absolute;
  z-index: 20;
  top: 58px;
  right: 12px;
  width: min(360px, calc(100vw - 40px));
  max-height: calc(100% - 76px);
  overflow: auto;
  padding: 14px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 12px;
  background: var(--dsw-alias-bg-overlay);
  box-shadow: 0 18px 50px rgba(0,0,0,.22);
}
.pmr-settings h2 { margin: 0 0 12px; font-size: 13px; font-weight: 650; }
.pmr-field { margin-bottom: 12px; }
.pmr-label { display: block; margin-bottom: 5px; font-size: 11px; font-weight: 600; color: var(--dsw-alias-label-secondary); }
.pmr-textarea {
  width: 100%;
  min-height: 92px;
  resize: vertical;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 8px;
  background: var(--dsw-alias-bg-base);
  padding: 7px 8px;
  font-size: 11.5px;
  line-height: 1.5;
}
.pmr-help { margin-top: 5px; font-size: 10.5px; line-height: 1.5; color: var(--dsw-alias-label-secondary); }
.pmr-model-row { display: flex; align-items: center; gap: 7px; padding: 7px 8px; border-radius: 8px; background: var(--dsw-alias-bg-layer-2); font-size: 11px; }
.pmr-settings-footer { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-top: 4px; color: var(--dsw-alias-label-secondary); font-size: 10px; }

.pmr-toast {
  position: absolute;
  z-index: 30;
  left: 50%;
  bottom: 44px;
  transform: translateX(-50%);
  max-width: min(520px, calc(100% - 40px));
  padding: 9px 13px;
  border-radius: 9px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-overlay);
  color: var(--dsw-alias-label-primary);
  box-shadow: 0 10px 30px rgba(0,0,0,.18);
  font-size: 11.5px;
  line-height: 1.45;
  display: flex;
  align-items: flex-start;
  gap: 7px;
}
.pmr-toast.is-error { border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 45%, var(--dsw-alias-border-l2)); }
.pmr-toast .pmr-toast-close { margin-left: auto; border: 0; background: transparent; color: inherit; cursor: pointer; padding: 0 2px; opacity: .7; }

.pmr-progress {
  position: absolute;
  z-index: 18;
  left: 0;
  right: 0;
  bottom: 30px;
  height: 3px;
  background: var(--dsw-alias-bg-layer-2);
  overflow: hidden;
}
.pmr-progress-bar { height: 100%; width: 0; background: var(--dsw-alias-brand-primary); transition: width .25s ease; }
.pmr-progress-label {
  position: absolute;
  right: 14px;
  bottom: 8px;
  padding: 4px 8px;
  border-radius: 6px;
  background: var(--dsw-alias-bg-overlay);
  border: 1px solid var(--dsw-alias-border-l1);
  color: var(--dsw-alias-label-secondary);
  font-size: 10px;
  pointer-events: none;
}

.pmr-spinner { width: 13px; height: 13px; border: 2px solid var(--dsw-alias-border-l2); border-top-color: var(--dsw-alias-brand-primary); border-radius: 50%; animation: pmr-spin .8s linear infinite; flex: 0 0 auto; }
.pmr-pulse { animation: pmr-pulse 1.25s ease-in-out infinite; }
@keyframes pmr-spin { to { transform: rotate(360deg); } }
@keyframes pmr-pulse { 0%,100% { opacity: .5; } 50% { opacity: 1; } }

.pmr-scroll::-webkit-scrollbar, .pmr-rail-scroll::-webkit-scrollbar, .pmr-tr-scroll::-webkit-scrollbar, .pmr-viewer-scroll::-webkit-scrollbar, .pmr-settings::-webkit-scrollbar { width: 10px; height: 10px; }
.pmr-scroll::-webkit-scrollbar-thumb, .pmr-rail-scroll::-webkit-scrollbar-thumb, .pmr-tr-scroll::-webkit-scrollbar-thumb, .pmr-viewer-scroll::-webkit-scrollbar-thumb, .pmr-settings::-webkit-scrollbar-thumb {
  background: color-mix(in srgb, var(--dsw-alias-label-secondary) 28%, transparent);
  border-radius: 8px;
  border: 2px solid transparent;
  background-clip: content-box;
}

@media (max-width: 1240px) {
  .pmr-rail { flex-basis: 188px; }
  .pmr-translation { flex-basis: 348px; }
  .pmr-brand-sub { display: none; }
  .pmr-toolbar .pmr-select { max-width: 108px; }
  .pmr-eq-select-text { display: none; }
  .pmr-eq-select-btn { width: 30px; padding: 0; }
}
@media (max-width: 1080px) {
  .pmr-toolbar .pmr-select { display: none; }
}
@media (max-width: 980px) {
  .pmr-rail { display: none; }
  .pmr-features { grid-template-columns: 1fr; }
  .pmr-empty { overflow: auto; }
  .pmr-brand-text { display: none; }
}
@media (max-width: 760px) {
  .pmr-translation { flex-basis: 300px; }
  .pmr-doc-title { display: none; }
}

.pmr-menu {
  position: absolute;
  z-index: 25;
  top: calc(100% + 6px);
  right: 0;
  min-width: 210px;
  padding: 5px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 9px;
  background: var(--dsw-alias-bg-overlay);
  box-shadow: 0 12px 34px rgba(0,0,0,.20);
}
.pmr-menu button {
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  padding: 7px 8px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font-size: 11.5px;
  text-align: left;
  cursor: pointer;
}
.pmr-menu button:hover { background: var(--dsw-alias-bg-layer-2); }
.pmr-scrim { position: absolute; inset: 0; z-index: 19; background: transparent; }
.pmr-drop-overlay {
  position: absolute;
  z-index: 40;
  inset: 10px;
  display: grid;
  place-items: center;
  border: 2px dashed var(--dsw-alias-brand-primary);
  border-radius: 14px;
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 10%, var(--dsw-alias-bg-base));
  color: var(--dsw-alias-brand-primary);
  font-size: 14px;
  font-weight: 600;
  pointer-events: none;
}

.pmr-inline-error {
  display: flex;
  align-items: flex-start;
  gap: 7px;
  margin: 8px 10px;
  padding: 8px 9px;
  border: 1px solid color-mix(in srgb, var(--dsw-alias-state-error-primary) 38%, var(--dsw-alias-border-l1));
  border-radius: 8px;
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 7%, var(--dsw-alias-bg-base));
  color: var(--dsw-alias-state-error-primary);
  font-size: 11px;
  line-height: 1.45;
}
.pmr-inline-error .pmr-btn { margin-left: auto; flex: 0 0 auto; height: 24px; padding: 0 7px; }
`