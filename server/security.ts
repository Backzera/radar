export type RuntimeConfig = Record<string, string | undefined>;
export interface Principal {
  kind: "user" | "service";
  userId: string;
  admin: boolean;
  expiresAt?: number;
  email?: string;
  name?: string;
}
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function equalSecret(a: string, b: string) {
  const hash = async (s: string) =>
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)),
    );
  const [x, y] = await Promise.all([hash(a), hash(b)]);
  let result = 0;
  for (let i = 0; i < x.length; i++) result |= x[i] ^ y[i];
  return result === 0;
}
export async function readBoundedJson(
  request: Request,
  maxBytes = 32768,
): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) return {};
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxBytes) {
        await reader.cancel();
        throw new HttpError(413, "O envio ultrapassa o tamanho permitido.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.length;
  }
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return text ? JSON.parse(text) : {};
  } catch {
    throw new HttpError(400, "JSON inválido.");
  }
}
type AccessKey = JsonWebKey & { kid?: string };
const jwksCache = new Map<string, { expires: number; keys: AccessKey[] }>();
function decodePart(part: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(part)) throw new Error("Invalid encoding");
  return Uint8Array.from(
    atob(part.replace(/-/g, "+").replace(/_/g, "/")),
    (c) => c.charCodeAt(0),
  );
}
/** Strict RS256 Access application-token verification using standard Web Crypto. */
export async function verifyAccess(
  token: string,
  issuer: string,
  audience: string,
  keys: AccessKey[],
  now = Date.now(),
) {
  if (token.length > 16384) throw new Error("Invalid token");
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Invalid token");
  const header = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(decodePart(parts[0])),
  );
  const payload = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(decodePart(parts[1])),
  );
  if (
    header.alg !== "RS256" ||
    typeof header.kid !== "string" ||
    header.crit ||
    header.jku ||
    header.jwk ||
    header.x5u
  )
    throw new Error("Invalid header");
  const key = keys.find(
    (k) =>
      k.kid === header.kid &&
      k.kty === "RSA" &&
      (!k.alg || k.alg === "RS256") &&
      (!k.use || k.use === "sig"),
  );
  if (!key) throw new Error("Unknown key");
  const publicKey = await crypto.subtle.importKey(
    "jwk",
    key,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  if (
    !(await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      publicKey,
      decodePart(parts[2]),
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
    ))
  )
    throw new Error("Invalid signature");
  const seconds = Math.floor(now / 1000),
    aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (
    payload.iss !== issuer ||
    !aud.includes(audience) ||
    typeof payload.sub !== "string" ||
    !payload.sub ||
    payload.sub.length > 200 ||
    !Number.isFinite(payload.exp) ||
    payload.exp <= seconds ||
    !Number.isFinite(payload.iat) ||
    payload.iat > seconds + 30 ||
    (payload.nbf !== undefined &&
      (!Number.isFinite(payload.nbf) || payload.nbf > seconds + 30)) ||
    payload.type !== "app"
  )
    throw new Error("Invalid claims");
  return {
    sub: payload.sub as string,
    expiresAt: (payload.exp * 1000) as number,
  };
}
async function accessKeys(issuer: string) {
  const cached = jwksCache.get(issuer);
  if (cached && cached.expires > Date.now()) return cached.keys;
  const r = await fetch(`${issuer}/cdn-cgi/access/certs`, {
    redirect: "error",
    signal: AbortSignal.timeout(5000),
  });
  if (!r.ok) throw new Error("Identity service unavailable");
  const raw = (await readBoundedJson(
    new Request("https://identity.invalid", {
      method: "POST",
      body: r.body,
      duplex: "half",
    } as RequestInit),
    65536,
  )) as { keys?: AccessKey[] };
  if (!Array.isArray(raw.keys) || raw.keys.length > 30)
    throw new Error("Invalid keys");
  jwksCache.set(issuer, { keys: raw.keys, expires: Date.now() + 300000 });
  return raw.keys;
}
export async function authenticate(
  request: Request,
  config: RuntimeConfig,
  development = false,
): Promise<Principal | null> {
  const authorization = request.headers.get("authorization");
  if (authorization) {
    if (
      !authorization.startsWith("Bearer ") ||
      !config.WORKER_TOKEN ||
      config.WORKER_TOKEN.length < 32 ||
      !(await equalSecret(authorization.slice(7), config.WORKER_TOKEN))
    )
      return null;
    return { kind: "service", userId: "service:worker", admin: false };
  }
  let userId: string | undefined, expiresAt: number | undefined;
  if (config.AUTH_MODE === "cloudflare-access") {
    const issuer = config.ACCESS_ISSUER ?? "",
      audience = config.ACCESS_AUDIENCE ?? "";
    if (
      !/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(issuer) ||
      !audience
    )
      return null;
    const token = request.headers.get("cf-access-jwt-assertion");
    if (!token) return null;
    try {
      const p = await verifyAccess(
        token,
        issuer,
        audience,
        await accessKeys(issuer),
      );
      userId = `access:${new URL(issuer).hostname}:${p.sub}`;
      expiresAt = p.expiresAt;
    } catch {
      return null;
    }
  } else if (
    config.AUTH_MODE === "platform" &&
    config.TRUST_PLATFORM_IDENTITY === "true" &&
    config.PLATFORM_ORIGIN_TOKEN &&
    config.PLATFORM_ORIGIN_TOKEN.length >= 32 &&
    (await equalSecret(
      request.headers.get("x-radar-origin-token") ?? "",
      config.PLATFORM_ORIGIN_TOKEN,
    ))
  ) {
    userId = request.headers.get("oai-authenticated-user-id") ?? undefined;
  } else if (
    development &&
    config.ALLOW_LOCAL_DEV_AUTH === "true" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(new URL(request.url).hostname)
  ) {
    userId = "local-radar";
  }
  if (!userId || userId.length > 300 || /[\x00-\x1f]/.test(userId)) return null;
  return {
    kind: "user",
    userId,
    expiresAt,
    admin: (config.RADAR_ADMIN_IDS ?? "")
      .split(",")
      .map((s) => s.trim())
      .includes(userId),
  };
}
export function authLinks(config: RuntimeConfig) {
  if (config.AUTH_MODE === "password")
    return { signIn: "/entrar", signOut: null };
  return config.AUTH_MODE === "platform"
    ? {
        signIn: "/signin-with-chatgpt?return_to=/",
        signOut: "/signout-with-chatgpt?return_to=/",
      }
    : config.AUTH_MODE === "cloudflare-access"
      ? { signIn: "/", signOut: "/cdn-cgi/access/logout" }
      : { signIn: null, signOut: null };
}
