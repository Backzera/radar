"use client";
import { useEffect, useState } from "react";
import {
  Ban,
  Copy,
  KeyRound,
  Search,
  Trash2,
  UserCheck,
  UserPlus,
  Users,
} from "lucide-react";
import { api, errorText, fieldErrors, useApi } from "./api";
import { initials } from "./account";
import { BRAND, PLANS } from "./brand";
import { EmptyState, Field, Modal, Spinner, useToast } from "./ui";
import type { Me } from "./types";

interface AdminUser {
  id: string;
  name: string;
  email: string;
  createdAt: string;
  lastLoginAt: string | null;
  status: "active" | "blocked";
  plan: string | null;
  items: number;
  sold: number;
}
interface UserList {
  users: AdminUser[];
  totals: {
    total: number;
    active: number;
    blocked: number;
    newThisMonth: number;
  };
  signupOpen: boolean;
}
type Credentials = { name: string; email: string; password: string };
type Pending = {
  kind: "block" | "unblock" | "reset" | "delete";
  user: AdminUser;
} | null;

const dateText = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString("pt-BR", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "Nunca";

export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className="switch"
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  );
}

function CopyButton({
  text,
  label = "Copiar",
}: {
  text: string;
  label?: string;
}) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-sm"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1600);
      }}
    >
      <Copy size={14} /> {done ? "Copiado!" : label}
    </button>
  );
}

function CredentialsModal({
  credentials,
  onClose,
}: {
  credentials: Credentials | null;
  onClose: () => void;
}) {
  if (!credentials) return null;
  const site = `${location.origin}/entrar`;
  const message = `Olá, ${credentials.name.split(" ")[0]}! Seu acesso ao ${BRAND.name} está pronto.\n\nEntre em: ${site}\nE-mail: ${credentials.email}\nSenha: ${credentials.password}\n\nDepois de entrar, troque a senha em Conta.`;
  return (
    <Modal
      open
      onClose={onClose}
      title="Acesso pronto"
      footer={
        <button className="btn btn-primary" onClick={onClose}>
          Concluir
        </button>
      }
    >
      <p style={{ color: "var(--text-2)" }}>
        Envie os dados abaixo para {credentials.name}.{" "}
        <strong>A senha não será mostrada de novo.</strong>
      </p>
      <div className="credential">
        <span>E-mail</span>
        <strong>{credentials.email}</strong>
      </div>
      <div className="credential">
        <span>Senha</span>
        <strong className="mono">{credentials.password}</strong>
        <CopyButton text={credentials.password} />
      </div>
      <CopyButton text={message} label="Copiar mensagem pronta para enviar" />
    </Modal>
  );
}

function CreateUserModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (c: Credentials | null) => void;
}) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [plan, setPlan] = useState("pro");
  const [generate, setGenerate] = useState(true);
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open)
      queueMicrotask(() => {
        setName("");
        setEmail("");
        setPlan("pro");
        setGenerate(true);
        setPassword("");
        setErrors({});
      });
  }, [open]);
  const submit = async () => {
    setBusy(true);
    setErrors({});
    try {
      const result = await api<{
        user: { name: string; email: string };
        temporaryPassword: string | null;
      }>("admin/users", {
        body: { name, email, plan, ...(generate ? {} : { password }) },
      });
      toast({
        tone: "success",
        title: "Usuário cadastrado",
        description: result.user.email,
      });
      onCreated(
        result.temporaryPassword
          ? {
              name: result.user.name,
              email: result.user.email,
              password: result.temporaryPassword,
            }
          : null,
      );
    } catch (error) {
      setErrors(fieldErrors(error));
      toast({
        tone: "error",
        title: "Não foi possível cadastrar",
        description: errorText(error),
      });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Cadastrar usuário"
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn btn-primary" onClick={submit} disabled={busy}>
            {busy ? <Spinner /> : <UserPlus size={16} />} Cadastrar
          </button>
        </>
      }
    >
      <Field label="Nome" error={errors.name}>
        {(id) => (
          <input
            id={id}
            className="input"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        )}
      </Field>
      <Field label="E-mail" error={errors.email}>
        {(id) => (
          <input
            id={id}
            className="input"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        )}
      </Field>
      <Field label="Plano">
        {(id) => (
          <select
            id={id}
            className="select"
            value={plan}
            onChange={(e) => setPlan(e.target.value)}
          >
            {PLANS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        )}
      </Field>
      <label className="toggle-row">
        <input
          type="checkbox"
          checked={generate}
          onChange={(e) => setGenerate(e.target.checked)}
        />
        <span>
          <strong>Gerar senha automaticamente</strong>
          <small>Você recebe a senha para copiar e enviar ao cliente.</small>
        </span>
      </label>
      {!generate && (
        <Field
          label="Senha"
          hint="Pelo menos 8 caracteres."
          error={errors.password}
        >
          {(id) => (
            <input
              id={id}
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          )}
        </Field>
      )}
    </Modal>
  );
}

export function AdminUsers({ me }: { me: Me }) {
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [credentials, setCredentials] = useState<Credentials | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [confirmEmail, setConfirmEmail] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSearch(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);
  const { data, error, refresh } = useApi<UserList>(
    `admin/users?${new URLSearchParams({ q: search })}`,
  );
  const path = (u: AdminUser, suffix = "") =>
    `admin/users/${encodeURIComponent(u.id)}${suffix}`;
  const act = async (label: string, run: () => Promise<void>) => {
    setBusy(true);
    try {
      await run();
      toast({ tone: "success", title: label });
      refresh();
    } catch (e) {
      toast({
        tone: "error",
        title: "Não foi possível concluir",
        description: errorText(e),
      });
    } finally {
      setBusy(false);
      setPending(null);
      setConfirmEmail("");
    }
  };
  const confirm = () => {
    if (!pending) return;
    const { kind, user } = pending;
    if (kind === "block" || kind === "unblock")
      return act(
        kind === "block" ? "Acesso bloqueado" : "Acesso liberado",
        async () => {
          await api(path(user, "/status"), {
            body: { status: kind === "block" ? "blocked" : "active" },
          });
        },
      );
    if (kind === "reset")
      return act("Senha redefinida", async () => {
        const r = await api<{ temporaryPassword: string }>(
          path(user, "/password"),
          { body: {} },
        );
        setCredentials({
          name: user.name,
          email: user.email,
          password: r.temporaryPassword,
        });
      });
    return act("Usuário excluído", async () => {
      await api(path(user), { method: "DELETE", body: { confirmEmail } });
    });
  };
  const t = data?.totals;
  return (
    <>
      <div className="view-head fade-up">
        <div>
          <h1>Usuários</h1>
          <p>
            Quem tem acesso ao {BRAND.name}. Só administradores veem esta tela.
          </p>
        </div>
        <div className="view-actions">
          <button className="btn btn-primary" onClick={() => setCreating(true)}>
            <UserPlus size={17} /> Cadastrar usuário
          </button>
        </div>
      </div>
      <div
        className="summary-strip"
        style={{ gridTemplateColumns: "repeat(4, minmax(0, 1fr))" }}
      >
        {(t
          ? [
              ["Usuários", t.total],
              ["Ativos", t.active],
              ["Bloqueados", t.blocked],
              ["Novos no mês", t.newThisMonth],
            ]
          : []
        ).map(([label, value], i) => (
          <div
            key={label}
            className="card kpi fade-up"
            style={{ "--i": i } as React.CSSProperties}
          >
            <div className="kpi-label">{label}</div>
            <div className="kpi-value">{value}</div>
          </div>
        ))}
      </div>
      {data && (
        <section
          className="card fade-up"
          style={{
            marginBottom: 16,
            display: "flex",
            alignItems: "center",
            gap: 16,
            justifyContent: "space-between",
            flexWrap: "wrap",
          }}
        >
          <div>
            <h3 style={{ fontSize: 15.5, fontWeight: 640 }}>
              Cadastro pelo site {data.signupOpen ? "aberto" : "fechado"}
            </h3>
            <p className="muted" style={{ fontSize: 13.5, marginTop: 2 }}>
              {data.signupOpen
                ? "Qualquer pessoa pode criar uma conta pela página inicial."
                : "Só você cadastra novos usuários. A página de cadastro mostra um aviso."}
            </p>
          </div>
          <Switch
            checked={data.signupOpen}
            label="Cadastro pelo site"
            disabled={busy}
            onChange={(open) =>
              act(
                open
                  ? "Cadastro pelo site aberto"
                  : "Cadastro pelo site fechado",
                async () => {
                  await api("admin/settings", { body: { signupOpen: open } });
                },
              )
            }
          />
        </section>
      )}
      <section className="card fade-up">
        <div className="toolbar" style={{ marginBottom: 16 }}>
          <label className="search">
            <Search size={17} />
            <span className="sr-only">Buscar usuário</span>
            <input
              className="input"
              placeholder="Buscar por nome ou e-mail…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
        </div>
        {error ? (
          <p>{error}</p>
        ) : !data ? (
          <div style={{ display: "grid", gap: 10 }}>
            {[0, 1, 2].map((i) => (
              <div key={i} className="skeleton" style={{ height: 52 }} />
            ))}
          </div>
        ) : !data.users.length ? (
          <EmptyState
            icon={Users}
            title="Nenhum usuário encontrado"
            text="Tente outro nome ou e-mail, ou cadastre um novo usuário."
          />
        ) : (
          <div className="table-wrap">
            <table className="table users-table">
              <thead>
                <tr>
                  <th>Usuário</th>
                  <th>Plano</th>
                  <th>Situação</th>
                  <th className="num-cell">Produtos</th>
                  <th>Cadastro</th>
                  <th>Último acesso</th>
                  <th className="num-cell">Ações</th>
                </tr>
              </thead>
              <tbody>
                {data.users.map((u) => {
                  const self = u.id === me.user.id;
                  return (
                    <tr key={u.id} style={{ cursor: "default" }}>
                      <td>
                        <div className="product-cell">
                          <span
                            className="avatar"
                            style={{ width: 34, height: 34, fontSize: 12.5 }}
                          >
                            {initials(u.name, u.email)}
                          </span>
                          <span>
                            <strong
                              style={{ display: "block", fontWeight: 600 }}
                            >
                              {u.name}{" "}
                              {self && (
                                <span
                                  className="badge soon"
                                  style={{ height: 20, marginLeft: 4 }}
                                >
                                  Você
                                </span>
                              )}
                            </strong>
                            <small className="muted">{u.email}</small>
                          </span>
                        </div>
                      </td>
                      <td>
                        <select
                          className="select"
                          style={{ height: 34, width: 130 }}
                          aria-label={`Plano de ${u.name}`}
                          value={u.plan ?? ""}
                          disabled={busy}
                          onChange={(e) =>
                            act("Plano alterado", async () => {
                              await api(path(u, "/plan"), {
                                body: { plan: e.target.value },
                              });
                            })
                          }
                        >
                          {!u.plan && <option value="">Sem plano</option>}
                          {PLANS.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <span
                          className={`badge ${u.status === "active" ? "sold" : "blocked"}`}
                        >
                          <span className="dot" />
                          {u.status === "active" ? "Ativo" : "Bloqueado"}
                        </span>
                      </td>
                      <td className="num-cell">
                        {u.items}{" "}
                        <small className="muted">· {u.sold} vendidos</small>
                      </td>
                      <td className="muted">{dateText(u.createdAt)}</td>
                      <td className="muted">{dateText(u.lastLoginAt)}</td>
                      <td className="num-cell">
                        <div className="row-actions">
                          <button
                            className="btn btn-ghost btn-icon"
                            title="Redefinir senha"
                            aria-label={`Redefinir senha de ${u.name}`}
                            onClick={() =>
                              setPending({ kind: "reset", user: u })
                            }
                          >
                            <KeyRound size={16} />
                          </button>
                          {u.status === "active" ? (
                            <button
                              className="btn btn-ghost btn-icon"
                              title="Bloquear acesso"
                              aria-label={`Bloquear ${u.name}`}
                              disabled={self}
                              onClick={() =>
                                setPending({ kind: "block", user: u })
                              }
                            >
                              <Ban size={16} />
                            </button>
                          ) : (
                            <button
                              className="btn btn-ghost btn-icon"
                              title="Liberar acesso"
                              aria-label={`Liberar ${u.name}`}
                              onClick={() =>
                                setPending({ kind: "unblock", user: u })
                              }
                            >
                              <UserCheck size={16} />
                            </button>
                          )}
                          <button
                            className="btn btn-ghost btn-icon danger"
                            title="Excluir usuário"
                            aria-label={`Excluir ${u.name}`}
                            disabled={self}
                            onClick={() =>
                              setPending({ kind: "delete", user: u })
                            }
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <CreateUserModal
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(c) => {
          setCreating(false);
          refresh();
          if (c) setCredentials(c);
        }}
      />
      <CredentialsModal
        credentials={credentials}
        onClose={() => setCredentials(null)}
      />
      <Modal
        open={!!pending}
        onClose={() => {
          setPending(null);
          setConfirmEmail("");
        }}
        title={
          pending?.kind === "delete"
            ? "Excluir usuário?"
            : pending?.kind === "block"
              ? "Bloquear acesso?"
              : pending?.kind === "unblock"
                ? "Liberar acesso?"
                : "Redefinir senha?"
        }
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setPending(null)}>
              Cancelar
            </button>
            <button
              className={`btn ${pending?.kind === "delete" || pending?.kind === "block" ? "btn-danger" : "btn-primary"}`}
              disabled={
                busy ||
                (pending?.kind === "delete" &&
                  confirmEmail.trim().toLowerCase() !== pending.user.email)
              }
              onClick={confirm}
            >
              {busy && <Spinner />}
              {pending?.kind === "delete"
                ? "Excluir de vez"
                : pending?.kind === "block"
                  ? "Bloquear"
                  : pending?.kind === "unblock"
                    ? "Liberar"
                    : "Gerar nova senha"}
            </button>
          </>
        }
      >
        {pending?.kind === "delete" ? (
          <>
            <p style={{ color: "var(--text-2)" }}>
              A conta de <strong>{pending.user.name}</strong> será apagada com
              todos os produtos ({pending.user.items}), fotos, custos e vendas.
              Isso não pode ser desfeito.
            </p>
            <Field label={`Digite ${pending.user.email} para confirmar`}>
              {(id) => (
                <input
                  id={id}
                  className="input"
                  autoComplete="off"
                  value={confirmEmail}
                  onChange={(e) => setConfirmEmail(e.target.value)}
                />
              )}
            </Field>
          </>
        ) : pending?.kind === "block" ? (
          <p style={{ color: "var(--text-2)" }}>
            {pending.user.name} será desconectado na hora e não conseguirá
            entrar até você liberar. Nenhum dado é apagado.
          </p>
        ) : pending?.kind === "unblock" ? (
          <p style={{ color: "var(--text-2)" }}>
            {pending.user.name} volta a conseguir entrar com a senha atual.
          </p>
        ) : pending ? (
          <p style={{ color: "var(--text-2)" }}>
            Uma nova senha será gerada para {pending.user.name}, e todos os
            aparelhos conectados serão desconectados. Você recebe a senha para
            enviar.
          </p>
        ) : null}
      </Modal>
    </>
  );
}
