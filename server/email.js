const { BASE_URL } = require('./config');

const IS_PROD = process.env.NODE_ENV === 'production';

async function sendPasswordReset(toEmail, resetToken) {
  const link   = `${BASE_URL}/reset-password.html?token=${resetToken}`;
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    if (!IS_PROD) {
      console.log(`\n[email-dev] Reset link for ${toEmail}:\n  ${link}\n`);
    } else {
      console.error('[email] RESEND_API_KEY not set — reset email not sent to', toEmail);
    }
    return;
  }

  const from = process.env.EMAIL_FROM || 'A Bola Maya <onboarding@resend.dev>';

  const res = await fetch('https://api.resend.com/emails', {
    method:  'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      from,
      to:      toEmail,
      subject: 'Recuperar password — A Bola Maya',
      text: [
        'Olá,',
        '',
        'Recebemos um pedido de recuperação de password para a tua conta.',
        '',
        'Clica no link abaixo para definir uma nova password:',
        link,
        '',
        'O link é válido durante 1 hora e só pode ser usado uma vez.',
        '',
        'Se não pediste isto, ignora este email — a tua password não foi alterada.',
        '',
        '— A Bola Maya',
      ].join('\n'),
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
          <h2 style="margin-bottom:8px">Recuperação de password</h2>
          <p>Recebemos um pedido de recuperação de password para a tua conta.</p>
          <p style="margin:24px 0">
            <a href="${link}" style="background:#E61D25;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:700;display:inline-block">
              Definir nova password
            </a>
          </p>
          <p style="color:#666;font-size:.85rem">O link é válido durante 1 hora e só pode ser usado uma vez.</p>
          <p style="color:#666;font-size:.85rem">Se não pediste isto, ignora este email — a tua password não foi alterada.</p>
          <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
          <p style="color:#999;font-size:.78rem">A Bola Maya · Predictions do Mundial 2026</p>
        </div>`,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Resend API ${res.status}: ${body}`);
  }
}

module.exports = { sendPasswordReset };
