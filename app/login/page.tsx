/* eslint-disable @next/next/no-img-element */
"use client";

import { FormEvent, useEffect, useState } from "react";

const disciplines = ["Architecture", "ID", "Structure", "Mechanical", "Electrical", "Infrastructure"];

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
      .catch(() => setError("تعذر الاتصال بالنظام."))
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
      if (!response.ok) throw new Error(data.error || "تعذر إكمال العملية.");
      window.location.replace("/");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "تعذر إكمال العملية.");
      setSaving(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-brand">
        <img src="/hindaza-logo.png" alt="HINDAZA Engineering BIM" />
        <div><span>PROJECT MANAGEMENT</span><h1>إدارة المشاريع والمهام<br />بصورة أوضح.</h1><p>منصة هندازة لمتابعة الفريق، المشاريع، الأداء والتقارير من مكان واحد.</p></div>
      </section>
      <section className="login-panel">
        <form className="login-card" onSubmit={submit}>
          <div className="login-card-head"><p>HINDAZA · SECURE ACCESS</p><h2>{setup ? "إعداد حساب المدير" : "تسجيل الدخول"}</h2><span>{setup ? "أنشئ الحساب الرئيسي مرة واحدة عند تشغيل النظام." : "أدخل بيانات حسابك للوصول إلى النظام."}</span></div>
          {checking ? <div className="login-loading"><i /> جاري التحقق...</div> : <>
            {setup && <label><span>رمز إعداد النظام · Setup Key</span><input required type="password" value={form.setupKey} onChange={(event) => setForm({ ...form, setupKey: event.target.value })} autoComplete="off" /></label>}
            {setup && <label><span>الاسم · Name</span><input required value={form.displayName} onChange={(event) => setForm({ ...form, displayName: event.target.value })} autoComplete="name" /></label>}
            <label><span>البريد الإلكتروني · Email</span><input required type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} autoComplete="email" /></label>
            {setup && <label><span>التخصص · Discipline</span><select required value={form.discipline} onChange={(event) => setForm({ ...form, discipline: event.target.value })}><option value="" disabled>اختر التخصص</option>{disciplines.map((item) => <option key={item}>{item}</option>)}</select></label>}
            <label><span>كلمة المرور · Password</span><input required minLength={setup ? 10 : undefined} type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} autoComplete={setup ? "new-password" : "current-password"} /></label>
            {error && <div className="login-error">{error}</div>}
            <button className="login-submit" disabled={saving}>{saving ? "جاري الحفظ..." : setup ? "إنشاء حساب المدير" : "دخول إلى النظام"}</button>
          </>}
          <small>HINDAZA Engineering BIM · Protected workspace</small>
        </form>
      </section>
    </main>
  );
}
