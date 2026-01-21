function base64urlEncode(bytes) {
  let str = btoa(String.fromCharCode(...new Uint8Array(bytes)));
  return str.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function base64urlDecodeToBytes(b64url) {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((b64url.length + 3) % 4);
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, "0")).join("");
}

async function hmacSign(secret, message) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return base64urlEncode(sig);
}

async function hmacVerify(secret, message, sigB64url) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  );
  const ok = await crypto.subtle.verify(
    "HMAC",
    key,
    base64urlDecodeToBytes(sigB64url),
    new TextEncoder().encode(message)
  );
  return ok;
}

function parseCookies(cookieHeader) {
  const out = {};
  if (!cookieHeader) return out;
  const parts = cookieHeader.split(";");
  for (const p of parts) {
    const [k, ...rest] = p.trim().split("=");
    out[k] = rest.join("=");
  }
  return out;
}

function json(body, status=200, headers={}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...headers
    }
  });
}

function redirect(url, status=302, headers={}) {
  return new Response(null, { status, headers: { Location: url, ...headers } });
}

function isAssetPath(pathname) {
  return (
    pathname.startsWith("/assets/") ||
    pathname.endsWith(".css") ||
    pathname.endsWith(".js") ||
    pathname.endsWith(".png") ||
    pathname.endsWith(".jpg") ||
    pathname.endsWith(".jpeg") ||
    pathname.endsWith(".svg") ||
    pathname.endsWith(".ico") ||
    pathname.endsWith(".webp")
  );
}

function cookie(name, value, opts={}){
  const parts = [`${name}=${value}`];
  if (opts.maxAge !== undefined) parts.push(`Max-Age=${opts.maxAge}`);
  if (opts.httpOnly) parts.push("HttpOnly");
  if (opts.secure) parts.push("Secure");
  if (opts.sameSite) parts.push(`SameSite=${opts.sameSite}`);
  if (opts.path) parts.push(`Path=${opts.path}`);
  return parts.join("; ");
}

async function makeSession(env, user) {
  const exp = Date.now() + 1000 * 60 * 60 * 10; // 10h
  const payload = JSON.stringify({ user, exp });
  const payloadB64 = base64urlEncode(new TextEncoder().encode(payload));
  const sig = await hmacSign(env.SESSION_SECRET, payloadB64);
  return `${payloadB64}.${sig}`;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;

    // Health
    if (pathname === "/health") return json({ ok: true });

    // Logout
    if (pathname === "/logout") {
      return redirect("/login", 302, {
        "Set-Cookie": cookie("hf_session", "", { maxAge: 0, httpOnly: true, secure: true, sameSite: "Lax", path: "/" })
      });
    }

    // Login page
    if (pathname === "/login" || pathname === "/login.html") {
      // Always show login (even if logged) — optional redirect later
      return env.ASSETS.fetch(new Request(new URL("/login.html", url), request));
    }

    // Login API
    if (pathname === "/api/login" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const user = (body.user || "").trim();
      const pass = (body.pass || "").toString();

      if (!env.ADMIN_USER || !env.ADMIN_PASS_SHA256 || !env.SESSION_SECRET) {
        return json({ message: "Configuração ausente no servidor (ADMIN_USER / ADMIN_PASS_SHA256 / SESSION_SECRET)." }, 500);
      }

      const passHex = await sha256Hex(pass);
      const ok = user === env.ADMIN_USER && passHex === env.ADMIN_PASS_SHA256;

      if (!ok) return json({ message: "Usuário ou senha inválidos." }, 401);

      const session = await makeSession(env, user);
      return json({ redirect: "/" }, 200, {
        "Set-Cookie": cookie("hf_session", session, { maxAge: 60*60*10, httpOnly: true, secure: true, sameSite: "Lax", path: "/" })
      });
    }

    // For static assets (css/js/images), let it pass through (no auth needed)
    if (isAssetPath(pathname)) {
      return env.ASSETS.fetch(request);
    }

    // Auth gate for app pages
    const cookies = parseCookies(request.headers.get("Cookie") || "");
    const token = cookies.hf_session;
    if (!token) return redirect("/login");

    const [payloadB64, sig] = token.split(".");
    if (!payloadB64 || !sig) return redirect("/login");

    if (!env.SESSION_SECRET) return json({ message: "SESSION_SECRET ausente." }, 500);

    const sigOk = await hmacVerify(env.SESSION_SECRET, payloadB64, sig);
    if (!sigOk) return redirect("/login");

    let payload;
    try{
      const bytes = base64urlDecodeToBytes(payloadB64);
      payload = JSON.parse(new TextDecoder().decode(bytes));
    }catch{
      return redirect("/login");
    }
    if (!payload || !payload.exp || payload.exp < Date.now()) {
      return redirect("/login", 302, {
        "Set-Cookie": cookie("hf_session", "", { maxAge: 0, httpOnly: true, secure: true, sameSite: "Lax", path: "/" })
      });
    }

    // Serve app (index)
    if (pathname === "/" || pathname === "/index.html") {
      return env.ASSETS.fetch(new Request(new URL("/index.html", url), request));
    }

    // Default: static
    return env.ASSETS.fetch(request);
  }
};
