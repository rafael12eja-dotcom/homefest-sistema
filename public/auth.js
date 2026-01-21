const form = document.getElementById("loginForm");
const msg = document.getElementById("msg");

function setMsg(text, isErr=false){
  msg.textContent = text || "";
  msg.classList.toggle("is-err", !!isErr);
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  setMsg("Entrando...");
  const fd = new FormData(form);
  const payload = {
    user: fd.get("user"),
    pass: fd.get("pass"),
  };

  try{
    const res = await fetch("/api/login", {
      method: "POST",
      headers: {"content-type":"application/json"},
      body: JSON.stringify(payload)
    });

    if(res.ok){
      const data = await res.json().catch(()=>({}));
      setMsg("Ok! Redirecionando...");
      window.location.href = data.redirect || "/";
      return;
    }

    const err = await res.json().catch(()=>({message:"Falha ao entrar"}));
    setMsg(err.message || "Usuário ou senha inválidos.", true);
  }catch(e2){
    setMsg("Erro de rede. Tente novamente.", true);
  }
});
