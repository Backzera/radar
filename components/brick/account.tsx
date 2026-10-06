"use client";
import { useEffect, useState } from "react";
import {
  BadgeCheck,
  Download,
  KeyRound,
  LogOut,
  ShieldCheck,
  Target,
  Users,
} from "lucide-react";
import { api, errorText, useApi } from "./api";
import { PLANS } from "./brand";
import { Field, MoneyInput, Spinner, useToast } from "./ui";
import type { Me, Preferences } from "./types";
import { formatCents } from "@/core/brick";
import { withBase } from "./base";

export const initials = (name: string | null, email: string | null) =>
  (name || email || "?")
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");

function PasswordCard() {
  const toast = useToast();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [busy, setBusy] = useState(false);
  const mismatch = repeat.length > 0 && next !== repeat;
  const submit = async () => {
    setBusy(true);
    try {
      await api("auth/password", {
        body: { currentPassword: current, newPassword: next },
      });
      setCurrent("");
      setNext("");
      setRepeat("");
      toast({
        tone: "success",
        title: "Senha alterada",
        description: "Os outros aparelhos conectados foram desconectados.",
      });
    } catch (e) {
      toast({
        tone: "error",
        title: "Não foi possível trocar a senha",
        description: errorText(e),
      });
    } finally {
      setBusy(false);
    }
  };
  return (
    <section
      className="card span-12 fade-up"
      style={{ "--i": 3 } as React.CSSProperties}
    >
      <div className="card-head">
        <div>
          <h3>Trocar senha</h3>
          <p>Recebeu uma senha temporária? Troque por uma só sua.</p>
        </div>
        <KeyRound size={18} className="muted" />
      </div>
      <div className="form-grid" style={{ maxWidth: 640 }}>
        <Field label="Senha atual" className="full">
          {(id) => (
            <input
              id={id}
              className="input"
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
            />
          )}
        </Field>
        <Field label="Nova senha" hint="Pelo menos 8 caracteres.">
          {(id) => (
            <input
              id={id}
              className="input"
              type="password"
              autoComplete="new-password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
            />
          )}
        </Field>
        <Field
          label="Repita a nova senha"
          error={mismatch ? "As senhas não são iguais." : undefined}
        >
          {(id) => (
            <input
              id={id}
              className="input"
              type="password"
              autoComplete="new-password"
              value={repeat}
              onChange={(e) => setRepeat(e.target.value)}
            />
          )}
        </Field>
      </div>
      <button
        className="btn"
        style={{ marginTop: 18 }}
        onClick={submit}
        disabled={busy || !current || next.length < 8 || next !== repeat}
      >
        {busy ? <Spinner /> : <KeyRound size={15} />} Trocar senha
      </button>
    </section>
  );
}

export function Account({
  me,
  onLogout,
  onSaved,
  onManageUsers,
  onOpenAudit,
}: {
  me: Me;
  onLogout: () => void;
  onSaved: () => void;
  onManageUsers?: () => void;
  onOpenAudit?: () => void;
}) {
  const toast = useToast();
  const prefs = useApi<Preferences>("brick/preferences");
  const [goal, setGoal] = useState<number | null>(null);
  const [stale, setStale] = useState(30);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (prefs.data)
      queueMicrotask(() => {
        setGoal(prefs.data!.monthlyGoalCents);
        setStale(prefs.data!.staleAfterDays);
      });
  }, [prefs.data]);
  const plan =
    PLANS.find((p) => p.id === (me.plan ?? prefs.data?.selectedPlan)) ??
    PLANS[1];
  const save = async () => {
    setBusy(true);
    try {
      await api("brick/preferences", {
        body: { monthlyGoalCents: goal, staleAfterDays: stale },
      });
      toast({
        tone: "success",
        title: "Preferências salvas",
        description: goal ? `Meta de ${formatCents(goal)} por mês.` : undefined,
      });
      onSaved();
    } catch (e) {
      toast({
        tone: "error",
        title: "Não foi possível salvar",
        description: errorText(e),
      });
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div className="view-head fade-up">
        <div>
          <h1>Conta</h1>
          <p>Seus dados, seu plano e como o painel trabalha para você.</p>
        </div>
      </div>
      <div className="dash">
        <section className="card span-6 fade-up">
          <div
            className="user-chip"
            style={{ border: 0, background: "none", padding: 0 }}
          >
            <span
              className="avatar"
              style={{ width: 52, height: 52, fontSize: 18, borderRadius: 16 }}
            >
              {initials(me.user.name, me.user.email)}
            </span>
            <div>
              <strong style={{ fontSize: 18 }}>
                {me.user.name ?? "Sua conta"}
              </strong>
              <small>{me.user.email}</small>
            </div>
          </div>
          <div className="view-actions" style={{ marginTop: 20 }}>
            <a className="btn btn-sm" href={withBase("/api/v1/inventory/export.csv")}>
              <Download size={15} /> Exportar planilha
            </a>
            {onManageUsers && (
              <button className="btn btn-sm" onClick={onManageUsers}>
                <Users size={15} /> Gerenciar usuários
              </button>
            )}
            {onOpenAudit && (
              <button className="btn btn-sm" onClick={onOpenAudit}>
                <ShieldCheck size={15} /> Auditoria
              </button>
            )}
            <button className="btn btn-ghost btn-sm" onClick={onLogout}>
              <LogOut size={15} /> Sair
            </button>
          </div>
        </section>
        <section
          className="card span-6 fade-up gradient-border"
          style={{ "--i": 1 } as React.CSSProperties}
        >
          <div className="card-head">
            <div>
              <h3>
                Plano {plan.name}{" "}
                <span className="badge soon" style={{ marginLeft: 6 }}>
                  Lançamento
                </span>
              </h3>
              <p>{plan.pitch}</p>
            </div>
            <BadgeCheck size={20} style={{ color: "var(--brand)" }} />
          </div>
          <p className="muted" style={{ fontSize: 13.5 }}>
            A cobrança online ainda não foi ativada. Enquanto isso, seu acesso a
            todos os recursos está liberado.
          </p>
        </section>
        <section
          className="card span-12 fade-up"
          style={{ "--i": 2 } as React.CSSProperties}
        >
          <div className="card-head">
            <div>
              <h3>Metas e alertas</h3>
              <p>
                Usados no painel para mostrar seu progresso e os produtos
                parados.
              </p>
            </div>
            <Target size={18} className="muted" />
          </div>
          <div className="form-grid" style={{ maxWidth: 640 }}>
            <Field
              label="Meta de lucro por mês"
              hint="Deixe vazio para não usar meta."
            >
              {(id) => (
                <MoneyInput
                  id={id}
                  value={goal}
                  onChange={setGoal}
                  placeholder="Ex.: 3.000,00"
                />
              )}
            </Field>
            <Field label="Considerar parado depois de">
              {(id) => (
                <select
                  id={id}
                  className="select"
                  value={stale}
                  onChange={(e) => setStale(Number(e.target.value))}
                >
                  {[15, 21, 30, 45, 60, 90].map((d) => (
                    <option key={d} value={d}>
                      {d} dias em estoque
                    </option>
                  ))}
                </select>
              )}
            </Field>
          </div>
          <button
            className="btn btn-primary"
            style={{ marginTop: 18 }}
            onClick={save}
            disabled={busy || !prefs.data}
          >
            {busy ? <Spinner /> : null} Salvar preferências
          </button>
        </section>
        <PasswordCard />
      </div>
    </>
  );
}
