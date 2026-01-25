/* public/shell.js
   Shared shell behaviors for legacy modules using the Premium Dark sidebar.
   - Auth gate (client-side safety): if /api/me fails, redirect to /login.html
   - Logout action
   - No framework dependencies
*/

async function api(path, options = {}) {
  const res = await fetch(path, {
    credentials: "include",
    headers: { "Accept": "application/json" },
    ...options,
  });

  // Never cache auth-sensitive responses
  // (Worker also sets no-store; this is a client-side safety net)
  return res;
}

async function ensureSessionOrRedirect() {
  try {
    const res = await api("/api/me", { method: "GET", cache: "no-store" });
    if (!res.ok) {
      window.location.replace("/login.html");
      return null;
    }
    return await res.json();
  } catch {
    window.location.replace("/login.html");
    return null;
  }
}

function bindLogout() {
  const btn = document.getElementById("btnLogout");
  if (!btn) return;

  btn.addEventListener("click", async (ev) => {
    ev.preventDefault();
    try {
      await api("/api/logout", { method: "POST", cache: "no-store" });
    } finally {
      window.location.replace("/login.html");
    }
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  // Client-side auth safety net.
  await ensureSessionOrRedirect();
  bindLogout();
});
