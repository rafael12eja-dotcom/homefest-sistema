
export async function leadsAPI(request, env){
 const url = new URL(request.url);
 const id = url.pathname.split('/')[3];

 if(request.method==='GET'){
  const {results} = await env.DB.prepare('SELECT * FROM leads ORDER BY id DESC').all();
  return Response.json(results);
 }

 if(request.method==='POST'){
  const b = await request.json();
  await env.DB.prepare(`
   INSERT INTO leads
   (nome,telefone,email,cidade,bairro,origem,status,observacoes)
   VALUES (?,?,?,?,?,?,?,?)
  `).bind(
   b.nome,b.telefone,b.email,b.cidade,
   b.bairro,b.origem,b.status,b.observacoes
  ).run();
  return Response.json({ok:true});
 }

 if(request.method==='DELETE' && id){
  await env.DB.prepare('DELETE FROM leads WHERE id=?').bind(id).run();
  return Response.json({ok:true});
 }

 return new Response('Método não permitido',{status:405});
}
