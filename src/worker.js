
import { leadsAPI } from './routes/leads.js';

export default {
 async fetch(request, env){
  const url = new URL(request.url);

  if(url.pathname.startsWith('/api/leads')){
    return leadsAPI(request, env);
  }

  return env.ASSETS.fetch(request);
 }
}
