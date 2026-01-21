const views = {
  dashboard: { title: "Dashboard", hint: "Visão geral do dia e atalhos rápidos." },
  clientes: { title: "Clientes", hint: "Cadastro, contatos, histórico e contratos." },
  eventos: { title: "Festas", hint: "Do orçamento ao pós-evento." },
  financeiro: { title: "Financeiro", hint: "Caixa, custos por festa e lucro." },
  contratos: { title: "Contratos", hint: "Upload e vínculo com clientes/festas." },
  patrimonio: { title: "Patrimônio", hint: "Inventário, manutenção e uso por festa." },
  relatorios: { title: "Relatórios", hint: "Resultados por período e por canal." },
  config: { title: "Configurações", hint: "Marca, permissões e padrões." },
};

function setView(key){
  // buttons
  document.querySelectorAll(".nav-item").forEach(btn => {
    btn.classList.toggle("is-active", btn.dataset.view === key);
  });
  // sections
  document.querySelectorAll(".view").forEach(v => v.classList.remove("is-active"));
  const el = document.getElementById(`view-${key}`);
  if (el) el.classList.add("is-active");

  // header
  const meta = views[key] || { title: "Sistema", hint: "" };
  document.getElementById("pageTitle").textContent = meta.title;
  document.getElementById("pageHint").textContent = meta.hint;

  // close sidebar on mobile
  document.querySelector(".sidebar")?.classList.remove("is-open");
}

document.querySelectorAll(".nav-item").forEach(btn => {
  btn.addEventListener("click", () => setView(btn.dataset.view));
});

// Quick action
document.querySelectorAll("[data-action='go-eventos']").forEach(btn => {
  btn.addEventListener("click", () => setView("eventos"));
});

// Mobile menu
document.getElementById("btnMenu")?.addEventListener("click", () => {
  document.querySelector(".sidebar")?.classList.toggle("is-open");
});

// Modal
const modal = document.getElementById("modal");
function openModal(title, hint, bodyHTML){
  document.getElementById("modalTitle").textContent = title;
  document.getElementById("modalHint").textContent = hint || "";
  document.getElementById("modalBody").innerHTML = bodyHTML || "";
  modal.classList.add("is-open");
  modal.setAttribute("aria-hidden", "false");
}
function closeModal(){
  modal.classList.remove("is-open");
  modal.setAttribute("aria-hidden", "true");
}
modal?.addEventListener("click", (e) => {
  if (e.target?.dataset?.close) closeModal();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && modal.classList.contains("is-open")) closeModal();
});

// Templates (somente UI — depois ligamos no banco D1)
const templates = {
  novoCliente: () => `
    <div class="grid two">
      <div class="field">
        <label>Nome</label>
        <input placeholder="Ex.: Renata" />
      </div>
      <div class="field">
        <label>Telefone</label>
        <input placeholder="+55 (31) ..." />
      </div>
      <div class="field">
        <label>E-mail</label>
        <input placeholder="email@..." />
      </div>
      <div class="field">
        <label>Origem</label>
        <select>
          <option>WhatsApp</option>
          <option>Instagram</option>
          <option>Google</option>
          <option>Indicação</option>
        </select>
      </div>
    </div>
  `,
  novaFesta: () => `
    <div class="grid two">
      <div class="field">
        <label>Cliente</label>
        <input placeholder="Selecione/Busque" />
      </div>
      <div class="field">
        <label>Data</label>
        <input type="date" />
      </div>
      <div class="field">
        <label>Tipo de festa</label>
        <select>
          <option>Infantil</option>
          <option>Casamento</option>
          <option>Corporativo</option>
          <option>Domiciliar</option>
        </select>
      </div>
      <div class="field">
        <label>Convidados</label>
        <input type="number" placeholder="Ex.: 70" />
      </div>
      <div class="field">
        <label>Valor vendido</label>
        <input placeholder="R$ 0,00" />
      </div>
      <div class="field">
        <label>Status</label>
        <select>
          <option>Orçamento</option>
          <option>Fechado</option>
          <option>Produção</option>
          <option>Evento</option>
          <option>Pós</option>
        </select>
      </div>
    </div>
  `,
  novaMov: () => `
    <div class="grid two">
      <div class="field">
        <label>Tipo</label>
        <select>
          <option>Entrada</option>
          <option>Saída</option>
        </select>
      </div>
      <div class="field">
        <label>Data</label>
        <input type="date" />
      </div>
      <div class="field">
        <label>Categoria</label>
        <input placeholder="Ex.: Compras, Equipe, Bebidas..." />
      </div>
      <div class="field">
        <label>Valor</label>
        <input placeholder="R$ 0,00" />
      </div>
      <div class="field" style="grid-column:1 / -1">
        <label>Descrição</label>
        <input placeholder="Detalhes do lançamento" />
      </div>
    </div>
  `,
  uploadContrato: () => `
    <div class="field">
      <label>Vincular ao cliente</label>
      <input placeholder="Buscar cliente..." />
    </div>
    <div class="field">
      <label>Vincular à festa</label>
      <input placeholder="Buscar festa..." />
    </div>
    <div class="field">
      <label>Arquivo</label>
      <input type="file" />
      <div class="muted tiny" style="margin-top:6px">Depois vamos salvar no R2 (privado) e gerar link seguro.</div>
    </div>
  `,
  novoItem: () => `
    <div class="grid two">
      <div class="field">
        <label>Nome do item</label>
        <input placeholder="Ex.: Mesa dobrável" />
      </div>
      <div class="field">
        <label>Categoria</label>
        <input placeholder="Ex.: Mesas" />
      </div>
      <div class="field">
        <label>Quantidade</label>
        <input type="number" placeholder="0" />
      </div>
      <div class="field">
        <label>Status</label>
        <select>
          <option>Ok</option>
          <option>Manutenção</option>
          <option>Reposição</option>
        </select>
      </div>
    </div>
  `
};

document.querySelectorAll("[data-modal]").forEach(btn => {
  btn.addEventListener("click", () => {
    const key = btn.dataset.modal;
    const titleMap = {
      novoCliente: ["Novo cliente", "Cadastro rápido de cliente."],
      novaFesta: ["Nova festa", "Crie o evento e evolua pelo pipeline."],
      novaMov: ["Novo lançamento", "Entrada ou saída do caixa."],
      uploadContrato: ["Enviar contrato", "Envie e vincule ao cliente/festa."],
      novoItem: ["Novo item", "Adicionar item ao patrimônio."],
    };
    const [title, hint] = titleMap[key] || ["Novo", "Preencha os dados."];
    openModal(title, hint, (templates[key] ? templates[key]() : ""));
  });
});

document.getElementById("btnQuickAdd")?.addEventListener("click", () => {
  openModal("Novo", "Escolha o que deseja criar.", `
    <div class="grid two">
      <button class="btn btn-primary w-full" data-quick="novoCliente">+ Cliente</button>
      <button class="btn btn-primary w-full" data-quick="novaFesta">+ Festa</button>
      <button class="btn btn-ghost w-full" data-quick="novaMov">+ Lançamento</button>
      <button class="btn btn-ghost w-full" data-quick="uploadContrato">+ Contrato</button>
    </div>
  `);
  document.querySelectorAll("[data-quick]").forEach(b => {
    b.addEventListener("click", () => {
      const key = b.dataset.quick;
      const titleMap = {
        novoCliente: ["Novo cliente", "Cadastro rápido de cliente."],
        novaFesta: ["Nova festa", "Crie o evento e evolua pelo pipeline."],
        novaMov: ["Novo lançamento", "Entrada ou saída do caixa."],
        uploadContrato: ["Enviar contrato", "Envie e vincule ao cliente/festa."],
      };
      const [title, hint] = titleMap[key] || ["Novo", "Preencha os dados."];
      openModal(title, hint, templates[key]());
    });
  });
});

// Accent live (config)
document.getElementById("applyAccent")?.addEventListener("click", () => {
  const val = document.getElementById("accentInput").value?.trim() || "#d4a84f";
  document.documentElement.style.setProperty("--accent", val);
});

// Basic global search (UI-only)
document.getElementById("globalSearch")?.addEventListener("input", (e) => {
  // placeholder: later we'll search in D1
});

