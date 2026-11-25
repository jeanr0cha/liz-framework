<div align="center">

# 🦊 Liz Framework

**Desenvolvimento com IA, da ideia ao PR, em um ou vários repos.**

[![Claude Code](https://img.shields.io/badge/Claude_Code-suportado-D97757)](#como-chamar-em-cada-ferramenta)
[![Codex](https://img.shields.io/badge/Codex-suportado-412991)](#como-chamar-em-cada-ferramenta)
[![Antigravity](https://img.shields.io/badge/Antigravity-suportado-4285F4)](#como-chamar-em-cada-ferramenta)
[![Licença](https://img.shields.io/badge/licença-MIT_%2B_CC_BY--NC-lightgrey)](#licença)

Você manda a tarefa, e o Liz organiza o ciclo<br>
**ideia → tarefa → desenho → plano → código → PR**<br>
com sessões que podem ser retomadas, em **vários repos ao mesmo tempo** (backend, frontend, MCP...).

[Começar](#começar-em-1-minuto) · [O ciclo](#o-ciclo) · [Comandos](#comandos) · [Especialistas](#especialistas) · [Exemplo](#exemplo) · [Instalar e atualizar](#instalar-e-atualizar)

<sub>Baseado no <a href="https://github.com/marciocar/onion">Onion</a>, de Marcio Carvalho. Veja <a href="NOTICE.md">NOTICE.md</a>.</sub>

</div>

---

## Começar em 1 minuto

```bash
# 1. uma vez na máquina: clone o framework ao lado dos seus projetos
git clone https://github.com/jeanr0cha/liz-framework.git

# 2. dentro da pasta do projeto (a que contém os repos)
bash ../liz-framework/install.sh
```

3. Abra a IA nessa pasta e rode `/warm-up`. Ele lê os repos e preenche o `AGENTS.md`.
4. Na dúvida, escreva só **`liz`**: ela diz em que ponto você está e qual o próximo comando.

## Como fica num projeto

```
meu-projeto/                 ← workspace: abra a IA aqui
├── AGENTS.md                ← regras do projeto (lido por todas as IAs)
├── .agents/                 ← o Liz: skills, especialistas, sessões, workspace.yaml
├── docs/                    ← documentação do produto e specs das tarefas
├── repo-backend/            ← repo próprio (git, branches e PRs próprios)
├── repo-frontend/           ← repo próprio
└── repo-mcp/                ← repo próprio
```

O instalador descobre os repos git das subpastas e os lista em `.agents/workspace.yaml`. Uma tarefa
pode mexer em vários deles: o Liz cria a mesma branch `feature/<slug>` em cada um e abre um PR por repo.
Com um repo só, instale na pasta dele e registre-o no `workspace.yaml` com `path: .`.

## O ciclo

```
Produto     /product-collect → /product-refine → /product-spec → /product-feature
                                (opcional)        (opcional)
Engenharia  /engineer-start → /engineer-spike → /engineer-plan → /engineer-work → /engineer-pre-pr → /engineer-pr
                               (opcional)                         (fase a fase)
```

- **Produto** transforma uma ideia solta em tarefa clara, com critérios de aceite e os repos afetados.
- **Engenharia** desenha a mudança, planeja em fases pequenas e executa **uma fase por vez**, parando
  para você aprovar antes da próxima.
- Cada tarefa vira uma **sessão** em `.agents/sessions/<tarefa>/`. Ela guarda o que foi combinado
  (`context.md`), o desenho (`architecture.md`), o plano (`plan.md`) e onde parou (`STATE.md`). Fechou
  a IA ou trocou de ferramenta? Rode `/catch-up` e continue de onde estava.

## Comandos

| Etapa | Comando | Quando usar |
|---|---|---|
| Orientação | `liz` | não sabe o próximo passo |
| | `/warm-up` | ao abrir a IA no workspace (na 1ª vez, preenche o `AGENTS.md`) |
| | `/catch-up` | voltar a uma sessão depois de uma pausa |
| Documentação | `/docs-build-business-docs` | gerar `docs/business-context/` (negócio, clientes, produto) |
| | `/docs-build-tech-docs` | gerar `docs/technical-context/` (arquitetura em C4, ADRs, guias) |
| Produto | `/product-collect` | anotar uma ideia ou bug |
| | `/product-refine` | a ideia ainda tem dúvidas: a IA pergunta até ficar clara |
| | `/product-spec` | escrever uma especificação curta antes da tarefa |
| | `/product-feature` | transformar a ideia em tarefa, já com os repos afetados |
| Engenharia | `/engineer-start` | começar a tarefa: branches, sessão e desenho da mudança |
| | `/engineer-spike` | uma dúvida técnica trava o plano ("a lib aguenta?"): teste curto e descartável |
| | `/engineer-plan` | dividir o trabalho em fases de ~2h, cada uma num repo |
| | `/engineer-work` | executar a próxima fase |
| | `/engineer-pre-pr` | revisar e testar tudo antes do PR |
| | `/engineer-pr` | abrir um PR por repo afetado |

### Como chamar em cada ferramenta

| Ferramenta | Exemplo |
|---|---|
| Claude Code e Antigravity IDE | `/engineer-start` |
| Codex | `$engineer-start` |
| Antigravity CLI (`agy`) | peça pelo nome: "rode a skill engineer-start" |

## Especialistas

Os comandos chamam os especialistas quando precisam. Você também pode pedir direto ("chama o
software-architect para..."; no Claude Code, `@software-architect`).

| Especialista | Para quê |
|---|---|
| `@product-agent` | organizar, priorizar e detalhar ideias |
| `@task-specialist` | quebrar uma tarefa grande em partes |
| `@software-architect` | desenhar a arquitetura (C4), comparar abordagens e propor ADRs |
| `@code-reviewer` | revisar o código atrás de bugs e problemas de manutenção |
| `@test-engineer` | escrever testes que verificam o comportamento real |

## Exemplo

```
você: /product-collect login com Google no app
você: /product-feature            → tarefa em docs/specs/login-google.md (repos: backend, frontend)
você: /engineer-start login-google → branch feature/login-google nos dois repos + desenho em C4
você: /engineer-plan              → 4 fases: 2 no backend, 2 no frontend
você: /engineer-work              → fase 1 pronta, a IA para e pede seu ok
      ... (fecha a IA, volta no dia seguinte) ...
você: /catch-up                   → "parou na fase 2 do backend"
você: /engineer-work              → até a última fase
você: /engineer-pre-pr e /engineer-pr → um PR em cada repo
```

## Gerenciador de tarefas

Sem configuração, tudo funciona **offline**: as tarefas ficam em `docs/specs/` e nas sessões. Para
usar Jira, ClickUp, Asana, Linear ou Zoho Projects, crie um `.env` na raiz do workspace com
`TASK_MANAGER_PROVIDER` e as chaves do gerenciador (lista em `.agents/utils/task-manager/README.md`).
A IA nunca abre nem imprime o `.env`.

## Instalar e atualizar

```bash
bash ../liz-framework/install.sh                       # instala para as três ferramentas
bash ../liz-framework/install.sh --tools claude,codex  # só para algumas
bash ../liz-framework/install.sh --dry-run             # mostra o que faria, sem mexer
bash ../liz-framework/update.sh --pull                 # baixa a versão nova do Liz e atualiza o projeto
```

Os dois aceitam o caminho do projeto como argumento, se você não estiver dentro dele.

A atualização mexe **só no que é do framework** (lista em `.agents/.liz-manifest`). Ela não toca em
sessões, `workspace.yaml`, `docs/`, código, nos seus próprios skills e especialistas, nem na parte do
projeto no `AGENTS.md`.

A fonte é sempre o `.agents/`. O instalador gera uma "ponte" para cada ferramenta, e elas não devem
ser editadas à mão:

| Ferramenta | O que lê | Ponte gerada |
|---|---|---|
| Claude Code | `AGENTS.md` | `.claude/skills/` e `.claude/agents/` |
| Codex | `AGENTS.md` + `.agents/skills/` | `.codex/agents/*.toml` |
| Antigravity | `AGENTS.md` + `.agents/skills/` | `.agents/workflows/*.md` |

## Estrutura deste repo

| Pasta | Conteúdo |
|---|---|
| `.agents/skills/` | os comandos |
| `.agents/agents/` | os especialistas |
| `.agents/shared/` | trechos usados por vários comandos |
| `.agents/utils/` | scripts: workspace, gerenciador de tarefas, GitHub, contexto |
| `.agents/knowledge/` | conhecimento de referência (C4 e ADR, worklog, gitflow, gerenciador de tarefas...) |
| `.agents/templates/` | modelos dos docs gerados |
| `templates/` | o que o instalador cria no projeto (`AGENTS.md`, `docs/`) |
| `install.sh`, `update.sh` | instalar e atualizar |

Para evoluir o próprio framework, siga as regras do [AGENTS.md](AGENTS.md). O histórico de versões
fica no [CHANGELOG.md](CHANGELOG.md).

## Requisitos

`bash` (no Windows, o Git Bash), `git`, `awk`. O `gh` (GitHub CLI) para abrir PRs. O Python só é
necessário para os adaptadores executáveis do Linear e do ClickUp.

## Licença

Código: MIT ([LICENSE](LICENSE)). Documentação de método derivada do Onion: CC BY-NC 4.0
([LICENSE-DOCS](LICENSE-DOCS)). Uso pessoal e nos seus projetos à vontade; não revenda o método.

---

<div align="center">
<sub>🦊 Feito para trabalhar junto com a IA, uma fase de cada vez.</sub>
</div>
