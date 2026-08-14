"use client";

import { InputHTMLAttributes, useState } from "react";

export default function PasswordInput(props: Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  const [visible, setVisible] = useState(false);
  return <span className="password-input-wrap">
    <input {...props} type={visible ? "text" : "password"} />
    <button type="button" className={`password-visibility${visible ? " visible" : ""}`} onClick={() => setVisible((current) => !current)} aria-label={visible ? "Hide password" : "Show password"} title={visible ? "Hide password" : "Show password"}>👁</button>
  </span>;
}
