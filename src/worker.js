import { leadsAPI } from './routes/leads.js';
import { clientesAPI } from './routes/clientes.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/api/leads')) {
      return leadsAPI(request, env);
    }

    if (url.pathname.startsWith('/api/clientes')) {
      return clientesAPI(request, env);
    }

    return env.ASSETS.fetch(request);
  }
};
