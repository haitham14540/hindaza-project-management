"use client";

import { useEffect } from "react";

const overlaySelector = ".drawer-layer, .attachment-preview-layer, .app-confirm-layer";
const scrollTargetSelector = ".attachment-preview-content, .task-form, .dependency-warning-dialog, .app-confirm-dialog";

function activeOverlay() {
  const overlays = Array.from(document.querySelectorAll<HTMLElement>(overlaySelector));
  return overlays.at(-1) || null;
}

function activeScrollTarget(overlay: HTMLElement) {
  return overlay.querySelector<HTMLElement>(scrollTargetSelector);
}

export default function OverlayScrollLock() {
  useEffect(() => {
    const updateLock = () => {
      const locked = Boolean(activeOverlay());
      document.documentElement.classList.toggle("overlay-scroll-locked", locked);
      document.body.classList.toggle("overlay-scroll-locked", locked);
    };

    const redirectWheel = (event: WheelEvent) => {
      const overlay = activeOverlay();
      if (!overlay) return;
      const scrollTarget = activeScrollTarget(overlay);
      if (!scrollTarget) {
        event.preventDefault();
        return;
      }

      const pointedElement = event.target instanceof Element ? event.target : null;
      if (pointedElement && scrollTarget.contains(pointedElement)) return;

      event.preventDefault();
      event.stopPropagation();
      scrollTarget.scrollBy({ left: event.deltaX, top: event.deltaY, behavior: "auto" });
    };

    updateLock();
    const observer = new MutationObserver(updateLock);
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener("wheel", redirectWheel, { capture: true, passive: false });

    return () => {
      observer.disconnect();
      document.removeEventListener("wheel", redirectWheel, true);
      document.documentElement.classList.remove("overlay-scroll-locked");
      document.body.classList.remove("overlay-scroll-locked");
    };
  }, []);

  return null;
}
