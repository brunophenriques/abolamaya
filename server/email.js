const nodemailer = require('nodemailer');
const { SMTP, BASE_URL } = require('./config');

let transporter = null;

if (SMTP.HOST && SMTP.USER && SMTP.PASS) {
  transporter = nodemailer.createTransport({
    host:   SMTP.HOST,
    port:   Number(SMTP.PORT) || 587,
    secure: false,
    auth:   { user: SMTP.USER, pass: SMTP.PASS },
    family: 4,
    tls:    { rejectUnauthorized: true },
  });
}

const IS_PROD = process.env.NODE_ENV === 'production';

async function sendPasswordReset(toEmail, resetToken) {
  const link = `${BASE_URL}/reset-password.html?token=${resetToken}`;

  if (!transporter) {
    if (!IS_PROD) {
      console.log(`\n[email-dev] Reset link for ${toEmail}:\n  ${link}\n`);
    } else {
      console.warn('[email] SMTP não configurado — link de reset não enviado para', toEmail);
    }
    return;
  }

  await transporter.sendMail({
    from:    SMTP.FROM,
    to:      toEmail,
    subject: 'Recuperação de password — A Bola Maya',
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
  });
}

module.exports = { sendPasswordReset };
