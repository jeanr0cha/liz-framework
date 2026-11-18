# NOTICE — origem e créditos

O **Liz Framework** é um trabalho derivado do **Onion**, de **Marcio Carvalho**:

- Hub: https://github.com/marciocar/onion
- Fontes usadas: [onion-evolve](https://github.com/marciocar/onion-evolve) (conteúdo),
  [onion-mini](https://github.com/marciocar/onion-mini) (escopo inicial) e
  [onion-codex](https://github.com/marciocar/onion-codex) (formato `.agents/skills/`).
- Pin de origem: `onion-mini` materializado do core no commit `7a5bd2ab7ddf` (2026-11-12) e
  `onion-evolve` na mesma data.

## O que mudou em relação ao Onion

- Nome e identidade próprios (**Liz**). O Liz **não** se apresenta como Onion.
- **Agnóstico de ferramenta**: a fonte fica em `.agents/` + `AGENTS.md`, com pontes geradas para
  Claude Code, Codex e Antigravity.
- **Workspace com vários repos** (`.agents/workspace.yaml` + `ws.sh`): uma tarefa pode tocar backend,
  frontend e MCP, cada um com seu git.
- Escopo enxuto: ficaram de fora a federação, o grafo de conhecimento, os censos, a co-evolução e o
  diário do core.

## Licenças herdadas

- **Código** (scripts, skills, agentes): MIT, copyright (c) 2026 Marcio Carvalho, mantido em
  [LICENSE](LICENSE) junto com o copyright das alterações.
- **Documentação de método** (`.agents/knowledge/`, `.agents/shared/`, `.agents/templates/`):
  CC BY-NC 4.0 ([LICENSE-DOCS](LICENSE-DOCS)). Atribuição: Marcio Carvalho, Onion. Uso não comercial.
