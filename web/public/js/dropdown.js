// Reusable custom dropdown, styled to match the app. Replaces native <select>
// so the menus look consistent in the browser, the desktop shell, and the
// dedicated Settings window. Keyboard accessible (listbox semantics: arrows,
// Home/End, Enter/Space, Escape).
import { escapeHtml } from "./ui.js";

const CARET =
  '<svg class="dd-caret" viewBox="0 0 12 8" width="12" height="8" aria-hidden="true">' +
  '<path d="M1 1.5 6 6.5 11 1.5" fill="none" stroke="currentColor" stroke-width="1.6" ' +
  'stroke-linecap="round" stroke-linejoin="round"/></svg>';

function normalize(options) {
  return (options || []).map((option) =>
    Array.isArray(option)
      ? { value: String(option[0]), label: String(option[1]) }
      : { value: String(option.value), label: String(option.label) },
  );
}

function optionsHtml(options, value) {
  return normalize(options)
    .map((option) => {
      const selected = option.value === String(value ?? "");
      return `<button type="button" class="dd-opt${
        selected ? " is-selected" : ""
      }" role="option" aria-selected="${selected}" data-value="${escapeHtml(option.value)}">${escapeHtml(
        option.label,
      )}</button>`;
    })
    .join("");
}

// Static markup used inside view templates. `value` picks the current option.
export function dropdownHtml(id, options, value, { className = "", placeholder = "", label } = {}) {
  const opts = normalize(options);
  const current = opts.find((o) => o.value === String(value ?? ""));
  return `<div class="dd${className ? ` ${className}` : ""}" data-dd="${escapeHtml(
    id,
  )}" data-placeholder="${escapeHtml(placeholder)}"${
    label ? ` aria-label="${escapeHtml(label)}"` : ""
  }>
    <button type="button" class="dd-btn" aria-haspopup="listbox" aria-expanded="false">
      <span class="dd-label${current ? "" : " dd-placeholder"}">${escapeHtml(
        current ? current.label : placeholder,
      )}</span>
      ${CARET}
    </button>
    <div class="dd-menu" role="listbox" hidden>${optionsHtml(opts, value)}</div>
  </div>`;
}

const registry = new Set();

function closeAll(except) {
  for (const dd of registry) {
    if (!dd.el.isConnected) {
      registry.delete(dd);
      continue;
    }
    if (dd !== except) dd.close();
  }
}

let delegated = false;
function ensureDelegated() {
  if (delegated || typeof document === "undefined") return;
  delegated = true;
  document.addEventListener("click", (event) => {
    if (!event.target.closest?.(".dd")) closeAll();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeAll();
  });
}

export class Dropdown {
  constructor(el, { onChange } = {}) {
    ensureDelegated();
    registry.add(this);
    this.el = el;
    this.onChange = typeof onChange === "function" ? onChange : null;
    this.btn = el.querySelector(".dd-btn");
    this.labelEl = el.querySelector(".dd-label");
    this.menu = el.querySelector(".dd-menu");
    this.byValue = new Map();
    this.readOptions();

    const initial = this.menu.querySelector(".dd-opt.is-selected");
    this.apply(initial ? initial.dataset.value : "");

    this.btn.addEventListener("click", (event) => {
      event.stopPropagation();
      this.toggle();
    });
    this.menu.addEventListener("click", (event) => {
      const option = event.target.closest(".dd-opt");
      if (!option) return;
      event.stopPropagation();
      this.commit(option.dataset.value);
    });
    this.btn.addEventListener("keydown", (event) => this.onButtonKey(event));
    this.menu.addEventListener("keydown", (event) => this.onMenuKey(event));
  }

  readOptions() {
    this.byValue.clear();
    this.menu.querySelectorAll(".dd-opt").forEach((option) => this.byValue.set(option.dataset.value, option));
  }

  get value() {
    return this.el.dataset.value ?? "";
  }

  get values() {
    return [...this.byValue.keys()];
  }

  setOptions(options, value) {
    this.menu.innerHTML = optionsHtml(options, value);
    this.readOptions();
    this.apply(value);
  }

  setValue(value, emit = false) {
    const next = String(value ?? "");
    if (next === this.value) return;
    this.apply(next);
    if (emit && this.onChange) this.onChange(next);
  }

  apply(value) {
    const next = String(value ?? "");
    this.el.dataset.value = next;
    let text = "";
    let found = false;
    for (const [optionValue, optionEl] of this.byValue) {
      const selected = optionValue === next;
      optionEl.classList.toggle("is-selected", selected);
      optionEl.setAttribute("aria-selected", String(selected));
      if (selected) {
        text = optionEl.textContent;
        found = true;
      }
    }
    this.labelEl.textContent = found ? text : this.el.dataset.placeholder || "";
    this.labelEl.classList.toggle("dd-placeholder", !found);
  }

  commit(value) {
    const changed = String(value ?? "") !== this.value;
    this.apply(value);
    this.close();
    this.btn.focus();
    if (changed && this.onChange) this.onChange(this.value);
  }

  toggle() {
    if (this.menu.hidden) this.open();
    else this.close();
  }

  open() {
    closeAll(this);
    this.menu.hidden = false;
    this.el.classList.add("open");
    this.btn.setAttribute("aria-expanded", "true");
    this.positionMenu();
    const selected = this.menu.querySelector(".dd-opt.is-selected") || this.menu.querySelector(".dd-opt");
    selected?.focus();
    selected?.scrollIntoView?.({ block: "nearest" });
  }

  // Flip the menu above the button when it would overflow the viewport bottom
  // (common in the Settings window, where dropdowns sit in low panels).
  positionMenu() {
    this.el.classList.remove("dd-up");
    if (typeof window === "undefined" || !window.getComputedStyle) return;
    const rect = this.menu.getBoundingClientRect();
    if (!rect.height) return;
    const btn = this.btn.getBoundingClientRect();
    const viewport = window.innerHeight || document.documentElement.clientHeight;
    const overflowsBelow = rect.bottom > viewport - 8;
    const roomAbove = btn.top > rect.height + 8;
    if (overflowsBelow && roomAbove) this.el.classList.add("dd-up");
  }

  close() {
    this.menu.hidden = true;
    this.el.classList.remove("open");
    this.btn.setAttribute("aria-expanded", "false");
  }

  onButtonKey(event) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      this.open();
    }
  }

  onMenuKey(event) {
    const options = [...this.menu.querySelectorAll(".dd-opt")];
    const current = options.indexOf(document.activeElement);
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        (options[current + 1] || options[0])?.focus();
        break;
      case "ArrowUp":
        event.preventDefault();
        (options[current - 1] || options[options.length - 1])?.focus();
        break;
      case "Home":
        event.preventDefault();
        options[0]?.focus();
        break;
      case "End":
        event.preventDefault();
        options[options.length - 1]?.focus();
        break;
      case "Tab":
        this.close();
        break;
      case "Escape":
        event.preventDefault();
        this.close();
        this.btn.focus();
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        if (document.activeElement?.classList.contains("dd-opt")) {
          this.commit(document.activeElement.dataset.value);
        }
        break;
      default:
        break;
    }
  }
}

// Wire every [data-dd] inside `root`. `handlers` maps a dropdown id to a
// change callback. Returns a map of id -> Dropdown instance.
export function initDropdowns(root, handlers = {}) {
  const dropdowns = {};
  root.querySelectorAll("[data-dd]").forEach((el) => {
    const id = el.dataset.dd;
    dropdowns[id] = new Dropdown(el, { onChange: handlers[id] });
  });
  return dropdowns;
}
