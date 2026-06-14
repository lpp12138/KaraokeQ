/**
 * i18n — lightweight translation module
 * Supports: en, zh-CN, zh-TW, ja, ko, es, fr, de
 */
const I18n = (() => {
  let _strings = {};
  let _lang = "en";

  const LANG_NAMES = {
    "en":    "English",
    "zh-CN": "简体中文",
    "zh-TW": "繁體中文",
    "ja":    "日本語",
    "ko":    "한국어",
    "es":    "Español",
    "fr":    "Français",
    "de":    "Deutsch"
  };

  function detectLanguage() {
    const saved = localStorage.getItem("kq_lang");
    if (saved && LANG_NAMES[saved]) return saved;
    const browser = navigator.language || navigator.userLanguage || "en";
    if (browser.startsWith("zh-TW") || browser.startsWith("zh-HK")) return "zh-TW";
    if (browser.startsWith("zh")) return "zh-CN";
    const baseLang = browser.split("-")[0];
    return LANG_NAMES[baseLang] ? baseLang : "en";
  }

  // Load locale JSON from /locales/
  async function load(lang) {
    try {
      const base = getBasePath();
      const res = await fetch(`${base}locales/${lang}.json`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      _strings = await res.json();
      _lang = lang;
      localStorage.setItem("kq_lang", lang);
      applyToDOM();
      document.documentElement.lang = lang;
      return true;
    } catch (e) {
      console.warn(`[i18n] Failed to load "${lang}", falling back to "en"`, e);
      if (lang !== "en") return load("en");
      return false;
    }
  }

  // Resolve a dot-separated key: "remote.addSong"
  function t(key, vars = {}) {
    const parts = key.split(".");
    let val = _strings;
    for (const p of parts) {
      if (val == null) break;
      val = val[p];
    }
    if (typeof val !== "string") return key;
    return val.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? `{${k}}`));
  }

  // Apply translations to all [data-i18n] elements in the DOM
  function applyToDOM() {
    document.querySelectorAll("[data-i18n]").forEach(el => {
      const key = el.getAttribute("data-i18n");
      const translation = t(key);
      if (translation !== key) el.textContent = translation;
    });
    document.querySelectorAll("[data-i18n-placeholder]").forEach(el => {
      const key = el.getAttribute("data-i18n-placeholder");
      const translation = t(key);
      if (translation !== key) el.placeholder = translation;
    });
    document.querySelectorAll("[data-i18n-title]").forEach(el => {
      const key = el.getAttribute("data-i18n-title");
      const translation = t(key);
      if (translation !== key) el.title = translation;
    });
  }

  function currentLang() { return _lang; }
  function availableLanguages() { return LANG_NAMES; }

  // Compute base path so locales can be found from any subdirectory
  function getBasePath() {
    const scripts = document.querySelectorAll("script[src]");
    for (const s of scripts) {
      const m = s.src.match(/(.+\/)js\/i18n\.js/);
      if (m) return m[1];
    }
    return "./";
  }

  async function init() {
    const lang = detectLanguage();
    // Override with APP_SETTINGS default if browser lang is not supported
    const supported = Object.keys(LANG_NAMES);
    const langToLoad = supported.includes(lang) ? lang : (APP_SETTINGS?.defaultLanguage || "en");
    await load(langToLoad);
  }

  return { init, load, t, applyToDOM, currentLang, availableLanguages };
})();
