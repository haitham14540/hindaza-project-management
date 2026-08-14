"use client";

import { ReactNode, useCallback, useEffect, useRef, useState } from "react";

type ConfirmOptions = {
  title: string;
  titleAr: string;
  message: ReactNode;
  messageAr: ReactNode;
  confirmLabel?: string;
  confirmLabelAr?: string;
};

type PendingConfirmation = ConfirmOptions & { resolve: (approved: boolean) => void };

export function useAppConfirm() {
  const [pending, setPending] = useState<PendingConfirmation | null>(null);
  const pendingRef = useRef<PendingConfirmation | null>(null);

  const confirm = useCallback((options: ConfirmOptions) => new Promise<boolean>((resolve) => {
    pendingRef.current?.resolve(false);
    const request = { ...options, resolve };
    pendingRef.current = request;
    setPending(request);
  }), []);

  const finish = useCallback((approved: boolean) => {
    const request = pendingRef.current;
    pendingRef.current = null;
    setPending(null);
    request?.resolve(approved);
  }, []);

  useEffect(() => {
    if (!pending) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") finish(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [pending, finish]);

  const confirmDialog = pending ? <div className="app-confirm-layer" role="dialog" aria-modal="true" aria-labelledby="app-confirm-title">
    <button type="button" className="app-confirm-backdrop" onClick={() => finish(false)} aria-label="Cancel" />
    <section className="app-confirm-dialog">
      <div className="app-confirm-icon" aria-hidden="true">!</div>
      <h2 id="app-confirm-title">{pending.title}</h2>
      <h3 dir="rtl">{pending.titleAr}</h3>
      <p>{pending.message}</p>
      <p dir="rtl">{pending.messageAr}</p>
      <div className="app-confirm-actions">
        <button type="button" className="app-confirm-cancel" autoFocus onClick={() => finish(false)}><strong>Cancel</strong></button>
        <button type="button" className="app-confirm-delete" onClick={() => finish(true)}><strong>{pending.confirmLabel || "Delete"}</strong></button>
      </div>
    </section>
  </div> : null;

  return { confirm, confirmDialog };
}
