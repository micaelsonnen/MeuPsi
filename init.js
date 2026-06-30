async function init() {
  const { data: { session } } = await db.auth.getSession();
  if (!session) { window.location.href = 'login.html'; return; }

  // agora busca por user_id (vínculo confiável), não mais por e-mail
  const { data: p } = await db.from('pacientes').select('*').eq('user_id', session.user.id).maybeSingle();

  // se a pessoa logou mas nunca completou o auto-cadastro de paciente
  if (!p) { window.location.href = 'cadastro-paciente.html'; return; }

  pacienteData = p;

  const nome = p?.nome?.split(' ')[0] || 'Olá';
  document.getElementById('topbar-nome').textContent = nome;
  document.getElementById('saudacao').textContent = 'Olá, ' + nome + '! 👋';

  // ainda não escolheu/foi aceito por um psicólogo
  if (!p.psicologo_id) {
    const banner = document.getElementById('banner-status');
    banner.style.display = 'block';

    if (p.status === 'aguardando_psicologo') {
      banner.innerHTML = `
        <h3>⏳ Pedido enviado</h3>
        <p style="font-size:14px;color:var(--muted);">
          Você solicitou uma sessão e está aguardando o psicólogo confirmar o dia e horário.
          Assim que for aceito, seu painel será liberado.
        </p>`;
    } else {
      banner.innerHTML = `
        <h3>👋 Vamos começar</h3>
        <p style="font-size:14px;color:var(--muted);margin-bottom:14px;">
          Você ainda não escolheu um psicólogo. Veja os profissionais disponíveis e solicite o seu primeiro horário.
        </p>
        <a href="escolher-psicologo.html" style="display:inline-block;background:linear-gradient(135deg,var(--navy),var(--sage));color:#fff;padding:10px 20px;border-radius:999px;font-size:13px;font-weight:600;">
          Escolher meu psicólogo
        </a>`;
    }
    // não tenta carregar sessões/stats de um vínculo que ainda não existe
    return;
  }

  // Dias em terapia
  if (p.data_inicio) {
    const dias = Math.floor((Date.now() - new Date(p.data_inicio)) / 86400000);
    document.getElementById('dias-badge').textContent = dias + ' dias em terapia';
    document.getElementById('frase-bv').textContent = 'Você está investindo em você mesmo há ' + dias + ' dias.';
  }

  carregarInicio();
}
