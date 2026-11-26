# Changelog

## 0.3.0 — 2026-11-26

Painel local de projetos e CLI `liz.sh`.

- Registro local de projetos (`~/.liz/projects.tsv`): `install.sh` passa a registrar o projeto ao concluir (em `--dry-run` não grava, e qualquer falha no registro não interrompe a instalação).
- Novo motor `liz.sh` (bash + awk + git) com subcomandos: `list [--tsv]`, `info <caminho> [--tsv]`, `scan`, `add`, `remove`, `install`, `update` (um projeto ou `--all`, com `--pull`), `check`, `painel`, `atalho` e `version`.
- Novo painel local com botões (`painel/`): servidor em Node.js (≥ 18) sem dependências npm, rodando apenas em `127.0.0.1` com encerramento automático e instância única. Mostra versões, status (`ok`, `desatualizado`, `mais-novo`, `ausente` etc.), repos, sessões abertas e documentos Markdown, e atualiza projetos com um clique.
- Atalho de dois cliques no Windows (`bash liz.sh atalho`): cria `Liz.lnk` na Área de Trabalho e no Menu Iniciar com ícone 🦊 e abertura sem console.
- Segurança do painel: token aleatório por execução, validação de `Host` e `Origin`, CSP estrita, bloqueio de *path traversal* e leitura de `.env`, visualizador de Markdown sem HTML executável e suite automatizada `painel/teste-seguranca.sh`.

## 0.2.1 — 2026-11-25

- README reorganizado: começo rápido, o ciclo e as sessões em poucas linhas, comandos agrupados por etapa
  com "quando usar", tabela de especialistas, um exemplo de ponta a ponta, gerenciador de tarefas e
  opções do instalador.
- `AGENTS.md` do projeto (bloco do Liz): o caminho inclui o `/engineer-spike` e aponta o
  `@software-architect` para desenho e decisões.

## 0.2.0 — 2026-11-25

Desenho de software, trazido do Onion (`onion-evolve` até `9d1180926079`).

- Novo especialista `@software-architect`: desenha a arquitetura em C4 (Mermaid) a partir do código dos
  repos do workspace, compara alternativas e propõe ADRs.
- Nova KB `.agents/knowledge/c4-adr-patterns.md`: níveis do C4, onde cada desenho mora, quando escrever
  ADR e o modelo de ADR.
- Nova skill `engineer-spike`: responde uma dúvida técnica antes do `engineer-plan`, com pergunta fechada,
  critério de morte registrado antes de testar, tempo-caixa e pasta descartável.
- `engineer-start`: o `architecture.md` passa a trazer diagrama C4 do que muda, candidatos a ADR e dúvidas
  abertas, e pode delegar ao `@software-architect` ou propor um spike.
- `engineer-plan`: usa as fichas de spike da sessão e propõe spike em vez de planejar em cima de chute.
- `docs-build-tech-docs`: gera `01-core/architecture.md` com C4 (contexto e containers) e segue o modelo
  de ADR da KB.
- `liz` e `README`: incluem o spike no caminho e o arquiteto entre os especialistas.
- Links quebrados herdados do Onion nas KBs e adapters: reapontados quando o arquivo existe no Liz, ou
  viram texto quando só existem no Onion.

## 0.1.1 — 2026-11-18

- Antigravity CLI (`agy`): documenta que as skills são chamadas pelo nome ("rode a skill warm-up"), já que o CLI trata `.agents/workflows/` como formato antigo e não cria comandos com `/`.

## 0.1.0 — 2026-11-18

Primeira versão, derivada do Onion (onion-mini + onion-evolve, pin `7a5bd2ab7ddf`).

- Estrutura agnóstica: fonte em `.agents/` + `AGENTS.md`; pontes geradas para Claude Code
  (`.claude/skills`, `.claude/agents`), Codex (`.codex/agents/*.toml`) e Antigravity (`.agents/workflows`).
- Workspace com vários repos: `.agents/workspace.yaml` e `ws.sh` (`status`, `list`, `each`, `get`, `path`, `role`).
- Skills: `liz`, `warm-up`, `catch-up`, `product-collect|refine|spec|feature`,
  `engineer-start|plan|work|pre-pr|pr`, `docs-build-business-docs`, `docs-build-tech-docs`.
- Especialistas: `product-agent`, `task-specialist`, `code-reviewer`, `test-engineer`.
- Task Manager (Jira, ClickUp, Asana, Linear, Zoho Projects, offline) e Forge (GitHub) herdados do Onion.
- `install.sh` / `update.sh` com manifest: atualiza só o que é do framework.
