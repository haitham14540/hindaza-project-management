"use client";

import { useEffect } from "react";

const symbolLabels: Record<string, string> = {
  "×": "Close",
  "✎": "Edit",
  "▦": "Cards view",
  "☷": "Table view",
  "⌃": "Account menu",
};

function englishTooltip(value: string) {
  return value
    .replace(/[\u0600-\u06ff]/g, "")
    .replace(/[·|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tooltipFor(button: HTMLButtonElement) {
  const sources = [
    button.getAttribute("aria-label") || "",
    button.dataset.tooltipAuto === "true" ? "" : button.getAttribute("title") || "",
    button.innerText || button.textContent || "",
  ];
  for (const source of sources) {
    const cleaned = englishTooltip(source);
    if (cleaned && cleaned !== "+" && cleaned !== "✓" && cleaned !== "!") return symbolLabels[cleaned] || cleaned;
  }
  const symbol = (button.innerText || button.textContent || "").trim();
  return symbolLabels[symbol] || (button.type === "submit" ? "Submit" : "Button action");
}

export default function ButtonTooltips() {
  useEffect(() => {
    const applyTooltips = () => {
      document.querySelectorAll<HTMLButtonElement>("button").forEach((button) => {
        button.title = tooltipFor(button);
        button.dataset.tooltipAuto = "true";
      });
    };
    applyTooltips();
    const observer = new MutationObserver(applyTooltips);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, []);

  return null;
}
