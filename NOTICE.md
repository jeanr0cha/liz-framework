# NOTICE — origem e créditos

O **Liz Framework** é um trabalho derivado do **Onion**, de **Marcio Carvalho**:

- Hub: https://github.com/marciocar/onion
- Fontes usadas: [onion-evolve](https://github.com/marciocar/onion-evolve) (conteúdo),
  [onion-mini](https://github.com/marciocar/onion-mini) (escopo inicial) e
  [onion-codex](https://github.com/marciocar/onion-codex) (formato `.agents/skills/`).
- Pin de origem: `onion-mini` materializado do core no commit `7a5bd2ab7ddf` (2026-11-12) e
  `onion-evolve` na mesma data.
- Revisão do `onion-evolve` até o commit `9d1180926079` (2026-11-25), versão 0.2.0 do Liz:

| No Liz | Origem no `onion-evolve` | Como veio |
|---|---|---|
| `.agents/skills/engineer-spike/` | `.claude/commands/engineer/spike.md` | adaptado: sem grafo de conhecimento, a ficha fica na sessão |
| `.agents/agents/software-architect.md` | `.claude/agents/development/c4-architecture-specialist.md` | reescrito: qualquer stack, vários repos, C4 + ADR |
| `.agents/knowledge/c4-adr-patterns.md` | `docs/knowledge-base/architectures/c4-adr-patterns.md` | adaptado: Mermaid, `docs/technical-context/`, sem foco em NX |

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
