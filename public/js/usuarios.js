function __hfInit_usuarios(ctx){
function hfApplyPermissions(){ try { if (window.applyPermissionsToDOM) window.applyPermissionsToDOM(document); } catch {} }

const tblBody = document.querySelector("#tbl tbody");
const msg = document.getElementById("msg");
const dlg = document.getElementById("dlg");
const frm = document.getElementById("frm");
const btnNovo = document.getElementById("btnNovo");

const dlgReset = document.getElementById("dlgReset");
const frmReset = document.getElementById("frmReset");
let resetUserId = null;

function setMsg(t, err=false){
  msg.textContent = t || "";
  msg.style.color = err ? "#fca5a5" : "#aaa";
}

async function api(url, opts){
  const res = await fetch(url, {
    headers: { "content-type":"application/json", ...(opts?.headers||{}) },
    credentials: "include",
    ...opts
  });
  let data = null;
  try{ data = await res.json(); }catch(_){}
  if(!res.ok){
    // Robust auth UX
    if (res.status === 401) {
      const next = encodeURIComponent(window.location.pathname + window.location.search);
      window.location.replace(`/login.html?next=${next}`);
      throw new Error('__AUTH_REDIRECT__');
    }
    if (res.status === 403) {
      throw new Error("Acesso restrito. Apenas administradores.");
    }
    throw new Error((data && data.message) ? data.message : ("Erro " + res.status));
  }
  return data;
}

function badge(ativo){
  return ativo ? '<span class="badge on">Ativo</span>' : '<span class="badge off">Inativo</span>';
}

function rowActions(u){
  const toggleLabel = u.ativo ? "Desativar" : "Ativar";
  return `
    <button class="btn secondary" data-act="reset" data-id="${u.id}">Senha</button>
    <button class="btn secondary" data-act="toggle" data-id="${u.id}" data-ativo="${u.ativo ? 1:0}">${toggleLabel}</button>
  `;
}

function render(list){
  tblBody.innerHTML = "";
  for(const u of list){
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(u.nome || "")}</td>
      <td>${escapeHtml(u.email || "")}</td>
      <td>${escapeHtml(u.perfil || "")}</td>
      <td>${badge(!!u.ativo)}</td>
      <td>${rowActions(u)}</td>
    `;
    tblBody.appendChild(tr);
  }
}

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

async function load(){
  try {
    if (window.hfPermsReady) await window.hfPermsReady;
    if (window.hfCanRead && !window.hfCanRead('usuarios')) {
      window.hfRenderNoPermission && window.hfRenderNoPermission({ modulo: 'usuarios', title: 'Sem permissão', container: document.querySelector('main') });
      return;
    }
  } catch {}
  setMsg("Carregando...");
  try{
    const data = await api("/api/usuarios", { method:"GET", headers:{} });
    render(data.usuarios || []);
    if (data.warning) setMsg("Aviso: lista pode estar filtrando por empresa (tenant).", true);
    else setMsg("");
  }catch(e){
    if (e && e.message === '__AUTH_REDIRECT__') return;
    setMsg(e.message, true);
  }
}

btnNovo.addEventListener("click", () => {
  frm.reset();
  dlg.showModal();
});

frm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(frm);
  const payload = {
    nome: fd.get("nome"),
    email: fd.get("email"),
    senha: fd.get("senha"),
    perfil: fd.get("perfil")
  };
  try{
    const resp = await api("/api/usuarios", { method:"POST", body: JSON.stringify(payload) });
    dlg.close();
    // Prefer reloading from server; if server returns created row, we can render immediately too.
    await load();
    if (resp && resp.usuario) {
      // If list is still empty due to tenant mismatch, at least show the created user.
      const current = Array.from(tblBody.querySelectorAll('tr')).length;
      if (!current) render([resp.usuario]);
    }
    setMsg("Usuário criado com sucesso.");
  }catch(err){
    setMsg(err.message, true);
  }
});

tblBody.addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-act]");
  if(!btn) return;
  const id = Number(btn.dataset.id);
  const act = btn.dataset.act;

  if(act === "toggle"){
    const ativo = btn.dataset.ativo === "1";
    try{
      await api(`/api/usuarios/${id}`, { method:"PATCH", body: JSON.stringify({ ativo: !ativo }) });
      await load();
    }catch(err){ setMsg(err.message, true); }
  }

  if(act === "reset"){
    resetUserId = id;
    frmReset.reset();
    dlgReset.showModal();
  }
});

frmReset.addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(frmReset);
  const senha = fd.get("senha");
  try{
    await api(`/api/usuarios/${resetUserId}/reset-password`, { method:"POST", body: JSON.stringify({ senha }) });
    dlgReset.close();
    setMsg("Senha redefinida.");
  }catch(err){
    setMsg(err.message, true);
  }
});

hfApplyPermissions();

load();

}

if (window.hfInitPage) window.hfInitPage('usuarios', __hfInit_usuarios);
else document.addEventListener('DOMContentLoaded', () => __hfInit_usuarios({ restore:false }), { once:true });
