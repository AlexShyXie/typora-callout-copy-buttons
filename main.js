/**
 * Callout Copy Button — for typora-community-plugin
 *
 * Ported from alythobani/obsidian-callout-copy-buttons (MIT), retargeted to
 * Typora's native GitHub-style alerts (`.md-alert`, Typora >= 1.8).
 *
 * Settings mirror the original plugin's toggle-per-button model: three
 * independent switches, each enabling one button on every alert's top-right
 * corner. Want a single button? Turn the other two off. Defaults ship with
 * only the select button enabled.
 *
 *   Show "Select callout" button        (default ON)
 *     Click -> select the WHOLE callout in the editor (title line + body,
 *     header included). What Ctrl+C yields afterwards is decided by
 *     Typora's own copy logic, exactly like a manual mouse selection.
 *   Show "Copy (plain text)" button     (default OFF)
 *     Click -> copy the callout BODY as plain text: no "[!Note]" title
 *     line, no inline markdown marks ("**" stripped).
 *     Same semantics as the original plugin's "Copy (plain text)".
 *   Show "Copy (Markdown)" button       (default OFF)
 *     Click -> copy the callout BODY as markdown source: no title line,
 *     inline syntax kept ("**bold**" stays).
 *     Same semantics as the original plugin's "Copy (Markdown)".
 *
 * "Body" excludes the title line. For
 *     > [!Note]
 *     > type: strikeout
 *     > page: 1
 * the body is the lines "type: strikeout" / "page: 1" (prefix stripped,
 * exactly like the original plugin).
 *
 * Typora APIs used (verification status in README):
 *   - HtmlPostProcessor.from + renderButton     (tcp core, stable API)
 *   - File.editor.UserOp.setClipboard           (same call as the official
 *                                                typora-plugin-codeblock-copy-button)
 *   - File.editor.selection.rangy.createRange
 *     + setStartBefore/setEndAfter + setRange   (same calls as obgnail/typora_plugin)
 *   - File.editor.UserOp.getMarkdownSourceFrom (declared in official
 *                                                @typora-community-plugin/typora-types;
 *                                                plain-text fallback if missing)
 */

const core = window[Symbol.for("typora-plugin-core@v2")];
const { Plugin, PluginSettings, SettingTab, I18n, Notice, HtmlPostProcessor } = core;

/* --------------------------------------------------------------------------
 * i18n (embedded; I18n auto-picks locale from Typora settings, falls back to en)
 * ------------------------------------------------------------------------ */
const LOCALES = {
  en: {
    pluginName: "Callout Copy Button",
    settings: {
      showSelect: {
        name: 'Show "Select callout" button',
        desc: "Click selects the whole callout (title line + body) in the editor.",
      },
      showPlain: {
        name: 'Show "Copy (plain text)" button',
        desc: 'Click copies the callout body as plain text: no "[!Type]" title line, no inline markdown marks.',
      },
      showMd: {
        name: 'Show "Copy (Markdown)" button',
        desc: "Click copies the WHOLE callout as Markdown source: \"> [!Type]\" title line and \"> \" prefixes included, ready to paste as a callout.",
      },
    },
    actSelect: "Select callout",
    actPlain: "Copy (plain text)",
    actMd: "Copy (Markdown)",
    copiedPlain: "Copied callout body (plain text)",
    copiedMd: "Copied whole callout (Markdown)",
    emptyBody: "This callout has no body to copy",
    selectFailed: "Select failed",
    copyFailed: "Copy failed",
    mdFallback:
      "getMarkdownSourceFrom is unavailable in this Typora build; copied as plain text instead",
  },
  "zh-cn": {
    pluginName: "Callout Copy Button",
    settings: {
      showSelect: {
        name: "显示“选中 callout”按钮",
        desc: "点击后选中整个 callout（含标题行与正文）。",
      },
      showPlain: {
        name: "显示“复制（纯文本）”按钮",
        desc: "点击后复制正文纯文本：不含 [!类型] 标题行、不含行内 Markdown 标记。",
      },
      showMd: {
        name: "显示“复制（Markdown）”按钮",
        desc: "点击后复制整个 callout 的 Markdown 源码：含 \"> [!类型]\" 标题行与 \"> \" 前缀，粘贴后仍是 callout。",
      },
    },
    actSelect: "选中 callout",
    actPlain: "复制（纯文本）",
    actMd: "复制（Markdown）",
    copiedPlain: "已复制 callout 正文（纯文本）",
    copiedMd: "已复制整个 callout（Markdown）",
    emptyBody: "这个 callout 没有可复制的正文",
    selectFailed: "选中失败",
    copyFailed: "复制失败",
    mdFallback: "当前 Typora 版本不支持 getMarkdownSourceFrom，已改为复制纯文本",
  },
};

const DEFAULT_SETTINGS = {
  showSelectButton: true,
  showCopyPlainTextButton: false,
  showCopyMarkdownButton: false,
};

/* One descriptor per settings toggle -> one button when enabled. */
const BUTTON_DEFS = [
  {
    action: "select",
    settingsKey: "showSelectButton",
    className: "typ-callout-select-button",
    // inline SVG (I-beam text cursor): no dependency on Typora's bundled
    // FontAwesome (fa-hand-pointer-o turned out missing there)
    html:
      '<svg class="typ-callout-icon" viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">' +
      '<path d="M4 1.5h8M4 14.5h8M8 1.5v13" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/>' +
      "</svg>",
    titleKey: "actSelect",
  },
  {
    action: "copy-plain",
    settingsKey: "showCopyPlainTextButton",
    className: "typ-callout-plain-button",
    html: '<span class="typ-callout-letter">P</span>',
    titleKey: "actPlain",
  },
  {
    action: "copy-markdown",
    settingsKey: "showCopyMarkdownButton",
    className: "typ-callout-md-button",
    html: '<span class="typ-callout-letter">M</span>',
    titleKey: "actMd",
  },
];

/* --------------------------------------------------------------------------
 * DOM helpers
 * ------------------------------------------------------------------------ */

/**
 * Structure-agnostic extractors. Typora's exact WYSIWYG DOM shape for alerts
 * is undocumented, so nothing here assumes child layout.
 */

/**
 * Tags that start a new line in extracted text (Chromium innerText block
 * semantics, reimplemented as a pure function).
 *
 * WHY NOT `clone.innerText`: a cloneNode() result is detached from the
 * document, and the innerText spec says NOT-BEING-RENDERED elements return
 * their textContent instead — where <br> contributes nothing and block
 * boundaries produce no newline. On the real engine this collapsed the
 * whole callout onto one line (verified on Typora 1.14.9). This walker
 * needs no layout and no document attachment.
 */
const BLOCK_TAGS = new Set([
  "P", "DIV", "UL", "OL", "BLOCKQUOTE", "H1", "H2", "H3", "H4", "H5",
  "H6", "PRE", "HR", "TABLE", "THEAD", "TBODY", "FIGURE",
  "FIGCAPTION", "SECTION", "ARTICLE", "ASIDE",
]);

/** Tags that start a new line but join without blank lines (list items,
 *  table rows). */
const LINE_TAGS = new Set(["LI", "TR"]);

function domToText(el) {
  let out = "";
  (function visit(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      out += node.textContent;
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    if (node.tagName === "BR") {
      out += "\n";
      return;
    }
    const block = BLOCK_TAGS.has(node.tagName);
    const line = LINE_TAGS.has(node.tagName);
    if (block) out += "\n";
    else if (line && out !== "" && !out.endsWith("\n")) out += "\n";
    for (const c of node.childNodes) visit(c);
    if (block) out += "\n";
  })(el);
  return (
    out
      // whitespace-only lines carry no content (CSS collapses inter-block
      // whitespace; cloned DOM often keeps indented text nodes there)
      .split("\n")
      .map((l) => (/^\s+$/.test(l) ? "" : l))
      .join("\n")
  );
}

/**
 * Plain text of the alert BODY: no title line, no "> " prefix, no inline
 * markdown marks. Cleans Typora's hidden WYSIWYG markup first:
 *   - title elements (.md-alert-text-container / .md-alert-text — their
 *     visible text is CSS-generated from data-text, removal is lossless)
 *   - .md-meta / .md-content spans: raw syntax ("**", "#", "[…](…)")
 *   - inline-math <script>: not rendered
 *   - .md-softbreak ("<span> </span>" hard line break): becomes a <br>,
 *     after swallowing Typora's padding space in the next text node
 *     (same handling as obgnail/typora_plugin)
 */
function getAlertBodyPlainText(alertEl) {
  const clone = alertEl.cloneNode(true);
  clone.querySelectorAll(
    ".md-alert-text-container, .md-alert-text, .typ-buttons, .md-meta, .md-content, script"
  ).forEach((n) => n.remove());
  // a child element that IS the title itself (querySelectorAll misses it
  // when the class sits on the child, not a descendant)
  Array.from(clone.children).forEach((n) => {
    if (
      n.classList &&
      (n.classList.contains("md-alert-text-container") || n.classList.contains("md-alert-text"))
    )
      n.remove();
  });
  clone.querySelectorAll(".md-softbreak").forEach((n) => {
    const next = n.nextSibling;
    if (next && next.nodeType === Node.TEXT_NODE && next.textContent.startsWith(" ")) {
      next.textContent = next.textContent.slice(1);
    }
    n.replaceWith(document.createElement("br"));
  });
  return domToText(clone).replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * WHOLE-callout markdown: "> [!Note]" title line + "> "-prefixed body.
 *
 * getMarkdownSourceFrom($(alert)) returns the alert's source WITHOUT the
 * "> " prefix and WITHOUT the "[!TYPE]" title line (verified on Typora
 * 1.14.9). So this builds the full form from whatever shape comes back:
 *   1. strip any "> " prefix per line (idempotent, whatever the build)
 *   2. capture a "[!TYPE]" line if present (kept verbatim, case preserved)
 *   3. re-prefix every line with "> " (empty source lines become ">")
 *   4. prepend the title line — captured one, else derived from the DOM
 *      class (md-alert-note -> "[!note]")
 * Returns null when getMarkdownSourceFrom is unavailable (caller falls
 * back to plain text), "" when the alert has no source.
 */
function getAlertFullMarkdown(alertEl) {
  const getter =
    File.editor && File.editor.UserOp && File.editor.UserOp.getMarkdownSourceFrom;
  if (typeof getter !== "function") return null;
  const md = getter($(alertEl));
  if (md == null || String(md).trim() === "") return "";
  const lines = String(md).replace(/\r\n/g, "\n").split("\n");
  const out = [];
  let header = null;
  for (let line of lines) {
    line = line.replace(/^> ?/, "");
    const m = line.match(/^\[!(\w+)\][ \t]*(.*)$/);
    if (m && header === null) {
      header = "[!" + m[1] + "]" + (m[2] ? " " + m[2] : "");
      continue;
    }
    out.push(line === "" ? ">" : "> " + line);
  }
  if (header === null) {
    const cls = Array.from(alertEl.classList).find((c) => /^md-alert-[a-z]+$/.test(c));
    header = cls ? "[!" + cls.slice("md-alert-".length) + "]" : "[!NOTE]";
  }
  return ("> " + header + "\n" + out.join("\n")).replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Select the whole callout — title line through last body block — as a
 * native editor selection, so the user's next Ctrl+C goes through Typora's
 * own copy pipeline. The plugin's button group is excluded from the range.
 */
function selectWholeAlert(alertEl) {
  const sel = File.editor && File.editor.selection;
  if (
    !sel ||
    !sel.rangy ||
    typeof sel.rangy.createRange !== "function" ||
    typeof sel.setRange !== "function"
  ) {
    throw new Error("editor.selection API not available");
  }
  const selectable = Array.from(alertEl.children).filter(
    (el) => !el.classList.contains("typ-buttons")
  );
  if (selectable.length === 0) {
    throw new Error("callout has no selectable content");
  }
  const range = sel.rangy.createRange();
  range.setStartBefore(selectable[0]);
  range.setEndAfter(selectable[selectable.length - 1]);
  sel.setRange(range, true);
}

/* --------------------------------------------------------------------------
 * settings tab (three independent toggles, like the original plugin)
 * ------------------------------------------------------------------------ */
class CalloutCopySettingTab extends SettingTab {
  constructor(plugin) {
    super();
    this.plugin = plugin;
  }

  get name() {
    return this.plugin.i18n.t.pluginName;
  }

  show() {
    const { plugin } = this;
    const t = plugin.i18n.t.settings;
    this.addSettingTitle(plugin.i18n.t.pluginName);

    const addToggle = (settingsKey, label) =>
      this.addSetting((setting) => {
        setting.addName(label.name);
        setting.addDescription(label.desc);
        setting.addCheckbox((checkbox) => {
          checkbox.checked = !!plugin.settings.get(settingsKey);
          checkbox.onclick = () => {
            plugin.settings.set(settingsKey, checkbox.checked);
            plugin.refreshAllButtons(); // add/remove buttons right away
          };
        });
      });

    addToggle("showSelectButton", t.showSelect);
    addToggle("showCopyPlainTextButton", t.showPlain);
    addToggle("showCopyMarkdownButton", t.showMd);
    super.show();
  }

  hide() {
    this.containerEl.innerHTML = "";
    super.hide();
  }
}

/* --------------------------------------------------------------------------
 * plugin entry
 * ------------------------------------------------------------------------ */
class CalloutCopyButtonPlugin extends Plugin {
  constructor(app, manifest, config) {
    super(app, manifest, config);
    this.i18n = new I18n({ resources: LOCALES });
    this._processor = null;
  }

  onload() {
    this.registerSettings(new PluginSettings(this.app, this.manifest, { version: 1 }));
    this.settings.setDefault(DEFAULT_SETTINGS);
    this.registerSettingTab(new CalloutCopySettingTab(this));

    // One post-processor covers every alert. The core re-runs it on file
    // open and on every edit, so buttons follow DOM re-renders for free.
    const processor = HtmlPostProcessor.from({
      selector: ".md-alert",
      process: (alertEl) => this.syncButtons(alertEl, processor),
    });
    this._processor = processor;
    this.registerMarkdownPostProcessor(processor);

    // ---- cold-start fix (buttons used to appear only "after a while") ----
    // The core re-runs post-processors on: file open, edit, scroll (the
    // scroll path only covers codeblock-typed processors — not us). On a
    // fresh start, the restored file's pass can happen before this plugin
    // finishes loading, or before Typora finished rendering the alert DOM —
    // leaving alerts buttonless until the next unrelated edit event. The
    // original Obsidian plugin solves exactly this with its DOMObserver;
    // port the idea: one immediate sweep + an observer that reacts whenever
    // an .md-alert node gets inserted.
    this.refreshAllButtons();
    this._observeAlerts();
  }

  /**
   * Watch the writing area for inserted .md-alert elements (late renders,
   * file loads racing our registration) and sync buttons immediately.
   * Our own button insertions never match the filter, so no loops.
   */
  _observeAlerts() {
    const root =
      (File.editor && File.editor.writingArea) ||
      document.getElementById("write") ||
      document.body;
    if (!root) return;
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type !== "childList") continue;
        for (const n of m.addedNodes) {
          if (n.nodeType !== Node.ELEMENT_NODE) continue;
          if (
            (n.classList && n.classList.contains("md-alert")) ||
            (typeof n.querySelector === "function" && n.querySelector(".md-alert"))
          ) {
            this.refreshAllButtons();
            return;
          }
        }
      }
    });
    observer.observe(root, { childList: true, subtree: true });
    this.register(() => observer.disconnect());
  }

  /** Clean disable: remove this plugin's buttons; keep others' untouched. */
  onunload() {
    document
      .querySelectorAll(
        ".typ-callout-select-button, .typ-callout-plain-button, .typ-callout-md-button"
      )
      .forEach((b) => b.remove());
    document.querySelectorAll(".typ-buttons").forEach((g) => {
      if (g.children.length === 0) g.remove();
    });
  }

  /**
   * Bring one alert's buttons in line with current settings: add missing
   * ones (renderButton dedupes), remove disabled ones. Runs on every edit
   * and right after a settings toggle flips.
   */
  syncButtons(alertEl, processor) {
    processor = processor || this._processor;
    for (const def of BUTTON_DEFS) {
      const enabled = !!this.settings.get(def.settingsKey);
      const existing = alertEl.querySelector("." + def.className);
      if (existing && !enabled) existing.remove();
      if (!enabled) continue;
      processor.renderButton(alertEl, {
        className: def.className,
        text: def.html,
        title: this.i18n.t[def.titleKey],
        onclick: () => this.handleClick(def.action, alertEl),
      });
    }
    // Drop the button group entirely when this plugin disabled its last
    // button in it (other plugins' buttons, if any, are left untouched).
    const group = alertEl.querySelector(":scope > .typ-buttons");
    if (group && group.children.length === 0) group.remove();
  }

  /** Re-sync every alert in the current document. */
  refreshAllButtons() {
    const root = (File.editor && File.editor.writingArea) || document;
    root.querySelectorAll(".md-alert").forEach((el) => this.syncButtons(el));
  }

  handleClick(action, alertEl) {
    const t = this.i18n.t;
    try {
      if (action === "select") {
        selectWholeAlert(alertEl);
        return;
      }
      if (action === "copy-markdown") {
        const md = getAlertFullMarkdown(alertEl);
        if (md === null) {
          Notice.warning(t.mdFallback, 3000);
          const fb = getAlertBodyPlainText(alertEl);
          if (fb === "") return Notice.info(t.emptyBody, 2000);
          this.copyText(fb);
          Notice.info(t.copiedPlain, 2000);
          return;
        }
        if (md === "") return Notice.info(t.emptyBody, 2000);
        this.copyText(md);
        Notice.info(t.copiedMd, 2000);
        return;
      }
      // "copy-plain"
      const text = getAlertBodyPlainText(alertEl);
      if (text === "") return Notice.info(t.emptyBody, 2000);
      this.copyText(text);
      Notice.info(t.copiedPlain, 2000);
    } catch (e) {
      console.error("[callout-copy-button]", e);
      Notice.error(
        (action === "select" ? t.selectFailed : t.copyFailed) +
          ": " +
          (e && e.message ? e.message : e)
      );
    }
  }

  /** Plain text onto the clipboard. html=null keeps rich-text paste clean. */
  copyText(text) {
    const normalized = text.replace(/\r?\n/g, File.isWin ? "\r\n" : "\n");
    File.editor.UserOp.setClipboard(null, null, normalized, true);
  }
}

export default CalloutCopyButtonPlugin;
