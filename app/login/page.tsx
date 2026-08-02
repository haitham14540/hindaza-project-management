/* eslint-disable @next/next/no-img-element */
"use client";

import { FormEvent, useEffect, useState } from "react";

const disciplines = ["Manager", "Architecture", "ID", "Structure", "Mechanical", "Electrical", "Infrastructure"];

export default function LoginPage() {
  const [checking, setChecking] = useState(true);
  const [setup, setSetup] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ setupKey: "", displayName: "", email: "", password: "", discipline: "" });

  useEffect(() => {
    fetch("/api/auth/status", { cache: "no-store" })
      .then((response) => response.json())
      .then((data) => {
        if (data.authenticated) window.location.replace("/");
        else setSetup(Boolean(data.setupRequired));
      })
      .catch(() => setError("Unable to connect to the system. Please try again."))
      .finally(() => setChecking(false));
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const response = await fetch(setup ? "/api/auth/setup" : "/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to complete the request.");
      window.location.replace("/");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to complete the request.");
      setSaving(false);
    }
  }

  return (
    <main className="login-page" dir="ltr">
      <div className="login-accent login-accent-one" />
      <div className="login-accent login-accent-two" />
      <section className="login-shell">
        <header className="login-logo-block">
          <img src="/hindaza-logo.png" alt="HINDAZA Engineering BIM" />
          <span>PROJECT MANAGEMENT</span>
        </header>
        <form className="login-card" onSubmit={submit}>
          <div className="login-card-head">
            <p>{setup ? "FIRST-TIME SETUP" : "SECURE WORKSPACE"}</p>
            <h1>{setup ? "Set up your workspace" : "Welcome back"}</h1>
            <span>{setup ? "Create the primary manager account to start using the system." : "Sign in to manage your projects, tasks, and team."}</span>
          </div>
          {checking ? <div className="login-loading"><i /> Checking access…</div> : <>
            {setup && <label><span>Setup key</span><input required type="password" value={form.setupKey} onChange={(event) => setForm({ ...form, setupKey: event.target.value })} autoComplete="off" placeholder="Enter the Cloudflare setup key" /></label>}
            {setup && <label><span>Full name</span><input required value={form.displayName} onChange={(event) => setForm({ ...form, displayName: event.target.value })} autoComplete="name" placeholder="Your full name" /></label>}
            <label><span>Work email</span><input required type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} autoComplete="email" placeholder="name@eng-bim.com" /></label>
            {setup && <label><span>Discipline</span><select required value={form.discipline} onChange={(event) => setForm({ ...form, discipline: event.target.value })}><option value="" disabled>Select discipline</option>{disciplines.map((item) => <option key={item}>{item}</option>)}</select></label>}
            <label><span>Password</span><input required minLength={setup ? 10 : undefined} type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} autoComplete={setup ? "new-password" : "current-password"} placeholder={setup ? "At least 10 characters" : "Enter your password"} /></label>
            {error && <div className="login-error" role="alert">{error}</div>}
            <button className="login-submit" disabled={saving}>{saving ? "Please wait…" : setup ? "Create manager account" : "Sign in"}<span>→</span></button>
          </>}
        </form>
        <footer className="login-footer"><span className="security-dot" />Secure team workspace <b>·</b> HINDAZA Engineering BIM</footer>
      </section>
    </main>
  );
}
