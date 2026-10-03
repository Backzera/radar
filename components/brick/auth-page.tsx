"use client";
import { useEffect, useState } from "react";
import { ArrowRight, BarChart3, Camera, Eye, EyeOff, Target, Wallet } from "lucide-react";
import { formatCents } from "@/core/brick";
import { api, errorText, fieldErrors } from "./api";
import { BRAND, PLANS, type PlanId } from "./brand";
import { Logo } from "./logo";
import { Field, Spinner } from "./ui";

function safeNext(value: string | null) {
  return value && value.startsWith("/") && !value.startsWith("//") ? value : "/app";
}

export function AuthPage({ mode }: { mode: "login" | "signup" }) {
  const signup = mode === "signup";
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [plan, setPlan] = useState<PlanId>("pro");
  const [terms, setTerms] = useState(false);
  const [error, setError] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [next, setNext] = useState("/app");
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const chosen = params.get("plano");
    queueMicrotask(() => {
      setNext(safeNext(params.get("next")));
      if (chosen === "essencial" || chosen === "pro") setPlan(chosen);
    });
    // Already signed in: skip the form.
    fetch("/api/v1/auth/me", { credentials: "same-origin" }).then((r) => {
      if (r.ok) location.replace(safeNext(params.get("next")));
    });
  }, []);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setFields({});
    if (signup && !terms) {
      setFields({ acceptTerms: "Aceite os termos para continuar." });
      return;
    }
    setBusy(true);
    try {
      await api(signup ? "auth/signup" : "auth/login", {
        body: signup ? { name, email, password, acceptTerms: true, plan } : { email, password },
      });
      location.href = signup ? "/app?boasvindas=1" : next;
    } catch (err) {
      setFields(fieldErrors(err));
      setError(errorText(err));
      setBusy(false);
    }
  };
  return (
    <div className="auth">
      <aside className="auth-aside">
        <Logo />
        <div className="fade-up">
          <h2>
            {signup ? (
              <>
                Comece hoje a ver o <span className="gradient-text">lucro real</span> do seu brick.
              </>
            ) : (
              <>
                Bem-vindo de volta. <span className="gradient-text">Seu estoque te espera.</span>
              </>
            )}
          </h2>
          <ul>
            {[
              [Camera, "Estoque com fotos tiradas pelo celular"],
              [Wallet, "Custos, taxas e lucro líquido automáticos"],
              [BarChart3, "Painel com margem, ROI e giro"],
              [Target, "Metas mensais para crescer com foco"],
            ].map(([Icon, text], i) => {
              const I = Icon as typeof Camera;
              return (
                <li key={String(text)} className="fade-up" style={{ "--i": i + 1 } as React.CSSProperties}>
                  <span>
                    <I size={17} />
                  </span>
                  {String(text)}
                </li>
              );
            })}
          </ul>
        </div>
        <span className="muted" style={{ fontSize: 13 }}>
          {BRAND.name} · {BRAND.tagline}
        </span>
      </aside>
      <main className="auth-main">
        <div className="card auth-card glass fade-up">
          <div style={{ display: "flex", justifyContent: "center" }} className="mobile-logo">
            <Logo compact />
          </div>
          <h1>{signup ? "Criar sua conta" : "Entrar"}</h1>
          <p>{signup ? "Leva menos de um minuto." : "Acesse seu painel de brick."}</p>
          {error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}
          <form onSubmit={submit} noValidate>
            {signup && (
              <Field label="Seu nome" error={fields.name}>
                {(id) => (
                  <input
                    id={id}
                    className="input"
                    autoComplete="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    aria-invalid={!!fields.name || undefined}
                    autoFocus
                  />
                )}
              </Field>
            )}
            <Field label="E-mail" error={fields.email}>
              {(id) => (
                <input
                  id={id}
                  className="input"
                  type="email"
                  autoComplete="email"
                  inputMode="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  aria-invalid={!!fields.email || undefined}
                  autoFocus={!signup}
                />
              )}
            </Field>
            <Field label="Senha" hint={signup ? "Pelo menos 8 caracteres." : undefined} error={fields.password}>
              {(id) => (
                <div className="password">
                  <input
                    id={id}
                    className="input"
                    type={show ? "text" : "password"}
                    autoComplete={signup ? "new-password" : "current-password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    aria-invalid={!!fields.password || undefined}
                  />
                  <button
                    type="button"
                    className="btn btn-ghost btn-icon"
                    onClick={() => setShow((v) => !v)}
                    aria-label={show ? "Ocultar senha" : "Mostrar senha"}
                  >
                    {show ? <EyeOff size={17} /> : <Eye size={17} />}
                  </button>
                </div>
              )}
            </Field>
            {signup && (
              <div className="field">
                <span className="label">Plano</span>
                <div className="plan-pick" role="group" aria-label="Plano">
                  {PLANS.map((p) => (
                    <button key={p.id} type="button" aria-pressed={plan === p.id} onClick={() => setPlan(p.id)}>
                      <strong>{p.name}</strong>
                      <small>{formatCents(p.priceCents)}/mês</small>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {signup && (
              <label className="check">
                <input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} />
                <span>
                  Li e aceito os termos de uso e a política de privacidade.
                  {fields.acceptTerms && (
                    <span className="error" style={{ display: "block", color: "var(--bad)" }}>
                      {fields.acceptTerms}
                    </span>
                  )}
                </span>
              </label>
            )}
            <button className="btn btn-primary btn-lg" type="submit" disabled={busy} style={{ marginTop: 4 }}>
              {busy ? <Spinner /> : null}
              {signup ? "Criar conta" : "Entrar"} {!busy && <ArrowRight size={18} />}
            </button>
          </form>
          {!signup && (
            <p className="muted" style={{ fontSize: 13, textAlign: "center" }}>
              Esqueceu a senha? A recuperação por e-mail chega em breve; fale com o suporte.
            </p>
          )}
          <p className="auth-switch">
            {signup ? (
              <>
                Já tem conta? <a href="/entrar">Entrar</a>
              </>
            ) : (
              <>
                Ainda não tem conta? <a href="/cadastro">Criar conta</a>
              </>
            )}
          </p>
        </div>
      </main>
    </div>
  );
}
