"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Bike,
  Cable,
  Camera,
  CheckCircle2,
  AlertTriangle,
  Gamepad2,
  Headphones,
  Info,
  Laptop,
  Microwave,
  Package,
  Smartphone,
  Sofa,
  Tablet,
  Watch,
  Wrench,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  STATUS_LABELS,
  formatCents,
  parseMoneyToCents,
  type Category,
  type Status,
} from "@/core/brick";
import { withBase } from "./base";

export const CATEGORY_ICONS: Record<Category, LucideIcon> = {
  phones: Smartphone,
  consoles: Gamepad2,
  computers: Laptop,
  tablets: Tablet,
  audio: Headphones,
  watches: Watch,
  cameras: Camera,
  accessories: Cable,
  appliances: Microwave,
  tools: Wrench,
  bikes: Bike,
  furniture: Sofa,
  other: Package,
};

export function StatusBadge({ status }: { status: Status }) {
  return (
    <span className={`badge ${status}`}>
      <span className="dot" />
      {STATUS_LABELS[status]}
    </span>
  );
}

const reducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Counts from the last shown value to the new one. */
export function CountUp({
  value,
  format = (v) => formatCents(Math.round(v)),
  duration = 900,
}: {
  value: number;
  format?: (v: number) => string;
  duration?: number;
}) {
  // Starts at 0 on server and client alike, so hydration matches.
  const [shown, setShown] = useState(0);
  const from = useRef(shown);
  useEffect(() => {
    if (reducedMotion()) {
      queueMicrotask(() => setShown(value));
      return;
    }
    const start = performance.now(),
      origin = from.current;
    let frame = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      const current = origin + (value - origin) * eased;
      from.current = current;
      setShown(current);
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value, duration]);
  return <>{format(shown)}</>;
}

/** Adds .in when the element scrolls into view (landing sections). */
export function Reveal({
  children,
  className = "",
  delay = 0,
  as: Tag = "div",
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
  as?: "div" | "section" | "li" | "article";
}) {
  const ref = useRef<HTMLElement | null>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "0px 0px -10% 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return (
    <Tag
      ref={ref as never}
      className={`reveal ${visible ? "in" : ""} ${className}`}
      style={{ "--i": delay } as React.CSSProperties}
    >
      {children}
    </Tag>
  );
}

/** Money typed in reais, stored in cents. Formats on blur. */
export function MoneyInput({
  value,
  onChange,
  id,
  invalid,
  placeholder = "0,00",
  autoFocus,
}: {
  value: number | null;
  onChange: (cents: number | null) => void;
  id?: string;
  invalid?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const format = (c: number | null) =>
    c == null
      ? ""
      : (c / 100).toLocaleString("pt-BR", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        });
  const [text, setText] = useState(format(value));
  const last = useRef(value);
  useEffect(() => {
    if (value !== last.current) {
      last.current = value;
      queueMicrotask(() => setText(format(value)));
    }
  }, [value]);
  return (
    <div className="money">
      <input
        id={id}
        className="input"
        inputMode="decimal"
        autoComplete="off"
        placeholder={placeholder}
        value={text}
        autoFocus={autoFocus}
        aria-invalid={invalid || undefined}
        onChange={(e) => {
          setText(e.target.value);
          const cents = e.target.value.trim()
            ? parseMoneyToCents(e.target.value)
            : null;
          last.current = cents;
          onChange(cents);
        }}
        onBlur={() => setText(format(last.current))}
      />
    </div>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
  className = "",
}: {
  label: string;
  hint?: string;
  error?: string;
  children: (id: string) => ReactNode;
  className?: string;
}) {
  const id = useId();
  return (
    <label className={`field ${className}`} htmlFor={id}>
      <span>{label}</span>
      {children(id)}
      {error ? (
        <span className="error" role="alert">
          {error}
        </span>
      ) : hint ? (
        <small>{hint}</small>
      ) : null}
    </label>
  );
}

/** Lazy photo from the API with a soft fade; falls back to the category icon. */
export function Photo({
  id,
  category,
  alt,
  className = "",
}: {
  id: string | null;
  category: Category;
  alt: string;
  className?: string;
}) {
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  const Icon = CATEGORY_ICONS[category];
  return (
    <div className={`photo ${className}`}>
      {id && state !== "error" ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={withBase(`/api/v1/media/${encodeURIComponent(id)}`)}
          alt={alt}
          loading="lazy"
          decoding="async"
          className={state === "ok" ? "loaded" : ""}
          onLoad={() => setState("ok")}
          onError={() => setState("error")}
        />
      ) : null}
      {(!id || state !== "ok") && (
        <div className="photo-fallback" aria-hidden="true">
          <Icon size={28} strokeWidth={1.6} />
        </div>
      )}
    </div>
  );
}

// Open dialogs, topmost last: only the top one answers Escape and Tab.
const dialogStack: symbol[] = [];
function useDialog(open: boolean, onClose: () => void) {
  const panel = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const self = Symbol("dialog");
    dialogStack.push(self);
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const key = (e: KeyboardEvent) => {
      if (dialogStack[dialogStack.length - 1] !== self) return;
      if (e.key === "Escape") onClose();
      if (e.key === "Tab" && panel.current) {
        const focusable = panel.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]),[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])',
        );
        if (!focusable.length) return;
        const first = focusable[0],
          last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          last.focus();
          e.preventDefault();
        } else if (!e.shiftKey && document.activeElement === last) {
          first.focus();
          e.preventDefault();
        }
      }
    };
    document.addEventListener("keydown", key);
    // React's autoFocus runs first; otherwise focus the first field, not the close button.
    queueMicrotask(() => {
      const root = panel.current;
      if (!root || root.contains(document.activeElement)) return;
      (
        root.querySelector<HTMLElement>("input,select,textarea") ??
        root.querySelector<HTMLElement>("button")
      )?.focus();
    });
    return () => {
      dialogStack.splice(dialogStack.indexOf(self), 1);
      document.removeEventListener("keydown", key);
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, [open, onClose]);
  return panel;
}

export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const panel = useDialog(open, onClose);
  const titleId = useId();
  if (!open) return null;
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={panel}
        className={`drawer ${wide ? "wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className="drawer-head">
          <div>
            <h2 id={titleId}>{title}</h2>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Fechar">
            <X size={18} />
          </button>
        </header>
        <div className="drawer-body">{children}</div>
        {footer ? <footer className="drawer-foot">{footer}</footer> : null}
      </div>
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const panel = useDialog(open, onClose);
  const titleId = useId();
  if (!open) return null;
  return (
    <div className="overlay center" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={panel} className="modal" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className="modal-head">
          <h2 id={titleId}>{title}</h2>
          <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Fechar">
            <X size={18} />
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer ? <footer className="modal-foot">{footer}</footer> : null}
      </div>
    </div>
  );
}

type Toast = { id: number; title: string; description?: string; tone: "success" | "error" | "info" };
const ToastContext = createContext<(t: Omit<Toast, "id">) => void>(() => {});
export const useToast = () => useContext(ToastContext);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const counter = useRef(0);
  const push = useCallback((t: Omit<Toast, "id">) => {
    const id = ++counter.current;
    setToasts((list) => [...list.slice(-2), { ...t, id }]);
    setTimeout(() => setToasts((list) => list.filter((x) => x.id !== id)), 4200);
  }, []);
  const icons = { success: CheckCircle2, error: AlertTriangle, info: Info };
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => {
          const Icon = icons[t.tone];
          return (
            <div key={t.id} className={`toast ${t.tone}`}>
              <Icon size={18} />
              <div>
                <strong>{t.title}</strong>
                {t.description ? <p>{t.description}</p> : null}
              </div>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  text,
  action,
}: {
  icon: LucideIcon;
  title: string;
  text: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty fade-up">
      <div className="empty-icon">
        <Icon size={26} strokeWidth={1.7} />
      </div>
      <h3>{title}</h3>
      <p>{text}</p>
      {action}
    </div>
  );
}

export function Spinner() {
  return <span className="spinner" aria-hidden="true" />;
}
