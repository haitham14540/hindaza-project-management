"use client";

import { useEffect } from "react";

function applyAutomaticTextDirection(target: EventTarget | null) {
  if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return;
  if (target instanceof HTMLInputElement && !["text", "search", "email", "url", "tel"].includes(target.type)) return;
  const firstStrongCharacter = target.value.match(/[A-Za-z\u0600-\u06FF]/)?.[0] || "";
  const direction = /[\u0600-\u06FF]/.test(firstStrongCharacter) ? "rtl" : "ltr";
  target.dir = direction;
  target.style.direction = direction;
  target.style.textAlign = direction === "rtl" ? "right" : "left";
}

export default function AutomaticTextDirection() {
  useEffect(() => {
    const syncDirection = (event: Event) => applyAutomaticTextDirection(event.target);
    document.addEventListener("input", syncDirection, true);
    document.addEventListener("focusin", syncDirection, true);
    document.querySelectorAll("input, textarea").forEach((field) => applyAutomaticTextDirection(field));
    return () => {
      document.removeEventListener("input", syncDirection, true);
      document.removeEventListener("focusin", syncDirection, true);
    };
  }, []);
  return null;
}
