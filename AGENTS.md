# AGENTS.md — desenvolvimento do Liz Framework

Este repo **é o framework**, não um projeto que o usa. Regras para evoluí-lo:

- A fonte única é `.agents/` (skills, agents, shared, utils, knowledge, templates). Nunca crie
  `.claude/`, `.codex/` ou `.agents/workflows/` aqui: as pontes são geradas pelo `install.sh` no projeto.
- Skill nova: `.agents/skills/<categoria>-<nome>/SKILL.md` com frontmatter só `name` (= nome da pasta)
  e `description` (quando usar). Caminhos sempre a partir da raiz do workspace (`.agents/...`).
- Tudo tem de funcionar com **vários repos** (`.agents/workspace.yaml` + `.agents/utils/workspace/ws.sh`)
  e em **Claude Code, Codex e Antigravity**: nada de recurso exclusivo de uma ferramenta na fonte.
- Scripts em bash + awk + git, sem dependência de Python (funciona no Git Bash do Windows);
  **exceção:** `painel/` usa Node.js (≥ 18) sem dependências npm, e é opcional.
- `liz.sh`, `lib/` e `painel/` ficam na raiz e **não** são copiados para os projetos.
- Mudou o comportamento? Atualize `CHANGELOG.md` e suba o `VERSION`. Teste com
  `bash install.sh <pasta-de-teste> --dry-run` e depois numa pasta real.
- Ao trazer algo novo do Onion (`github.com/marciocar/onion-evolve`), registre a origem no `NOTICE.md`.
- Idioma: pt-BR na documentação; código e nomes de arquivo em inglês.
