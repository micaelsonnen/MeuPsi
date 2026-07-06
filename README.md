# MeuPsi

Plataforma que conecta pacientes a psicólogos para acompanhamento terapêutico. Stack: HTML + JavaScript puro (sem framework/build step) + Supabase (Postgres, Auth, Storage).

> Este README documenta decisões de arquitetura e convenções que já causaram bugs reais quando não seguidas. Leia antes de mexer no schema ou nas queries.

## Titularidade e autoria

- **Sistema de propriedade de**: Clínica Sonnen
- **Ideia original de**: Juliana Myrian
- **Desenvolvido por**: Micael Faccio, com assistência de Claude (Anthropic)

*(Formalização jurídica — contrato de cessão de direitos patrimoniais, CNAE, regime de bens — em andamento com contador/advogado da família. Este README reflete o entendimento atual do projeto, não substitui o instrumento jurídico definitivo.)*

---

## Stack

- **Frontend:** HTML/CSS/JS puro, um arquivo por página, sem bundler.
- **Backend:** Supabase (Postgres + Auth + Storage), acessado direto do navegador via `@supabase/supabase-js`.
- **Segurança:** toda a proteção de dado entre usuários é feita via **RLS (Row Level Security)** no Postgres — não existe backend próprio validando permissão.
- **Projeto Supabase:** `ipjdmdjlrnfqtnqfnydn`

---

## ⚠️ Convenções que quebram coisa se você errar

### 1. `pacientes.id` = UID de autenticação do paciente

`pacientes.id` **é** o `auth.uid()` do paciente — não é gerado automaticamente, é definido explicitamente no `INSERT`/`UPSERT`. A coluna `pacientes.user_id` existe no schema mas é **vestigial, não é usada em lugar nenhum** — ignore-a.

```js
// Certo
.upsert({ id: pacienteId, ... })
// pacienteId = session.user.id
```

### 2. `psicologos.id` ≠ UID de autenticação do psicólogo

Essa é a confusão mais cara do projeto — já causou um bug onde a lista de pacientes de todo psicólogo aparecia vazia. `psicologos` tem duas colunas diferentes:

- `psicologos.id` → chave própria da tabela, é o que `pacientes.psicologo_id`, `sessoes.psicologo_id` e `consultas.psicologo_id` referenciam.
- `psicologos.user_id` → o `auth.uid()` de login do psicólogo.

**Sempre que estiver no dashboard do psicólogo**, resolva o `id` real antes de fazer qualquer query:

```js
const { data: { session } } = await sb.auth.getSession();
const uid = session.user.id; // isso é o user_id, NÃO o id da tabela psicologos

const { data: psi } = await sb.from('psicologos').select('id').eq('user_id', uid).single();
const psicologoId = psi.id; // ESSE é o id certo pra usar em psicologo_id em outras tabelas
```

### 3. Nomenclatura de colunas de data é inconsistente entre tabelas

- A maioria das tabelas usa português: `criado_em`, `atualizado_em`.
- `blog_posts` é a exceção — usa `created_at`, `updated_at` (inglês), junto com `publicado_em` e `agendado_para` (português). Confirmado via schema real, não é bug.

Sempre confira antes de assumir.

### 4. Sigilo do prontuário é reforçado em duas camadas

O paciente **não tem acesso** ao conteúdo de `sessoes` (prontuário clínico) — nem na interface, nem no banco. Isso é proposital e reforçado no RLS (não existe policy de SELECT para paciente em `sessoes`). Se algum dia for adicionar uma funcionalidade de "paciente vê o prontuário", isso precisa ser uma decisão explícita, não um efeito colateral de outra mudança.

O que o paciente vê sobre a própria evolução é só o **check-in de bem-estar** (`checkins_paciente`) — autoavaliação própria, tabela separada, sem relação com o que o psicólogo escreve.

### 5. Sem pacientes "offline"

Todo paciente precisa se cadastrar e ter conta própria antes de qualquer vínculo com um psicólogo (`escolher-psicologo.html` ou `perfil.html`). O psicólogo **não** pode criar um paciente do zero — essa funcionalidade existiu e foi removida de propósito.

---

## Estrutura de tabelas (schema real, Supabase)

| Tabela | Papel |
|---|---|
| `usuarios` | Perfil básico de login — nome, e-mail, telefone, papel (`paciente`/`psicologo`/`admin`). `id` = `auth.uid()`. |
| `psicologos` | Dados profissionais do psicólogo. `id` próprio + `user_id` (ver seção acima). |
| `pacientes` | Dados demográficos + anamnese do paciente. `id` = `auth.uid()` do paciente. `psicologo_id` referencia `psicologos.id`. |
| `sessoes` | Prontuário clínico — uma linha por sessão registrada pelo psicólogo (resumo, sintomas, intercorrência, plano). Sigilo do psicólogo. |
| `consultas` | Agenda/agendamento — horários disponíveis e marcados. Não tem dado clínico. |
| `checkins_paciente` | Diário de bem-estar autopreenchido pelo paciente (humor/ansiedade/sono). Independente de `sessoes`. |
| `formacoes` | Formação acadêmica do psicólogo (uma linha por item, não é campo de texto único). |
| `blog_posts` | Sistema de blog, publicado por psicólogos aprovados ou admin. |
| `admins` | Lista de `user_id` com acesso administrativo total. Separado de `psicologos` — uma conta admin não precisa (e não deve) ter linha em `psicologos`. |
| `solicitacoes_sessao` | Existe no schema mas **não é usada por nenhum fluxo ativo hoje**. |

---

## Páginas principais

| Arquivo | Quem acessa | Função |
|---|---|---|
| `index.html` | Público | Home, diretório de psicólogos |
| `cadastro.html` | Público | Cadastro de psicólogo |
| `cadastro-paciente.html` | Público | Cadastro de paciente (só cria `usuarios`) |
| `escolher-psicologo.html` | Paciente logado | Escolher/trocar psicólogo (sem horário específico) |
| `perfil.html?id=X` | Público/paciente | Perfil público do psicólogo + agendar horário específico |
| `dashboard-paciente.html` | Paciente logado | Meu Perfil, psicólogo vinculado, check-in de bem-estar |
| `dashboard-psicologo.html` | Psicólogo logado | Pacientes, agenda, prontuário, Meu Perfil |
| `anamnese.html?paciente_id=X` | Psicólogo logado | Editar anamnese completa de um paciente já vinculado |
| `admin.html` | Contas em `admins` | Gestão total: psicólogos, pacientes, agendamentos, blog |
| `login.html` | Público | Login único, redireciona por `papel` |
| `blog.html`, `post.html`, `blog-editor.html` | Público / psicólogo / admin | Sistema de blog |
| `privacidade.html` | Público | Política de privacidade (LGPD) |

---

## Segurança — o que já está implementado

- **RLS ativo em todas as tabelas**, com policy de acesso total (`admin_acesso_total`) para contas em `admins`.
- **Escape de HTML** (`esc()`/`escapeHTML()`) em todo campo de texto livre renderizado via `innerHTML`, para prevenir XSS.
- **Verificação de papel real** no `admin.html` (tabela `admins`), não só sessão logada.

Antes de adicionar uma tabela nova: sempre criar as policies de RLS **junto**, não depois. `checkins_paciente` já ficou sem nenhuma policy por um tempo (RLS ligado bloqueia tudo por padrão) até ser pega numa revisão.

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

---

## Pendências conhecidas

- MFA ainda não ativado nas contas admin.
- `solicitacoes_sessao` existe no schema mas não tem fluxo de UI — decidir se implementa ou remove.
- Plano de resposta a incidente (exigência LGPD) ainda não documentado.
- Split payment (divisão de pagamento psicólogo/plataforma) — fase planejada, não iniciada.
