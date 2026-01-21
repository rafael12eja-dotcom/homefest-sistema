
async function carregar(){
 const res = await fetch('/api/leads');
 const dados = await res.json();
 const lista = document.getElementById('lista');
 lista.innerHTML='';
 dados.forEach(l=>{
  lista.innerHTML+=`
   <tr>
    <td>${l.nome}</td>
    <td>${l.telefone}</td>
    <td>${l.cidade||''}</td>
    <td>${l.status}</td>
    <td><button onclick="excluir(${l.id})">Excluir</button></td>
   </tr>`;
 });
}

async function salvar(){
 await fetch('/api/leads',{
  method:'POST',
  headers:{'Content-Type':'application/json'},
  body:JSON.stringify({
   nome:nome.value,
   telefone:telefone.value,
   email:email.value,
   cidade:cidade.value,
   bairro:bairro.value,
   origem:origem.value,
   status:status.value,
   observacoes:observacoes.value
  })
 });
 carregar();
}

async function excluir(id){
 await fetch('/api/leads/'+id,{method:'DELETE'});
 carregar();
}

carregar();
