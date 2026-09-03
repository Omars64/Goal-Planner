"use client";

import { useState, type FormEvent } from "react";
import { ArrowLeft, Eye, EyeOff, LoaderCircle, LockKeyhole, LogIn, MailCheck, UserPlus, UserX } from "lucide-react";
import Image from "next/image";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";

import { api } from "./api";
import { Field } from "./shared";
import type { AuthenticatedUser } from "./types";

const APP_ICON = "/goal-planner-icon.png";

function PasswordInput({
  value,
  onChange,
  placeholder,
  autoComplete,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  autoComplete: string;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="password-input">
      <Input
        required
        minLength={8}
        type={visible ? "text" : "password"}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
      />
      <button type="button" aria-label={visible ? "Hide password" : "Show password"} onClick={() => setVisible(!visible)}>
        {visible ? <EyeOff /> : <Eye />}
      </button>
    </div>
  );
}

export function AuthScreen({ onAuthenticated, sessionNotice }: { onAuthenticated: (user: AuthenticatedUser, message: string) => void; sessionNotice?: string | null }) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [verificationEmail, setVerificationEmail] = useState<string | null>(null);
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [accessMessage, setAccessMessage] = useState<string | null>(null);

  const submitCredentials = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setAccessMessage(null);
    try {
      if (mode === "login") {
        const result = await api.login(email, password);
        onAuthenticated(result.user, result.message);
      } else {
        const result = await api.signup(username, email, password);
        setVerificationEmail(result.email);
        setCode("");
        toast.success("Verification code sent", { description: result.message });
      }
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Please try again";
      const pendingVerification = mode === "login" && /verify your email/i.test(message);
      if (pendingVerification) {
        setVerificationEmail(email.trim().toLowerCase());
        setCode("");
        toast.info("Email verification required", { description: "Enter the six-digit code sent to your inbox." });
        return;
      }
      const deactivated = /deactivated|inactive/i.test(message);
      if (deactivated) setAccessMessage(message);
      toast.error(deactivated ? "Account access is disabled" : mode === "login" ? "Sign in failed" : "Could not create account", {
        description: message,
      });
    } finally {
      setSubmitting(false);
    }
  };

  const verify = async (event: FormEvent) => {
    event.preventDefault();
    if (!verificationEmail || code.length !== 6) return;
    setSubmitting(true);
    try {
      const result = await api.verifyEmail(verificationEmail, code);
      onAuthenticated(result.user, result.message);
    } catch (caught) {
      toast.error("Verification failed", {
        description: caught instanceof Error ? caught.message : "Check the code and try again",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const resend = async () => {
    if (!verificationEmail) return;
    try {
      const result = await api.resendCode(verificationEmail);
      toast.success("New code sent", { description: result.message });
    } catch (caught) {
      toast.error("Could not resend code", {
        description: caught instanceof Error ? caught.message : "Please try again shortly",
      });
    }
  };

  return (
    <div className="auth-shell">
      <div className="auth-brand">
        <Image src={APP_ICON} alt="Goal Planner" width={68} height={68} priority unoptimized />
        <div><strong>GOAL</strong><span>PLANNER</span></div>
      </div>
      <section className="auth-panel">
        {sessionNotice && mode === "login" && !verificationEmail ? <div className="auth-access-message" role="status"><LockKeyhole /><div><strong>Sign in again</strong><span>{sessionNotice}</span></div></div> : null}
        {verificationEmail ? (
          <>
            <div className="auth-heading"><span><MailCheck /></span><p>Secure your account</p><h1>Check your inbox</h1><small>Enter the six-digit code sent to {verificationEmail}.</small></div>
            <form className="auth-form verification-form" onSubmit={verify}>
              <InputOTP maxLength={6} value={code} onChange={setCode} inputMode="numeric" pattern="[0-9]*">
                <InputOTPGroup>{Array.from({ length: 6 }, (_, index) => <InputOTPSlot key={index} index={index} />)}</InputOTPGroup>
              </InputOTP>
              <Button className="neon-button auth-submit" disabled={submitting || code.length !== 6}>
                {submitting ? <LoaderCircle className="spin" /> : <MailCheck />}Verify and open planner
              </Button>
              <div className="verification-actions">
                <button type="button" onClick={() => void resend()}>Send a new code</button>
                <button type="button" onClick={() => { setVerificationEmail(null); setCode(""); }}><ArrowLeft />Back</button>
              </div>
            </form>
          </>
        ) : (
          <>
            <div className="auth-heading"><span><LockKeyhole /></span><p>Your planning workspace</p><h1>{mode === "login" ? "Welcome back" : "Create your account"}</h1><small>{mode === "login" ? "Sign in to continue where you left off." : "Verify your email, then start planning with your own private workspace."}</small></div>
            <div className="auth-tabs" role="tablist" aria-label="Authentication mode">
              <button type="button" role="tab" aria-selected={mode === "login"} className={mode === "login" ? "active" : ""} onClick={() => { setMode("login"); setAccessMessage(null); }}><LogIn />Log in</button>
              <button type="button" role="tab" aria-selected={mode === "signup"} className={mode === "signup" ? "active" : ""} onClick={() => { setMode("signup"); setAccessMessage(null); }}><UserPlus />Sign up</button>
            </div>
            {accessMessage ? <div className="auth-access-message" role="alert" aria-live="polite"><UserX /><div><strong>Account unavailable</strong><span>{accessMessage}</span></div></div> : null}
            <form className="auth-form" onSubmit={submitCredentials}>
              {mode === "signup" ? <Field label="Username"><Input required minLength={2} maxLength={80} value={username} onChange={(event) => setUsername(event.target.value)} placeholder="How your name should appear" autoComplete="name" /></Field> : null}
              <Field label="Email address"><Input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" autoComplete="email" /></Field>
              <Field label="Password" hint={mode === "signup" ? "Use at least eight characters." : undefined}>
                <PasswordInput value={password} onChange={setPassword} placeholder="At least eight characters" autoComplete={mode === "login" ? "current-password" : "new-password"} />
              </Field>
              <Button className="neon-button auth-submit" disabled={submitting}>
                {submitting ? <LoaderCircle className="spin" /> : mode === "login" ? <LogIn /> : <UserPlus />}{submitting ? "Please wait..." : mode === "login" ? "Open my planner" : "Create account"}
              </Button>
            </form>
          </>
        )}
      </section>
      <p className="auth-footnote">Private planner data, protected by verified access.</p>
    </div>
  );
}
