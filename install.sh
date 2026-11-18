#!/usr/bin/env bash
# =============================================================================
# install.sh — instala (ou atualiza) o Liz Framework num projeto/workspace.
#
# Uso (rode a partir da pasta do projeto, ou passe o destino):
#   bash ../liz-framework/install.sh [destino] [--tools claude,codex,antigravity] [--update] [--dry-run]
#
# O que faz:
#   1. copia o framework para <destino>/.agents/ (skills, agents, shared, utils, knowledge, templates)
#   2. cria o AGENTS.md (ou atualiza só o bloco do Liz entre <!-- LIZ:BEGIN --> e <!-- LIZ:END -->)
#   3. cria o .agents/workspace.yaml detectando os repos git das subpastas (só na 1ª vez)
#   4. cria docs/ básico (só o que faltar)
#   5. gera as pontes para cada ferramenta (Claude Code, Codex, Antigravity)
#   6. grava .agents/.liz-version e .agents/.liz-manifest (lista do que é do framework)
#
# Nunca mexe em: .agents/sessions/, .agents/workspace.yaml existente, docs/ existentes, código dos repos,
# nem em skills/agentes criados por você (só o que está no manifest é do framework).
# =============================================================================
set -euo pipefail

FW="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST=""; TOOLS="claude,codex,antigravity"; MODE="install"; DRY=0
while [ $# -gt 0 ]; do case "$1" in
  --tools) TOOLS="$2"; shift 2 ;;
  --tools=*) TOOLS="${1#*=}"; shift ;;
  --update) MODE="update"; shift ;;
  --dry-run) DRY=1; shift ;;
  -h|--help) sed -n '2,18p' "$0"; exit 0 ;;
  -*) echo "opção desconhecida: $1" >&2; exit 2 ;;
  *) DEST="$1"; shift ;;
esac; done
DEST="$(cd "${DEST:-.}" && pwd)"
[ "$DEST" = "$FW" ] && { echo "❌ O destino é o próprio liz-framework. Rode dentro da pasta do projeto." >&2; exit 2; }

say() { printf '%s\n' "$*"; }
run() { if [ "$DRY" -eq 1 ]; then say "   (dry-run) $*"; else "$@"; fi; }
has_tool() { case ",$TOOLS," in *",$1,"*) return 0 ;; *) return 1 ;; esac; }

OLD_MANIFEST="$DEST/.agents/.liz-manifest"
# temporários dentro do destino (o /tmp nem sempre é gravável, ex.: sandbox no Windows)
NEW_MANIFEST="$(mktemp "$DEST/.liz-manifest.XXXXXX")"
BLOCK_FILE="$(mktemp "$DEST/.liz-block.XXXXXX")"
trap 'rm -f "$NEW_MANIFEST" "$BLOCK_FILE"' EXIT

if [ "$MODE" = "install" ] && [ -f "$OLD_MANIFEST" ]; then
  say "ℹ️  Liz já instalado aqui — seguindo como atualização."; MODE="update"
fi
say "🦊 Liz Framework — $MODE em $DEST"

# --- 1. framework → .agents/ -------------------------------------------------
track() { printf '%s\n' "$1" >> "$NEW_MANIFEST"; }
put() { # put <origem> <destino-relativo>
  local rel="$2"; track "$rel"
  [ "$DRY" -eq 1 ] && return 0
  mkdir -p "$(dirname "$DEST/$rel")"; cp "$1" "$DEST/$rel"
}
for part in skills agents shared utils knowledge templates; do
  [ -d "$FW/.agents/$part" ] || continue
  while IFS= read -r -d '' f; do put "$f" ".agents/${f#"$FW/.agents/"}"; done < <(find "$FW/.agents/$part" -type f -print0)
done
say "   ✅ framework copiado para .agents/"

# --- 2. AGENTS.md ----------------------------------------------------------------
awk '/<!-- LIZ:BEGIN -->/,/<!-- LIZ:END -->/' "$FW/templates/AGENTS.md" > "$BLOCK_FILE"
if [ ! -f "$DEST/AGENTS.md" ]; then
  run cp "$FW/templates/AGENTS.md" "$DEST/AGENTS.md"; say "   ✅ AGENTS.md criado (o /warm-up preenche os <!-- PREENCHER -->)"
elif grep -q '<!-- LIZ:BEGIN -->' "$DEST/AGENTS.md"; then
  if [ "$DRY" -eq 0 ]; then
    awk -v bf="$BLOCK_FILE" '/<!-- LIZ:BEGIN -->/ { while ((getline l < bf) > 0) print l; skip=1; next }
         /<!-- LIZ:END -->/ { skip=0; next } !skip { print }' "$DEST/AGENTS.md" > "$DEST/AGENTS.md.tmp"
    mv "$DEST/AGENTS.md.tmp" "$DEST/AGENTS.md"
  fi
  say "   ✅ AGENTS.md: bloco do Liz atualizado (o resto do arquivo ficou como estava)"
else
  if [ "$DRY" -eq 0 ]; then printf '\n' >> "$DEST/AGENTS.md"; cat "$BLOCK_FILE" >> "$DEST/AGENTS.md"; fi
  say "   ✅ AGENTS.md já existia: bloco do Liz acrescentado no fim"
fi

# --- 3. workspace.yaml (só na 1ª vez) -------------------------------------------
role_of() { case "$1" in *mcp*) echo mcp ;; *front*|*web*) echo frontend ;; *back*|*api*|*server*) echo backend ;; *) echo app ;; esac; }
script_of() { # script_of <dir> <nome> → comando npm se o script existir no package.json
  [ -f "$1/package.json" ] || return 0
  grep -qE "\"$2\"[[:space:]]*:" "$1/package.json" || return 0
  if [ "$2" = test ]; then echo "npm test"; else echo "npm run $2"; fi
}
default_branch_of() {
  if git -C "$1" show-ref --verify --quiet refs/heads/develop; then echo develop; return; fi
  local b; b="$(git -C "$1" symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null || true)"; b="${b#origin/}"
  if [ -n "$b" ]; then echo "$b"; return; fi
  if git -C "$1" show-ref --verify --quiet refs/heads/main; then echo main; else echo master; fi
}
stack_of() {
  local d="$1" s=""
  [ -f "$d/package.json" ] && s="Node.js"
  [ -f "$d/tsconfig.json" ] && s="$s + TypeScript"
  if [ -f "$d/next.config.ts" ] || [ -f "$d/next.config.js" ] || [ -f "$d/next.config.mjs" ]; then s="$s + Next.js"; fi
  [ -f "$d/go.mod" ] && s="Go"
  [ -f "$d/pyproject.toml" ] && s="Python"
  [ -f "$d/Dockerfile" ] && s="$s · Docker"
  echo "${s:-a definir}"
}
WS="$DEST/.agents/workspace.yaml"
REPOS=()
while IFS= read -r -d '' g; do d="$(dirname "$g")"; REPOS+=("${d#"$DEST/"}"); done \
  < <(find "$DEST" -mindepth 2 -maxdepth 2 -name .git -not -path '*/node_modules/*' -print0 | sort -z)
if [ ! -f "$WS" ]; then
  if [ "$DRY" -eq 0 ]; then
    mkdir -p "$DEST/.agents"
    {
      printf '# .agents/workspace.yaml — repos deste workspace. Mantido pelo /warm-up; pode editar à mão.\n'
      printf 'project: %s\n\n' "$(basename "$DEST")"
      printf '# Onde gravar o contexto (opcional; padrão docs/<dim>-context):\n'
      printf '# context_business: docs/business-context\n# context_technical: docs/technical-context\n\n'
      printf 'repos:\n'
      for r in "${REPOS[@]}"; do
        d="$DEST/$r"
        printf '  - name: %s\n    path: %s\n    role: %s\n    stack: %s\n' "$r" "$r" "$(role_of "$r")" "$(stack_of "$d")"
        for s in dev test build lint; do printf '    %s: %s\n' "$s" "$(script_of "$d" "$s")"; done
        printf '    default_branch: %s\n' "$(default_branch_of "$d")"
      done
      if [ ${#REPOS[@]} -eq 0 ]; then printf '  # nenhum repo git nas subpastas; acrescente aqui (name, path, role...)\n'; fi
    } > "$WS"
  fi
  say "   ✅ workspace.yaml criado com ${#REPOS[@]} repo(s): ${REPOS[*]:-nenhum}"
fi

# --- 4. docs/ básico --------------------------------------------------------------
for f in README.md specs/backlog.md; do
  if [ ! -f "$DEST/docs/$f" ]; then
    run mkdir -p "$(dirname "$DEST/docs/$f")"; run cp "$FW/templates/docs/$f" "$DEST/docs/$f"; say "   ✅ docs/$f criado"
  fi
done

# --- 5. pontes por ferramenta -----------------------------------------------------
GEN_NOTE='<!-- GERADO pelo Liz Framework a partir de .agents/ — não edite aqui; edite a fonte e rode update.sh -->'
desc_one_line() { # description do frontmatter (pode ser bloco | ou >) em uma linha, com aspas escapadas
  awk 'NR==1 && /^---/ {fm=1; next}
       fm && /^---/ {exit}
       fm && /^description:/ { v=$0; sub(/^description:[ \t]*/, "", v); if (v !~ /^[|>]/) { print v; done=1; exit } ind=1; next }
       fm && ind && /^[ \t]/ { l=$0; sub(/^[ \t]+/, "", l); out = out (out ? " " : "") l; next }
       fm && ind { print out; done=1; exit }
       END { if (ind && !done) print out }' "$1" | head -1 | sed 's/\\/\\\\/g; s/"/\\"/g'
}
with_note() { # copia o arquivo inserindo a nota de "gerado" logo depois do frontmatter
  awk -v note="$GEN_NOTE" 'NR==1 && /^---/ {fm=1; print; next} fm==1 && /^---/ {print; print note; fm=2; next} {print}' "$1"
}
gen() { # gen <destino-relativo>  (conteúdo pelo stdin)
  track "$1"
  if [ "$DRY" -eq 1 ]; then cat > /dev/null; return 0; fi
  mkdir -p "$(dirname "$DEST/$1")"; cat > "$DEST/$1"
}

# pontes cobrem também skills/agentes criados no projeto (fonte: .agents/ do destino)
AG="$DEST/.agents"; [ "$DRY" -eq 1 ] && AG="$FW/.agents"
if has_tool claude; then
  for s in "$AG"/skills/*/; do n="$(basename "$s")"; with_note "$s/SKILL.md" | gen ".claude/skills/$n/SKILL.md"; done
  for a in "$AG"/agents/*.md; do n="$(basename "$a")"; with_note "$a" | gen ".claude/agents/$n"; done
  # O Claude Code lê o AGENTS.md sozinho quando não há CLAUDE.md. Se já existir um, garante o import.
  if [ -f "$DEST/CLAUDE.md" ] && ! grep -q '^@AGENTS.md' "$DEST/CLAUDE.md"; then
    [ "$DRY" -eq 0 ] && printf '\n@AGENTS.md\n' >> "$DEST/CLAUDE.md"
    say "   ✅ CLAUDE.md existente: import @AGENTS.md acrescentado"
  fi
  say "   ✅ ponte Claude Code: .claude/skills e .claude/agents gerados"
fi
if has_tool codex; then
  # O Codex lê AGENTS.md e .agents/skills/ direto; só os subagentes precisam de .codex/agents/*.toml
  for a in "$AG"/agents/*.md; do
    n="$(basename "$a" .md)"; d="$(desc_one_line "$a")"
    {
      printf '# GERADO pelo Liz Framework a partir de .agents/agents/%s.md — não edite aqui\n' "$n"
      printf 'name = "%s"\ndescription = "%s"\n' "$n" "$d"
      printf 'developer_instructions = """\nVocê é o especialista %s do Liz Framework.\n' "$n"
      printf 'Leia e siga integralmente as instruções em .agents/agents/%s.md (caminho relativo à raiz do workspace).\n' "$n"
      printf 'Regras gerais do projeto: AGENTS.md.\n"""\n'
    } | gen ".codex/agents/$n.toml"
  done
  say "   ✅ ponte Codex: .codex/agents gerados (skills e AGENTS.md são lidos direto)"
fi
if has_tool antigravity; then
  # O Antigravity lê AGENTS.md e .agents/skills/; os comandos com / vêm de .agents/workflows/
  for s in "$AG"/skills/*/; do
    n="$(basename "$s")"; d="$(desc_one_line "$s/SKILL.md")"
    {
      printf -- '---\ndescription: "%s"\n---\n%s\n\n' "$d" "$GEN_NOTE"
      printf 'Siga integralmente as instruções de `.agents/skills/%s/SKILL.md`, usando como entrada o texto que a pessoa escreveu depois do comando.\n' "$n"
    } | gen ".agents/workflows/$n.md"
  done
  say "   ✅ ponte Antigravity: .agents/workflows gerados"
fi

# --- 6. limpeza do que saiu do framework + manifest + versão ----------------------
if [ -f "$OLD_MANIFEST" ]; then
  removed=0
  while IFS= read -r rel; do
    [ -n "$rel" ] || continue
    if ! grep -qxF "$rel" "$NEW_MANIFEST"; then
      run rm -f "$DEST/$rel"; [ "$DRY" -eq 0 ] && rmdir -p --ignore-fail-on-non-empty "$(dirname "$DEST/$rel")" 2>/dev/null || true
      removed=$((removed+1))
    fi
  done < "$OLD_MANIFEST"
  [ $removed -gt 0 ] && say "   🧹 $removed arquivo(s) que saíram do framework foram removidos"
fi
if [ "$DRY" -eq 0 ]; then
  sort -u "$NEW_MANIFEST" > "$OLD_MANIFEST"
  {
    printf 'framework: liz-framework\n'
    printf 'version: %s\n' "$(cat "$FW/VERSION" 2>/dev/null || echo 0.0.0)"
    printf 'commit: %s\n' "$(git -C "$FW" rev-parse --short HEAD 2>/dev/null || echo local)"
    printf 'installed_at: %s\n' "$(date -u +%Y-%m-%dT%H:%MZ)"
    printf 'tools: %s\n' "$TOOLS"
  } > "$DEST/.agents/.liz-version"
fi

# --- 7. .gitignore do workspace (bloco do Liz) -------------------------------------
if [ "$DRY" -eq 0 ]; then
  GI="$DEST/.gitignore"; touch "$GI"
  awk '/^# LIZ:BEGIN/ {skip=1; next} /^# LIZ:END/ {skip=0; next} !skip {print}' "$GI" > "$GI.tmp"
  {
    cat "$GI.tmp"
    printf '# LIZ:BEGIN (gerado pelo Liz Framework: segredos e repos do workspace, que têm git próprio)\n'
    printf '.env\n.env.*\n!.env.example\n'
    for r in "${REPOS[@]}"; do printf '/%s/\n' "$r"; done
    printf '# LIZ:END\n'
  } > "$GI"
  rm -f "$GI.tmp"
fi

say ""
say "🎉 Pronto. Próximo passo: abra a IA (Claude Code, Codex ou Antigravity) nesta pasta e rode /warm-up"
say "   (no Codex: \$warm-up). Para atualizar depois: bash <caminho-do-liz-framework>/update.sh --pull"
