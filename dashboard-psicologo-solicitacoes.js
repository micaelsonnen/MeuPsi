// Lista e responde solicitações de sessão pendentes deste psicólogo.
// Usa o cliente `db` e a variável global `psicologo` já criados em dashboard-psicologo.html.

async function carregarSolicitacoes() {
  if (!psicologo) return;

  const { data, error } = await db.from('solicitacoes_sessao')
    .select('id, data_hora, mensagem, status, pacientes(nome, email)')
    .eq('psicologo_id', psicologo.id)
    .eq('status', 'pendente')
    .order('data_hora');

  const el = document.getElementById('lista-solicitacoes');
  const badge = document.getElementById('badgeSolicitacoes');

  if (error) {
    if (el) el.innerHTML = '<div class="sem-dados">Erro ao carregar pedidos: ' + error.message + '</div>';
    return;
  }

  if (badge) {
    if (data?.length) { badge.textContent = data.length; badge.style.display = 'inline-block'; }
    else { badge.style.display = 'none'; }
  }

  if (!el) return;

  if (!data?.length) {
    el.innerHTML = '<div class="sem-dados">Nenhum pedido pendente</div>';
    return;
  }

  el.innerHTML = data.map(s => `
    <div class="solicitacao-item" data-id="${s.id}">
      <strong>${s.pacientes?.nome || 'Paciente'}</strong>
      <span style="font-size:13px;color:#777;">${new Date(s.data_hora).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</span>
      ${s.mensagem ? `<span style="font-size:13px;color:#555;font-style:italic;">"${escapeHtml(s.mensagem)}"</span>` : ''}
      <div class="sol-acoes">
        <button class="btn-aceitar" onclick="responderSolicitacao('${s.id}', 'aceita')">Aceitar</button>
        <button class="btn-recusar" onclick="responderSolicitacao('${s.id}', 'recusada')">Recusar</button>
      </div>
    </div>`).join('');
}

async function responderSolicitacao(id, novoStatus) {
  const { data: solicitacao, error: errSel } = await db.from('solicitacoes_sessao').select('*').eq('id', id).single();
  if (errSel || !solicitacao) { alert('Não foi possível carregar o pedido.'); return; }

  const { error: errUpd } = await db.from('solicitacoes_sessao').update({ status: novoStatus }).eq('id', id);
  if (errUpd) { alert('Erro ao atualizar pedido: ' + errUpd.message); return; }

  if (novoStatus === 'aceita') {
    // vincula definitivamente o paciente a este psicólogo
    await db.from('pacientes').update({
      psicologo_id: solicitacao.psicologo_id,
      status: 'ativo'
    }).eq('id', solicitacao.paciente_id);

    // cria a sessão agendada de fato
    await db.from('sessoes').insert({
      paciente_id: solicitacao.paciente_id,
      psicologo_id: solicitacao.psicologo_id,
      data_hora: solicitacao.data_hora,
      status: 'agendada'
    });

    if (typeof carregarProximasSessoes === 'function') carregarProximasSessoes();
    if (typeof carregarPacientes === 'function') carregarPacientes();
  }

  carregarSolicitacoes();
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
