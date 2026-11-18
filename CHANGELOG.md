# Changelog

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
