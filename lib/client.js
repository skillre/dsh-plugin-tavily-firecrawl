window.__ModuleLoader__.load({
	id: "@skillre/dsh-plugin-tavily-firecrawl",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		"use strict";
		var __defProp = Object.defineProperty;
		var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
		var __getOwnPropNames = Object.getOwnPropertyNames;
		var __hasOwnProp = Object.prototype.hasOwnProperty;
		var __export = (target, all) => {
		  for (var name in all)
		    __defProp(target, name, { get: all[name], enumerable: true });
		};
		var __copyProps = (to, from, except, desc) => {
		  if (from && typeof from === "object" || typeof from === "function") {
		    for (let key of __getOwnPropNames(from))
		      if (!__hasOwnProp.call(to, key) && key !== except)
		        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
		  }
		  return to;
		};
		var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

		// src/client/index.ts
		var index_exports = {};
		__export(index_exports, {
		  apply: () => apply,
		  inject: () => inject
		});
		module.exports = __toCommonJS(index_exports);

		// src/client/view.ts
		var import_react = require("react");
		var h = import_react.createElement;
		var TAVILY_REF = "TAVILY_API_KEYS";
		var FIRECRAWL_REF = "FIRECRAWL_API_KEYS";
		var REFS = [TAVILY_REF, FIRECRAWL_REF];
		var PAGE_CSS = `
		.skafc-page { display: flex; flex-direction: column; gap: 18px; max-width: 640px; }
		.skafc-intro { margin: 0; font-size: 13px; line-height: 1.5; color: var(--dsw-alias-label-secondary); }
		.skafc-field { display: flex; flex-direction: column; gap: 6px; }
		.skafc-label { font-size: 13px; font-weight: 600; color: var(--dsw-alias-label-primary); }
		.skafc-hint { font-size: 12px; line-height: 1.5; color: var(--dsw-alias-label-secondary); }
		.skafc-status { font-size: 12px; font-weight: 600; }
		.skafc-status--ok { color: var(--dsw-alias-state-success-primary); }
		.skafc-status--missing { color: var(--dsw-alias-state-warn-primary); }
		.skafc-status--readonly { color: var(--dsw-alias-state-error-primary); }
		.skafc-input {
		  box-sizing: border-box; width: 100%; min-height: 76px; resize: vertical;
		  padding: 8px 10px; border-radius: 8px;
		  border: 1px solid var(--dsw-alias-border-l1);
		  background: var(--dsw-alias-bg-layer-1);
		  color: var(--dsw-alias-label-primary);
		  font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
		}
		.skafc-input:focus { outline: none; border-color: var(--dsw-alias-brand-primary); }
		.skafc-input:disabled { opacity: 0.6; }
		.skafc-clear {
		  align-self: flex-start; padding: 0; border: none; background: none;
		  font-size: 12px; cursor: pointer; color: var(--dsw-alias-state-error-primary);
		}
		.skafc-clear:disabled { cursor: default; opacity: 0.6; }
		.skafc-actions { display: flex; align-items: center; gap: 10px; }
		.skafc-btn {
		  padding: 6px 14px; border-radius: 8px; font-size: 13px; cursor: pointer;
		  border: 1px solid var(--dsw-alias-border-l1);
		  background: var(--dsw-alias-bg-layer-1);
		  color: var(--dsw-alias-label-primary);
		}
		.skafc-btn--primary {
		  border-color: var(--dsw-alias-brand-primary);
		  color: var(--dsw-alias-brand-primary);
		}
		.skafc-btn:disabled { cursor: default; opacity: 0.6; }
		.skafc-notice { font-size: 12px; color: var(--dsw-alias-label-secondary); }
		.skafc-notice--error { color: var(--dsw-alias-state-error-primary); }
		`;
		function toCredentialList(text) {
		  return text.split(/[\s,;]+/).filter((part) => part.length > 0).join(",");
		}
		function createCredentialPage(bindings) {
		  const { ctx, translate: t } = bindings;
		  const status = {};
		  for (const ref of REFS) status[ref] = { configured: false, writable: true };
		  const read = async (apply2) => {
		    const response = await ctx.remote.credentials.describe([...REFS]);
		    if (response.ok) apply2(response.value);
		  };
		  return function CredentialPage(props) {
		    const [staged, setStaged] = (0, import_react.useState)({ [TAVILY_REF]: "", [FIRECRAWL_REF]: "" });
		    const [state, setState] = (0, import_react.useState)({ ...status });
		    const [busy, setBusy] = (0, import_react.useState)(false);
		    const [notice, setNotice] = (0, import_react.useState)({ text: "", kind: "info" });
		    (0, import_react.useEffect)(() => {
		      let active = true;
		      void read((value) => {
		        if (!active) return;
		        setState({ ...status, ...toStatus(value) });
		      });
		      return () => {
		        active = false;
		      };
		    }, []);
		    if (props.view !== "page") return null;
		    const stagedKeys = (ref) => staged[ref] ?? "";
		    const disabled = busy || Object.values(state).every((entry) => !entry.writable);
		    const save = async () => {
		      const writes = REFS.map((ref) => [ref, toCredentialList(stagedKeys(ref))]).filter(([, value]) => value.length > 0);
		      if (writes.length === 0) {
		        setNotice({ text: t("notice.empty"), kind: "info" });
		        return;
		      }
		      setBusy(true);
		      setNotice({ text: "", kind: "info" });
		      try {
		        for (const [ref, value] of writes) await ctx.remote.credentials.set(ref, value);
		        setStaged({ [TAVILY_REF]: "", [FIRECRAWL_REF]: "" });
		        await read((value) => setState({ ...status, ...toStatus(value) }));
		        setNotice({ text: t("notice.saved"), kind: "info" });
		      } catch {
		        setNotice({ text: t("notice.failed"), kind: "error" });
		      } finally {
		        setBusy(false);
		      }
		    };
		    const clear = async (ref) => {
		      setBusy(true);
		      setNotice({ text: "", kind: "info" });
		      try {
		        await ctx.remote.credentials.unset(ref);
		        await read((value) => setState({ ...status, ...toStatus(value) }));
		        setNotice({ text: t("notice.cleared"), kind: "info" });
		      } catch {
		        setNotice({ text: t("notice.failed"), kind: "error" });
		      } finally {
		        setBusy(false);
		      }
		    };
		    const discard = () => {
		      setStaged({ [TAVILY_REF]: "", [FIRECRAWL_REF]: "" });
		      setNotice({ text: "", kind: "info" });
		    };
		    return h(
		      "div",
		      { className: "skafc-page" },
		      h("style", {}, PAGE_CSS),
		      h("p", { className: "skafc-intro" }, t("intro")),
		      field({
		        ref: TAVILY_REF,
		        label: t("field.tavily"),
		        hint: t("field.tavily.hint"),
		        state: state[TAVILY_REF] ?? { configured: false, writable: true },
		        value: stagedKeys(TAVILY_REF),
		        busy,
		        onChange: (text) => setStaged((current) => ({ ...current, [TAVILY_REF]: text })),
		        onClear: () => {
		          void clear(TAVILY_REF);
		        },
		        t
		      }),
		      field({
		        ref: FIRECRAWL_REF,
		        label: t("field.firecrawl"),
		        hint: t("field.firecrawl.hint"),
		        state: state[FIRECRAWL_REF] ?? { configured: false, writable: true },
		        value: stagedKeys(FIRECRAWL_REF),
		        busy,
		        onChange: (text) => setStaged((current) => ({ ...current, [FIRECRAWL_REF]: text })),
		        onClear: () => {
		          void clear(FIRECRAWL_REF);
		        },
		        t
		      }),
		      h(
		        "div",
		        { className: "skafc-actions" },
		        h("button", { type: "button", className: "skafc-btn skafc-btn--primary", disabled, onClick: () => {
		          void save();
		        } }, t("action.save")),
		        h("button", { type: "button", className: "skafc-btn", disabled: busy, onClick: discard }, t("action.discard")),
		        notice.text.length > 0 ? h("span", { className: notice.kind === "error" ? "skafc-notice skafc-notice--error" : "skafc-notice" }, notice.text) : null
		      )
		    );
		  };
		}
		function toStatus(value) {
		  const next = {};
		  for (const ref of REFS) {
		    next[ref] = {
		      configured: value[ref]?.configured ?? false,
		      writable: value[ref]?.writable ?? true
		    };
		  }
		  return next;
		}
		function field(options) {
		  const { label, hint, state, value, busy, onChange, onClear, t } = options;
		  const kind = !state.writable ? "readonly" : state.configured ? "ok" : "missing";
		  const text = !state.writable ? t("status.readonly") : state.configured ? t("status.configured") : t("status.missing");
		  return h(
		    "div",
		    { className: "skafc-field" },
		    h("span", { className: "skafc-label" }, label),
		    h("span", { className: `skafc-status skafc-status--${kind}` }, text),
		    h("textarea", {
		      className: "skafc-input",
		      value,
		      rows: 3,
		      spellCheck: false,
		      autoComplete: "off",
		      placeholder: t("field.placeholder"),
		      disabled: busy || !state.writable,
		      onChange: (event) => onChange(event.target?.value ?? "")
		    }),
		    h("span", { className: "skafc-hint" }, hint),
		    state.configured && state.writable ? h("button", { type: "button", className: "skafc-clear", disabled: busy, onClick: onClear }, t("action.clear")) : null
		  );
		}

		// src/client/index.ts
		var inject = ["slots", "locale", "remote", "remote.credentials"];
		var BUNDLE_CONFIG_SLOT = "plugins.bundle.config";
		var PACKAGE_NAME = "@skillre/dsh-plugin-tavily-firecrawl";
		var NS = "skillre-tavily-firecrawl";
		var en = {
		  intro: "Keys are stored in the credentials store, outside the profile configuration, and resolve per request. Supply several to rotate across accounts; the environment variable names work unchanged.",
		  "field.tavily": "Tavily API keys",
		  "field.tavily.hint": "Read from TAVILY_API_KEYS (or TAVILY_API_KEY) when nothing is stored here.",
		  "field.firecrawl": "Firecrawl API keys",
		  "field.firecrawl.hint": "Read from FIRECRAWL_API_KEYS (or FIRECRAWL_API_KEY) when nothing is stored here.",
		  "field.placeholder": "key-1, key-2, key-3",
		  "status.configured": "Key stored",
		  "status.missing": "No key stored",
		  "status.readonly": "Supplied by the environment; edit it there",
		  "action.save": "Save",
		  "action.discard": "Discard",
		  "action.clear": "Remove the stored key",
		  "notice.saved": "Saved. The next search or fetch uses it \u2014 no restart.",
		  "notice.cleared": "Stored key removed. The environment still answers if it defines one.",
		  "notice.failed": "Could not save the key. The Host refused the write.",
		  "notice.empty": "Nothing to save: type at least one key first."
		};
		var zh = {
		  intro: "\u5BC6\u94A5\u4FDD\u5B58\u5728\u51ED\u636E\u5B58\u50A8\u4E2D\uFF08\u4E0D\u5199\u8FDB profile \u914D\u7F6E\uFF09\uFF0C\u6BCF\u6B21\u8BF7\u6C42\u5B9E\u65F6\u8BFB\u53D6\u3002\u586B\u5199\u591A\u4E2A\u5373\u53EF\u8F6E\u8BE2\u591A\u4E2A\u8D26\u53F7\uFF1B\u73AF\u5883\u53D8\u91CF\u7684\u5199\u6CD5\u7EE7\u7EED\u6709\u6548\u3002",
		  "field.tavily": "Tavily API Key",
		  "field.tavily.hint": "\u6B64\u5904\u672A\u4FDD\u5B58\u65F6\uFF0C\u4ECE TAVILY_API_KEYS\uFF08\u6216 TAVILY_API_KEY\uFF09\u8BFB\u53D6\u3002",
		  "field.firecrawl": "Firecrawl API Key",
		  "field.firecrawl.hint": "\u6B64\u5904\u672A\u4FDD\u5B58\u65F6\uFF0C\u4ECE FIRECRAWL_API_KEYS\uFF08\u6216 FIRECRAWL_API_KEY\uFF09\u8BFB\u53D6\u3002",
		  "field.placeholder": "key-1, key-2, key-3",
		  "status.configured": "\u5DF2\u4FDD\u5B58\u5BC6\u94A5",
		  "status.missing": "\u5C1A\u672A\u4FDD\u5B58\u5BC6\u94A5",
		  "status.readonly": "\u7531\u73AF\u5883\u53D8\u91CF\u63D0\u4F9B\uFF0C\u8BF7\u5728\u73AF\u5883\u4E2D\u4FEE\u6539",
		  "action.save": "\u4FDD\u5B58",
		  "action.discard": "\u653E\u5F03",
		  "action.clear": "\u6E05\u9664\u5DF2\u4FDD\u5B58\u7684\u5BC6\u94A5",
		  "notice.saved": "\u5DF2\u4FDD\u5B58\u3002\u4E0B\u6B21\u641C\u7D22/\u6293\u53D6\u5373\u751F\u6548\uFF0C\u65E0\u9700\u91CD\u542F\u3002",
		  "notice.cleared": "\u5DF2\u6E05\u9664\u4FDD\u5B58\u7684\u5BC6\u94A5\uFF1B\u82E5\u73AF\u5883\u53D8\u91CF\u91CC\u6709\uFF0C\u4ECD\u4F1A\u4ECE\u73AF\u5883\u8BFB\u53D6\u3002",
		  "notice.failed": "\u4FDD\u5B58\u5931\u8D25\uFF1AHost \u62D2\u7EDD\u4E86\u8FD9\u6B21\u5199\u5165\u3002",
		  "notice.empty": "\u6CA1\u6709\u53EF\u4FDD\u5B58\u7684\u5185\u5BB9\uFF1A\u8BF7\u5148\u586B\u5199\u81F3\u5C11\u4E00\u4E2A Key\u3002"
		};
		function apply(ctx) {
		  const t = ctx.locale.bind(NS);
		  ctx.effect(() => ctx.locale.register(NS, "en", en), "skillre-tavily-firecrawl: en dictionary");
		  ctx.effect(() => ctx.locale.register(NS, "zh", zh), "skillre-tavily-firecrawl: zh dictionary");
		  const page = createCredentialPage({ ctx, translate: t });
		  ctx.effect(
		    () => ctx.slots.inject(BUNDLE_CONFIG_SLOT, () => ctx.slots.register({ name: BUNDLE_CONFIG_SLOT, key: PACKAGE_NAME }, page)),
		    "skillre-tavily-firecrawl: configuration page"
		  );
		}

		return module.exports;
	}
});
