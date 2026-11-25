# 🦊 Liz Framework

Framework de desenvolvimento com IA que funciona no **Claude Code**, no **Codex** e no **Antigravity**.
Você manda a tarefa, e o Liz organiza o ciclo **ideia → spec → tarefa → plano → código → PR**, com
sessões que podem ser retomadas, em **um ou vários repos ao mesmo tempo** (backend, frontend, MCP...).

> Baseado no **[Onion](https://github.com/marciocar/onion)**, de Marcio Carvalho. Veja [NOTICE.md](NOTICE.md).

## Como fica num projeto

```
meu-projeto/                 ← workspace: abra a IA aqui
├── AGENTS.md                ← regras do projeto (lido por todas as IAs)
├── .agents/                 ← o Liz (skills, especialistas, sessões, workspace.yaml)
├── docs/                    ← documentação geral do produto
├── repo-backend/            ← repo próprio (git, PRs e imagem próprios)
├── repo-frontend/           ← repo próprio
└── repo-mcp/                ← repo próprio
```

Cada IA lê assim:

| Ferramenta | O que lê | O que o Liz gera |
|---|---|---|
| Claude Code | `AGENTS.md` | `.claude/skills/` e `.claude/agents/` (cópias geradas) |
| Codex | `AGENTS.md` + `.agents/skills/` | `.codex/agents/*.toml` |
| Antigravity | `AGENTS.md` + `.agents/skills/` | `.agents/workflows/*.md` |

A fonte é sempre o `.agents/`. As pontes são geradas pelo instalador; não edite nelas.

## Instalar num projeto

```bash
# 1. uma vez na máquina: clone o framework ao lado dos seus projetos
git clone https://github.com/jeanr0cha/liz-framework.git

# 2. dentro da pasta do projeto
bash ../liz-framework/install.sh            # todas as ferramentas
bash ../liz-framework/install.sh --dry-run  # só mostra o que faria
```

Depois, abra a IA na pasta do projeto e rode `/warm-up` (no Codex: `$warm-up`).

## Atualizar

```bash
bash ../liz-framework/update.sh --pull
```

Atualiza só o que é do framework (lista em `.agents/.liz-manifest`). Não toca em sessões,
`workspace.yaml`, `docs/`, código nem na parte do projeto no `AGENTS.md`.

## Comandos

| Comando | Para quê |
|---|---|
| `liz` | orientação: qual o próximo passo |
| `/warm-up` | carrega o contexto do workspace (e preenche o `AGENTS.md` na 1ª vez) |
| `/catch-up` | reconstrói onde vocês pararam |
| `/docs-build-business-docs` | gera `docs/business-context/` |
| `/docs-build-tech-docs` | gera `docs/technical-context/` |
| `/product-collect` | registra uma ideia ou bug |
| `/product-refine` | perguntas até a ideia ficar clara |
| `/product-spec` | especificação curta |
| `/product-feature` | a ideia vira tarefa (com os repos afetados) |
| `/engineer-start` | branch em cada repo afetado + sessão + desenho (C4) |
| `/engineer-spike` | responde uma dúvida técnica antes de planejar (opcional) |
| `/engineer-plan` | plano em fases, cada fase num repo |
| `/engineer-work` | executa uma fase por vez, com aprovação |
| `/engineer-pre-pr` | revisão e testes antes do PR |
| `/engineer-pr` | um PR por repo afetado |

Especialistas: `@product-agent`, `@task-specialist`, `@software-architect`, `@code-reviewer`, `@test-engineer`.

## Estrutura deste repo

| Pasta | Conteúdo |
|---|---|
| `.agents/skills/` | os comandos |
| `.agents/agents/` | os especialistas |
| `.agents/shared/` | fragmentos usados por vários comandos |
| `.agents/utils/` | scripts: workspace, task manager, forge (GitHub), contexto |
| `.agents/knowledge/` | conhecimento de referência (worklog, gitflow, task manager...) |
| `.agents/templates/` | modelos dos docs gerados |
| `templates/` | o que o instalador cria no projeto (`AGENTS.md`, `docs/`) |
| `install.sh`, `update.sh` | instalar e atualizar |

## Requisitos

`bash` (no Windows, o Git Bash), `git`, `awk`. O `gh` (GitHub CLI) para abrir PRs. O Python só é
necessário para os adaptadores executáveis do Linear e do ClickUp.

## Licença

Código: MIT ([LICENSE](LICENSE)). Documentação de método derivada do Onion: CC BY-NC 4.0
([LICENSE-DOCS](LICENSE-DOCS)). Uso pessoal e nos seus projetos à vontade; não revenda o método.
