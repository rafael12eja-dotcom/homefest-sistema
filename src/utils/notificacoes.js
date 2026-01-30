/* src/utils/notificacoes.js
   Utility for sending notifications (Email, WhatsApp).
   In production, this would call external APIs like Resend, SendGrid, or Twilio.
*/

export async function enviarEmail({ to, subject, body, env }) {
    console.log(`[EMAIL] Enviando para: ${to} | Assunto: ${subject}`);
    // Simulação de integração com API de e-mail
    // const res = await fetch('https://api.resend.com/emails', { ... });
    return { ok: true, provider: 'simulated' };
}

export async function enviarWhatsApp({ to, message, env }) {
    console.log(`[WHATSAPP] Enviando para: ${to} | Mensagem: ${message}`);
    // Simulação de integração com API de WhatsApp (ex: Evolution API ou Twilio)
    return { ok: true, provider: 'simulated' };
}

export async function notificarVencimento({ tipo, entidade, valor, vencimento, email, telefone, env }) {
    const msg = `Olá! Lembramos que sua conta de ${entidade} no valor de R$ ${valor} vence em ${vencimento}.`;
    
    if (email) {
        await enviarEmail({ to: email, subject: `Lembrete de Vencimento: ${entidade}`, body: msg, env });
    }
    
    if (telefone) {
        await enviarWhatsApp({ to: telefone, message: msg, env });
    }
}
