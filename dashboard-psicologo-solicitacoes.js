// Lista solicitações pendentes deste psicólogo
async function carregarSolicitacoes() {
  const { data: { session } } = await db.auth.getSession();
  const { data: psi } = await db.from('psicologos').select('id').eq('user_id', session.user.id).maybeSingle();
  if (!psi) return;

  const { data } = await db.from('solicitacoes_sessao')
    .select('id, data_hora, mensagem, status, pacientes(nome, email)')
    .eq('psicologo_id', psi.id)
    .eq('status', 'pendente')
    .order('data_hora');

  const el = document.getElementById('lista-solicitacoes'); // crie esse <div> na aba
  if (!data?.length) { el.innerHTML = '<div class="sem-dados">Nenhum pedido pendente</div>'; return; }

  el.innerHTML = data.map(s => `
    <div class="solicitacao-item" data-id="${s.id}" data-paciente="${s.pacientes?.email}">
      <strong>${s.pacientes?.nome || 'Paciente'}</strong><br/>
      ${new Date(s.data_hora).toLocaleString('pt-BR')}<br/>
      ${s.mensagem ? `<em>${s.mensagem}</em><br/>` : ''}
      <button onclick="responderSolicitacao('${s.id}', 'aceita')">Aceitar</button>
      <button onclick="responderSolicitacao('${s.id}', 'recusada')">Recusar</button>
    </div>`).join('');
}

async function responderSolicitacao(id, novoStatus) {
  const { data: solicitacao } = await db.from('solicitacoes_sessao').select('*').eq('id', id).single();

  await db.from('solicitacoes_sessao').update({ status: novoStatus }).eq('id', id);

  if (novoStatus === 'aceita') {
    // vincula definitivamente o paciente a este psicólogo
    await db.from('pacientes').update({
      psicologo_id: solicitacao.psicologo_id,
      status: 'ativo'
    }).eq('id', solicitacao.paciente_id);

    // cria a sessão agendada de fato
    await db.from('sessoes').insert({
      paciente_id: solicitacao.paciente_id,
      data_hora: solicitacao.data_hora,
      status: 'agendada'
    });
  }

  carregarSolicitacoes();
}
