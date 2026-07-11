# MeuPsi

Plataforma que conecta pacientes a psicólogos para acompanhamento terapêutico. Stack: HTML + JavaScript puro (sem framework/build step) + Supabase (Postgres, Auth, Storage, Edge Functions) + Pagar.me (pagamentos, fase de implantação).

> Este README documenta decisões de arquitetura e convenções que já causaram bugs reais quando não seguidas. Leia antes de mexer no schema ou nas queries.

## Titularidade e autoria

- **Sistema de propriedade de**: Clínica Sonnen
- **Ideia original de**: Juliana Myrian
- **Desenvolvido por**: Micael Faccio, com assistência de Claude (Anthropic)

*(Formalização jurídica — contrato de cessão de direitos patrimoniais, CNAE, regime de bens — em andamento com contador/advogado da família. Este README reflete o entendimento atual do projeto, não substitui o instrumento jurídico definitivo.)*

---

## Stack

- **Frontend:** HTML/CSS/JS puro, um arquivo por página, sem bundler.
- **Backend:** Supabase (Postgres + Auth + Storage + Edge Functions), acessado direto do navegador via `@supabase/supabase-js`.
- **Pagamentos:** Pagar.me API v5 (split de pagamento por sessão + assinatura recorrente da mensalidade). Implementado em código; ativação em produção depende do CNPJ da clínica (ver seção "Pagamentos" abaixo).
- **Segurança:** toda a proteção de dado entre usuários é feita via **RLS (Row Level Security)** no Postgres — não existe backend próprio validando permissão além das Edge Functions de pagamento.
- **Projeto Supabase:** `ipjdmdjlrnfqtnqfnydn`

---

## ⚠️ Convenções que quebram coisa se você errar

### 1. `pacientes.id` = UID de autenticação do paciente

`pacientes.id` **é** o `auth.uid()` do paciente — não é gerado automaticamente, é definido explicitamente no `INSERT`/`UPSERT`.

```js
// Certo
.upsert({ id: pacienteId, ... })
// pacienteId = session.user.id
```

### 2. `psicologos.id` ≠ UID de autenticação do psicólogo

Essa é a confusão mais cara do projeto — já causou um bug onde a lista de pacientes de todo psicólogo aparecia vazia, e outro onde todo psicólogo era redirecionado pro dashboard errado no login (`usuarios.papel` nunca é preenchido pra psicólogo — `cadastro.html` nunca grava na tabela `usuarios`). `psicologos` tem duas colunas diferentes:

- `psicologos.id` → chave própria da tabela, é o que `pacientes.psicologo_id`, `sessoes.psicologo_id`, `consultas.psicologo_id`, `cobrancas.psicologo_id` e `faturas_mensalidade.psicologo_id` referenciam.
- `psicologos.user_id` → o `auth.uid()` de login do psicólogo.

**Sempre que estiver no dashboard do psicólogo ou decidindo pra onde redirecionar no login**, resolva o `id` real checando a tabela `psicologos` pelo `user_id` — nunca confie em `usuarios.papel` pra identificar um psicólogo:

```js
const { data: { session } } = await sb.auth.getSession();
const uid = session.user.id; // isso é o user_id, NÃO o id da tabela psicologos

const { data: psi } = await sb.from('psicologos').select('id').eq('user_id', uid).maybeSingle();
if (psi) { /* é psicólogo */ }
```

### 3. Nomenclatura de colunas de data é inconsistente entre tabelas

- A maioria das tabelas usa português: `criado_em`, `atualizado_em`.
- `blog_posts` é a exceção — usa `created_at` (inglês). Não foi alterado nesta revisão por falta de confirmação se é intencional; não mexer sem confirmar.

Sempre confira antes de assumir.

### 4. `preco_faixa` não existe — é sempre `preco_exato`

Existiu uma coluna `preco_faixa` (texto livre tipo "R$150–200") cogitada no início do projeto, mas a decisão final foi usar sempre `preco_exato` (numérico). Dois arquivos (`escolher-psicologo.html` e `perfil.html`) ficaram consultando `preco_faixa` por um tempo — isso **quebrava a tela inteira** (Supabase retorna erro se o `.select()` pede coluna inexistente), impedindo qualquer paciente de ver ou escolher psicólogo. Corrigido; não reintroduzir `preco_faixa` em lugar nenhum.

### 5. Sigilo do prontuário é reforçado em duas camadas

O paciente **não tem acesso** ao conteúdo de `sessoes` (prontuário clínico) — nem na interface, nem no banco (não existe policy de SELECT para paciente em `sessoes`, de propósito). O que o paciente vê sobre a própria evolução é só o **check-in de bem-estar** (`checkins_paciente`) — autoavaliação própria, tabela separada, sem relação com o que o psicólogo escreve.

### 6. Sem pacientes "offline"

Todo paciente precisa se cadastrar e ter conta própria antes de qualquer vínculo com um psicólogo. O psicólogo **não** pode criar um paciente do zero.

### 7. RLS controla linha, não coluna

`psicologos` tem colunas sensíveis (`cpf`, `pagarme_recipient_id`, `pagarme_subscription_id`, `mensalidade_plataforma`) que não podem vazar pra paciente navegando no diretório público. Como RLS restringe **quais linhas** você vê, não **quais colunas**, a tabela bruta `psicologos` é bloqueada pra leitura pública, e existe uma **view** `psicologos_publico` (só com colunas seguras, filtrando `ativo = true`) que `escolher-psicologo.html` e `perfil.html` consultam em vez da tabela. Qualquer nova tela que liste psicólogos publicamente deve usar essa view, nunca a tabela.

---

## Estrutura de tabelas (schema real, Supabase)

| Tabela | Papel |
|---|---|
| `usuarios` | Perfil básico de login — nome, e-mail, telefone. **Não confiável para identificar psicólogo** (ver convenção 2). |
| `psicologos` | Dados profissionais do psicólogo, incluindo CPF, plano/mensalidade e campos do Pagar.me. `id` próprio + `user_id`. |
| `psicologos_publico` | **View** — recorte seguro de `psicologos` pra listagem pública (sem CPF/dados de pagamento). |
| `pacientes` | Dados demográficos + anamnese do paciente. `id` = `auth.uid()` do paciente. `psicologo_id` referencia `psicologos.id`. |
| `sessoes` | Prontuário clínico — uma linha por sessão registrada pelo psicólogo (resumo, sintomas, intercorrência, plano, tipo de atendimento, valor). Sigilo do psicólogo. |
| `consultas` | Agenda/agendamento — horários disponíveis e marcados. Não tem dado clínico. |
| `checkins_paciente` | Diário de bem-estar autopreenchido pelo paciente (humor/ansiedade/sono). Independente de `sessoes`. |
| `formacoes` | Formação acadêmica do psicólogo (uma linha por item). |
| `instituicoes` | Convênios/planos de saúde aceitos (não é empresa B2B — plataforma é só paciente↔psicólogo). |
| `consentimentos` | Registro de aceite de termos/privacidade (LGPD) — auditável, sem policy de update/delete. |
| `admins` | Lista de `user_id` com acesso administrativo total. Separado de `psicologos`. |
| `blog_posts` | Sistema de blog, publicado por psicólogos aprovados ou admin. |
| `config_plataforma` | Config chave-valor (ex: `comissao_percentual`). Só admin lê; Edge Functions gravam via service role. |
| `cobrancas` | Uma linha por cobrança de sessão via Pagar.me (split). Gravada só por Edge Function. |
| `faturas_mensalidade` | Histórico de faturas da mensalidade do psicólogo. Gravada só por webhook. |
| `solicitacoes_exclusao` | Pedidos de encerramento de conta feitos por pacientes (LGPD) — fila de revisão manual, não apaga nada sozinho. |
| `logs_acesso_prontuario` | Log de auditoria: qual psicólogo abriu a ficha de qual paciente e quando. Só admin lê. |
| `solicitacoes_sessao` | Existe no schema mas **não é usada por nenhum fluxo ativo hoje**. |

---

## Páginas principais

| Arquivo | Quem acessa | Função |
|---|---|---|
| `index.html` | Público | Home, diretório de psicólogos |
| `cadastro.html` | Público | Cadastro de psicólogo (inclui CPF, obrigatório pro Pagar.me) |
| `cadastro-paciente.html` | Público | Cadastro de paciente |
| `escolher-psicologo.html` | Paciente logado | Escolher/trocar psicólogo (consulta `psicologos_publico`) |
| `perfil.html?id=X` | Público/paciente | Perfil público do psicólogo (via `psicologos_publico`) + agendar horário |
| `dashboard-paciente.html` | Paciente logado | Meu Perfil, psicólogo vinculado, check-in de bem-estar, exportar/excluir meus dados |
| `dashboard-psicologo.html` | Psicólogo logado | Pacientes, agenda, prontuário (com sliders/gráficos), Meu Perfil, Meu Plano (mensalidade) |
| `anamnese.html?paciente_id=X` | Psicólogo logado | Editar anamnese completa de um paciente já vinculado |
| `admin.html` | Contas em `admins` | Gestão total: psicólogos, pacientes, agendamentos, financeiro, exclusões (LGPD), 2FA obrigatório |
| `login.html` | Público | Login único, redireciona checando a tabela `psicologos` (não `usuarios.papel`) |
| `planos.html` | Público | Vitrine das faixas de mensalidade (Fundador/Pioneiro/Padrão), contagem em tempo real |
| `blog.html`, `post.html`, `blog-editor.html` | Público / psicólogo / admin | Sistema de blog |
| `privacidade.html`, `termos.html` | Público | Documentos legais (LGPD, termos de uso) |

---

## Pagamentos (Pagar.me) — implementado, ativação pendente

Arquitetura de duas frentes, ambas via Pagar.me API v5:

1. **Mensalidade da plataforma** (psicólogo paga o MeuPsi): faixa travada por ordem de inscrição — 1ª–100ª: R$ 90/mês ("Fundador"); 101ª–200ª: R$ 120/mês ("Pioneiro"); 201ª em diante: R$ 150/mês ("Padrão"). Travado em `cadastro.html` no momento do cadastro, exibido em `planos.html` (vitrine) e no card "Meu Plano" do `dashboard-psicologo.html`.
2. **Split por sessão** (paciente paga, divide automaticamente): comissão de 15% pra plataforma, repasse direto ao psicólogo via `recipient` do Pagar.me.

**Edge Functions** (`supabase/functions/`):
- `pagarme-onboarding` — cria o `recipient` (split) e a `subscription` (mensalidade) do psicólogo, disparada quando o admin aprova o cadastro.
- `pagarme-webhook` — recebe eventos do Pagar.me e atualiza status (autenticado via **HTTP Basic Auth**, configurado no painel deles — não é HMAC).

**Status:** código pronto, mas a **conta do Pagar.me ainda não foi criada** — depende do CNPJ da clínica estar ativo (decisão consciente de adiar, para evitar tributar a comissão da plataforma como pessoa física). Até lá:
- Não configurar `PAGARME_SECRET_KEY` de produção.
- Prazo de repasse (D+X dias) e política de cancelamento/reembolso ainda **não foram definidos** — são placeholders no contrato de adesão (ver seção Documentos legais).

Existe um `contrato_adesao_psicologo.docx` (Termo de Adesão / Prestação de Serviços) cobrindo essa relação comercial, separado dos Termos de Uso — **rascunho técnico, não validado por advogado**.

---

## Segurança — o que já está implementado

- **RLS ativo em todas as tabelas** (ver `rls_completo.sql`, `rls_storage_documentos.sql`, `solicitacoes_exclusao.sql`, `logs_acesso_prontuario.sql`), com funções auxiliares `is_admin()` e `meu_psicologo_id()` centralizando a lógica de permissão. **Nenhuma tabela deve ficar sem policy própria** — só ligar `enable row level security` sem política bloqueia tudo por padrão (já aconteceu com `checkins_paciente` numa revisão anterior).
- **Storage do bucket `documentos`** (CRP, diploma) é privado, acessado só via `createSignedUrl` (5 min de validade) — nunca URL pública direta.
- **View `psicologos_publico`** — ver convenção 7 acima.
- **2FA (TOTP) obrigatório no login do admin** — implementado nativamente com `supabase.auth.mfa`. Testar o fluxo de matrícula (QR code) antes de confiar nele em produção.
- **Senha forte** exigida no cadastro (mínimo 8 caracteres, letra + número) — só client-side; **conferir se o mínimo do lado do servidor no painel do Supabase (Authentication → Policies) também está em 8+**, senão dá pra contornar via chamada direta à API.
- **Escape de HTML** (`esc()`) em todo campo de texto livre renderizado via `innerHTML`. `dashboard-paciente.html` usa `.textContent` em vez de `innerHTML` — também seguro, não precisa de `esc()`.
- **CSP (Content Security Policy)** aplicada via `<meta>` em `login.html` e `admin.html` (os dois mais críticos). **Ainda não aplicada nos demais ~15 arquivos.** Limitação conhecida: `'unsafe-inline'` é necessário no `script-src` porque toda a lógica fica em `<script>` inline no próprio HTML; `frame-ancestors` não funciona via `<meta>` (precisaria de header HTTP real, o que exige trocar de hospedagem estática por uma que permita configurar headers).
- **Log de acesso a prontuário** (`logs_acesso_prontuario`) — grava automaticamente toda vez que um psicólogo abre a ficha de um paciente. Visualização disponível na aba "Logs de acesso" do `admin.html`, com busca por nome.
- **Webhook do Pagar.me autenticado** via HTTP Basic Auth (ver seção Pagamentos).
- **Botão de mostrar/ocultar senha** em todos os campos de senha do site (`login.html`, `cadastro.html`, `cadastro-paciente.html`, `admin.html`) — usabilidade, não é item de segurança em si.

Antes de adicionar uma tabela nova: sempre criar as policies de RLS **junto**, não depois.

---

## LGPD

- **Retenção do prontuário:** mínimo 5 anos, conforme §1º do Art. 1º da Resolução CFP nº 001/2009, reforçado pelo Art. 15 da Resolução CFP nº 006/2019. Citado explicitamente em `privacidade.html` e no contrato de adesão.
- **Exportação de dados:** paciente pode baixar os próprios dados (perfil + check-ins) a qualquer momento, direto do `dashboard-paciente.html`. Não inclui o prontuário clínico (fica com o psicólogo).
- **Exclusão de conta:** vira uma solicitação (`solicitacoes_exclusao`), revisada manualmente pelo admin (aba "Exclusões") — não é automática, porque parte do prontuário tem prazo legal de guarda que não pode ser reduzido nem a pedido do paciente.
- **Documentos:** `termos.html` e `privacidade.html` revisados e com citação específica das resoluções CFP. Ainda faltam preencher (placeholders visíveis no próprio HTML): CNPJ do controlador, e-mail do encarregado/DPO, foro, política de cancelamento/reembolso.

---

## Dados de teste (ambiente de desenvolvimento)

Existem dois scripts para popular/limpar contas fantasia (2 psicólogos, 3 pacientes, sessões e check-ins com dado variado, todos com e-mail `teste.*@meupsi.dev` e nome prefixado "TESTE"):
- `dados_fantasia.sql` — popula.
- `limpar_dados_fantasia.sql` — remove tudo.

**Não rodar em produção com paciente real sem revisar** — insere diretamente em `auth.users`.

---

## Workflow de desenvolvimento

1. Sempre buscar o arquivo real do GitHub antes de editar (`raw.githubusercontent.com/micaelsonnen/MeuPsi/main/<arquivo>`) — nunca editar "de memória".
2. Validar sintaxe JS extraída do `<script>` com `node --check` antes de entregar.
3. Conferir contagem de tags (`<div>`/`</div>`, `<section>`/`</section>`) balanceadas.
4. Quando mexer em schema, sempre confirmar coluna real via:
   ```sql
   select column_name, data_type
   from information_schema.columns
   where table_schema = 'public' and table_name = '<tabela>';
   ```
5. Uma conta de desenvolvimento por vez — múltiplas contas/sessões em paralelo já causaram divergência de schema e retrabalho.
6. **Testar RLS de verdade após qualquer mudança de policy**: logar como um psicólogo/paciente de teste e confirmar que dado de outra conta não vaza. Não considerar uma policy "pronta" só porque a query não deu erro de sintaxe.

---

## Pendências conhecidas

- **Conta Pagar.me** — não criada, aguardando CNPJ da clínica ativo (ver seção Pagamentos).
- **Plano Supabase** — projeto está no tier Free (sem backup robusto, pausa por inatividade); upgrade pro Pro adiado por decisão consciente até o CNPJ, pelo mesmo motivo fiscal do Pagar.me.
- **CSP** — aplicada só em `login.html` e `admin.html`; falta nos demais arquivos.
- **Ambiente de teste separado da produção** — recomendado, não implementado (hoje só existe a branch `main PRODUCTION`).
- **Confirmação de e-mail obrigatória e rate limiting de login** — depende de toggle no painel do Supabase (Authentication), não verificado nesta revisão.
- **Prazo de repasse e política de cancelamento/reembolso** — ainda não definidos, placeholders no contrato de adesão e em `termos.html`.
- **Contrato de adesão do psicólogo** — rascunho técnico, precisa de revisão por advogado antes de qualquer assinatura real.
- `solicitacoes_sessao` existe no schema mas não tem fluxo de UI — decidir se implementa ou remove.
