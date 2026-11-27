#!/usr/bin/env bash
# =============================================================================
# liz.sh — motor de linha de comando do Liz Framework.
#
# Uso:
#   liz.sh list [--tsv]
#   liz.sh info <caminho> [--tsv]   (#repos: 6 cols; #sessions: 9 cols; #docs: 3 cols)
#   liz.sh scan <pasta> [--depth N]
#   liz.sh add <caminho>
#   liz.sh remove <caminho>
#   liz.sh install <pasta> [--tools a,b]
#   liz.sh update <caminho> | --all [--pull]
#   liz.sh check
#   liz.sh painel
#   liz.sh atalho
#   liz.sh version
# =============================================================================
set -euo pipefail

FW="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/registry.sh
. "$FW/lib/registry.sh"

usage() {
  cat <<'EOF'
Uso: bash liz.sh <comando> [opções]

Comandos:
  list [--tsv]                    Lista projetos registrados e status da versão
  info <caminho> [--tsv]          Mostra repos, sessões abertas e documentos de um projeto
  scan <pasta> [--depth N]        Procura projetos com Liz e adiciona ao registro (padrão: 3)
  add <caminho>                   Adiciona ao registro um projeto que já tem Liz
  remove <caminho>                Remove do registro (nunca apaga arquivos do projeto)
  install <pasta> [--tools a,b]   Instala o Liz na pasta e registra o projeto
  update <caminho> | --all [--pull]
                                  Atualiza um projeto ou todos os desatualizados
  check                           Consulta o GitHub (git fetch) e avisa se há novidades
  painel                          Abre o painel com botões (requer Node.js >= 18)
  atalho                          Cria atalho de dois cliques (Windows)
  version                         Mostra a versão local do framework
EOF
}

die() {
  local code="${1:-1}"; shift
  printf '❌ %s\n' "$*" >&2
  exit "$code"
}

fw_version() {
  if [ -f "$FW/VERSION" ]; then
    tr -d '\r\n' < "$FW/VERSION"
    printf '\n'
  else
    printf '0.0.0\n'
  fi
}

clean_field() {
  printf '%s' "${1:-}" | tr '\t\r\n' '   '
}

# Divide uma linha TSV sem colapsar TABs consecutivos (evita bug do IFS='\t' com campos vazios)
tsv_field() {
  local line="$1" idx="$2" i=1 part
  while [ "$i" -lt "$idx" ]; do
    case "$line" in
      *$'\t'*) line="${line#*$'\t'}" ;;
      *) printf '\n'; return 0 ;;
    esac
    i=$((i + 1))
  done
  part="${line%%$'\t'*}"
  printf '%s\n' "$part"
}

read_kv() {
  local file="$1" key="$2"
  [ -f "$file" ] || { printf '\n'; return 0; }
  awk -v k="$key" '
    { sub(/\r$/, "") }
    $0 ~ "^" k ":[ \t]*" {
      v = $0
      sub("^" k ":[ \t]*", "", v)
      sub(/[ \t]+#.*$/, "", v)
      sub(/[ \t]+$/, "", v)
      gsub(/^["'\'']|["'\'']$/, "", v)
      print v
      exit
    }
  ' "$file"
}

cmp_version() {
  awk -v a="${1:-0.0.0}" -v b="${2:-0.0.0}" '
    BEGIN {
      sub(/-.*$/, "", a); sub(/-.*$/, "", b)
      na = split(a, av, "."); nb = split(b, bv, ".")
      for (i = 1; i <= 3; i++) {
        va = (i <= na ? av[i] + 0 : 0)
        vb = (i <= nb ? bv[i] + 0 : 0)
        if (va < vb) { print -1; exit }
        if (va > vb) { print 1; exit }
      }
      print 0
    }
  '
}

is_inside_fw() {
  local p_key fw_key
  p_key="$(_registry_norm_key "$(_registry_resolve "$1")")"
  fw_key="$(_registry_norm_key "$FW")"
  if [ "$p_key" = "$fw_key" ]; then
    return 0
  fi
  case "$p_key" in
    "$fw_key"/*) return 0 ;;
  esac
  return 1
}

project_row() {
  local native_path="$1"
  local fw_ver="$2"
  local pdir
  pdir="$(to_posix "$native_path")"

  local name="" inst_ver="" status="" tools="" inst_at=""
  local repos_cnt=0 sessions_cnt=0 docs_bus=0 docs_tech=0

  name="$(basename "$pdir")"

  if [ ! -d "$pdir" ]; then
    status="ausente"
  elif [ ! -d "$pdir/.agents" ]; then
    status="sem-liz"
  else
    local ws_yaml="$pdir/.agents/workspace.yaml"
    local ver_file="$pdir/.agents/.liz-version"

    if [ -f "$ws_yaml" ]; then
      local yname
      yname="$(read_kv "$ws_yaml" project)"
      [ -n "$yname" ] && name="$yname"
    fi

    if [ ! -f "$ver_file" ]; then
      status="sem-versao"
    else
      inst_ver="$(read_kv "$ver_file" version)"
      tools="$(read_kv "$ver_file" tools)"
      inst_at="$(read_kv "$ver_file" installed_at)"
      if [ -z "$inst_ver" ]; then
        status="sem-versao"
      else
        local c
        c="$(cmp_version "$inst_ver" "$fw_ver")"
        case "$c" in
          -1) status="desatualizado" ;;
          0)  status="ok" ;;
          1)  status="mais-novo" ;;
        esac
      fi
    fi

    if [ -f "$ws_yaml" ] && [ -f "$pdir/.agents/utils/workspace/ws.sh" ]; then
      repos_cnt="$(bash "$pdir/.agents/utils/workspace/ws.sh" list 2>/dev/null | awk 'NF{c++} END{print c+0}')"
    fi

    if [ -d "$pdir/.agents/sessions" ]; then
      local sd bn
      for sd in "$pdir/.agents/sessions"/*/; do
        [ -d "$sd" ] || continue
        bn="$(basename "$sd")"
        case "$bn" in
          archived|_*|.*) continue ;;
        esac
        sessions_cnt=$((sessions_cnt + 1))
      done
    fi

    local cb ct
    cb="$(read_kv "$ws_yaml" context_business)"
    ct="$(read_kv "$ws_yaml" context_technical)"
    cb="${cb:-docs/business-context}"
    ct="${ct:-docs/technical-context}"
    [ -f "$pdir/$cb/index.md" ] && docs_bus=1
    [ -f "$pdir/$ct/index.md" ] && docs_tech=1
  fi

  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
    "$(clean_field "$native_path")" \
    "$(clean_field "$name")" \
    "$(clean_field "$inst_ver")" \
    "$(clean_field "$fw_ver")" \
    "$(clean_field "$status")" \
    "$(clean_field "$tools")" \
    "$(clean_field "$inst_at")" \
    "$repos_cnt" \
    "$sessions_cnt" \
    "$docs_bus" \
    "$docs_tech"
}

cmd_list() {
  local tsv=0
  while [ $# -gt 0 ]; do
    case "$1" in
      --tsv) tsv=1; shift ;;
      -h|--help) usage; exit 0 ;;
      *) die 1 "Opção desconhecida em list: $1. Use: liz.sh list [--tsv]" ;;
    esac
  done

  local fw_ver
  fw_ver="$(fw_version)"

  if [ "$tsv" -eq 1 ]; then
    local line p
    while IFS= read -r line || [ -n "$line" ]; do
      [ -n "$line" ] || continue
      p="${line%%$'\t'*}"
      project_row "$p" "$fw_ver"
    done < <(registry_list)
    return 0
  fi

  local rows=()
  local line p
  while IFS= read -r line || [ -n "$line" ]; do
    [ -n "$line" ] || continue
    p="${line%%$'\t'*}"
    rows+=("$(project_row "$p" "$fw_ver")")
  done < <(registry_list)

  if [ "${#rows[@]}" -eq 0 ]; then
    printf 'Nenhum projeto registrado ainda.\n'
    printf 'Use: bash liz.sh scan <pasta> ou bash liz.sh install <pasta>\n'
    return 0
  fi

  local use_color=0
  if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
    use_color=1
  fi
  local c_reset="" c_green="" c_yellow="" c_red="" c_cyan="" c_dim=""
  if [ "$use_color" -eq 1 ]; then
    c_reset=$'\033[0m'
    c_green=$'\033[32m'
    c_yellow=$'\033[33m'
    c_red=$'\033[31m'
    c_cyan=$'\033[36m'
    c_dim=$'\033[2m'
  fi

  printf '🦊 Liz Framework v%s — projetos registrados\n\n' "$fw_ver"
  printf '%-22s %-10s %-15s %-6s %-8s %s\n' "PROJETO" "VERSÃO" "STATUS" "REPOS" "SESSÕES" "CAMINHO"
  printf '%-22s %-10s %-15s %-6s %-8s %s\n' "----------------------" "----------" "---------------" "------" "--------" "-------"

  local total=0 outdated=0
  local row path name inst_ver status repos sess color
  for row in "${rows[@]}"; do
    path="$(tsv_field "$row" 1)"
    name="$(tsv_field "$row" 2)"
    inst_ver="$(tsv_field "$row" 3)"
    status="$(tsv_field "$row" 5)"
    repos="$(tsv_field "$row" 8)"
    sess="$(tsv_field "$row" 9)"
    total=$((total + 1))
    [ "$status" = "desatualizado" ] && outdated=$((outdated + 1))
    case "$status" in
      ok) color="$c_green" ;;
      desatualizado) color="$c_yellow" ;;
      mais-novo) color="$c_cyan" ;;
      ausente|sem-liz|sem-versao) color="$c_red" ;;
      *) color="" ;;
    esac
    printf '%-22s %-10s %s%-15s%s %-6s %-8s %s%s%s\n' \
      "${name:0:22}" "${inst_ver:--}" "$color" "$status" "$c_reset" "$repos" "$sess" "$c_dim" "$path" "$c_reset"
  done

  printf '\n'
  if [ "$outdated" -gt 0 ]; then
    printf '%d de %d projetos desatualizados. Rode: bash liz.sh update --all\n' "$outdated" "$total"
  else
    printf '%d projeto(s) registrado(s); nenhum desatualizado.\n' "$total"
  fi
}

doc_title() {
  local f="$1"
  local t
  t="$(awk '
    { sub(/\r$/, "") }
    /^#[ \t]+/ { sub(/^#[ \t]+/, ""); print; exit }
  ' "$f" 2>/dev/null || true)"
  if [ -n "$t" ]; then
    printf '%s' "$t"
  else
    basename "$f"
  fi
}

cmd_info() {
  local target="" tsv=0
  while [ $# -gt 0 ]; do
    case "$1" in
      --tsv) tsv=1; shift ;;
      -h|--help) usage; exit 0 ;;
      -*) die 1 "Opção desconhecida em info: $1. Use: liz.sh info <caminho> [--tsv]" ;;
      *)
        if [ -z "$target" ]; then target="$1"; else die 1 "Argumento extra em info: $1"; fi
        shift ;;
    esac
  done
  [ -n "$target" ] || die 1 "Informe o caminho do projeto. Uso: liz.sh info <caminho> [--tsv]"

  local pdir
  pdir="$(to_posix "$target")"
  [ -d "$pdir" ] || die 1 "Pasta não encontrada: $target. Confira o caminho."
  pdir="$(cd "$pdir" && pwd)"

  local ws_yaml="$pdir/.agents/workspace.yaml"
  local ws_sh="$pdir/.agents/utils/workspace/ws.sh"

  local repos_lines=()
  if [ -f "$ws_yaml" ] && [ -f "$ws_sh" ]; then
    local rline rname rpath rrole rstack rabspath rbranch rchanges
    while IFS= read -r rline || [ -n "$rline" ]; do
      [ -n "$rline" ] || continue
      rname="$(tsv_field "$rline" 1)"
      rpath="$(tsv_field "$rline" 2)"
      rrole="$(tsv_field "$rline" 3)"
      [ -n "$rname" ] || continue
      rstack="$(bash "$ws_sh" get "$rname" stack 2>/dev/null || true)"
      rabspath="$(bash "$ws_sh" path "$rname" 2>/dev/null || true)"
      if [ -n "$rabspath" ] && { [ -d "$rabspath/.git" ] || [ -f "$rabspath/.git" ]; }; then
        rbranch="$(git -C "$rabspath" branch --show-current 2>/dev/null || true)"
        [ -z "$rbranch" ] && rbranch="$(git -C "$rabspath" rev-parse --short HEAD 2>/dev/null || echo '?')"
        rchanges="$(git -C "$rabspath" status --porcelain 2>/dev/null | wc -l | tr -d ' ')"
      else
        rbranch="?"
        rchanges=""
      fi
      repos_lines+=("$(printf '%s\t%s\t%s\t%s\t%s\t%s' \
        "$(clean_field "$rname")" "$(clean_field "$rpath")" "$(clean_field "$rrole")" \
        "$(clean_field "$rstack")" "$(clean_field "$rbranch")" "$(clean_field "$rchanges")")")
    done < <(bash "$ws_sh" list 2>/dev/null || true)
  fi

  local sessions_lines=()
  if [ -d "$pdir/.agents/sessions" ]; then
    local sd bn state_file plan_file s_phase s_title s_status s_next s_chk s_blocked p_total p_done
    while IFS= read -r sd; do
      [ -d "$sd" ] || continue
      bn="$(basename "$sd")"
      case "$bn" in
        archived|_*|.*) continue ;;
      esac
      state_file="$sd/STATE.md"
      plan_file="$sd/plan.md"
      s_phase=""; s_title=""; s_status=""; s_next=""; s_chk=""; s_blocked=""
      p_total=""; p_done=""
      if [ -f "$state_file" ]; then
        local parsed
        parsed="$(awk '
          function trim(s) { sub(/^[ \t]+/, "", s); sub(/[ \t]+$/, "", s); return s }
          { sub(/\r$/, "") }
          /^##[ \t]+NEXT([ \t]*$|[ \t]+)/ { in_next=1; next }
          /^##[ \t]+/ { if (in_next) exit }
          !in_next { next }
          /^[a-z_]+:[ \t]*/ {
            k = $0; sub(/:.*/, "", k)
            v = $0; sub(/^[^:]*:[ \t]*/, "", v)
            vals[k] = trim(v)
          }
          END {
            b = vals["blocked_by"]
            if (tolower(b) == "none") b = ""
            printf "%s\t%s\t%s\t%s\t%s\t%s\n", vals["phase"], vals["phase_title"], vals["status"], vals["next_action"], vals["last_checkpoint"], b
          }
        ' "$state_file" 2>/dev/null || true)"
        s_phase="$(tsv_field "$parsed" 1)"
        s_title="$(tsv_field "$parsed" 2)"
        s_status="$(tsv_field "$parsed" 3)"
        s_next="$(tsv_field "$parsed" 4)"
        s_chk="$(tsv_field "$parsed" 5)"
        s_blocked="$(tsv_field "$parsed" 6)"
      fi
      if [ -f "$plan_file" ]; then
        local plan_counts
        plan_counts="$(awk '
          { sub(/\r$/, "") }
          /^##[ \t]+FASE[ \t]+[0-9]+/ {
            tot++
            if ($0 ~ /\[DONE\][ \t]*$/) done++
          }
          END { printf "%d\t%d\n", tot+0, done+0 }
        ' "$plan_file" 2>/dev/null || true)"
        p_total="$(tsv_field "$plan_counts" 1)"
        p_done="$(tsv_field "$plan_counts" 2)"
      fi
      sessions_lines+=("$(printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s' \
        "$(clean_field "$bn")" "$(clean_field "$s_phase")" "$(clean_field "$s_title")" \
        "$(clean_field "$s_status")" "$(clean_field "$s_next")" "$(clean_field "$s_chk")" \
        "$(clean_field "$p_total")" "$(clean_field "$p_done")" "$(clean_field "$s_blocked")")")
    done < <(find "$pdir/.agents/sessions" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | sort)
  fi

  local docs_lines=()
  local doc_count=0 doc_limit=300
  add_doc() {
    local grp="$1" full="$2"
    [ "$doc_count" -lt "$doc_limit" ] || return 0
    [ -f "$full" ] || return 0
    local rel="${full#"$pdir/"}"
    local title
    title="$(doc_title "$full")"
    docs_lines+=("$(printf '%s\t%s\t%s' "$(clean_field "$grp")" "$(clean_field "$rel")" "$(clean_field "$title")")")
    doc_count=$((doc_count + 1))
  }

  [ -f "$pdir/AGENTS.md" ] && add_doc "projeto" "$pdir/AGENTS.md"

  local cb ct
  cb="$(read_kv "$ws_yaml" context_business)"
  ct="$(read_kv "$ws_yaml" context_technical)"
  cb="${cb:-docs/business-context}"
  ct="${ct:-docs/technical-context}"

  local df
  if [ -d "$pdir/$cb" ]; then
    while IFS= read -r df; do
      add_doc "negocio" "$df"
    done < <(find "$pdir/$cb" -type f -name '*.md' 2>/dev/null | sort)
  fi
  if [ -d "$pdir/$ct" ]; then
    while IFS= read -r df; do
      add_doc "tecnico" "$df"
    done < <(find "$pdir/$ct" -type f -name '*.md' 2>/dev/null | sort)
  fi
  if [ -d "$pdir/docs/specs" ]; then
    while IFS= read -r df; do
      add_doc "specs" "$df"
    done < <(find "$pdir/docs/specs" -type f -name '*.md' 2>/dev/null | sort)
  fi

  if [ "$tsv" -eq 1 ]; then
    printf '#repos\n'
    local item
    for item in "${repos_lines[@]+"${repos_lines[@]}"}"; do printf '%s\n' "$item"; done
    printf '#sessions\n'
    for item in "${sessions_lines[@]+"${sessions_lines[@]}"}"; do printf '%s\n' "$item"; done
    printf '#docs\n'
    for item in "${docs_lines[@]+"${docs_lines[@]}"}"; do printf '%s\n' "$item"; done
    return 0
  fi

  printf '🦊 Projeto: %s (%s)\n\n' "$(basename "$pdir")" "$(to_native "$pdir")"
  printf 'Repos (%d):\n' "${#repos_lines[@]}"
  if [ "${#repos_lines[@]}" -eq 0 ]; then
    printf '  (nenhum repo configurado)\n'
  else
    local item r1 r3 r4 r5 r6
    for item in "${repos_lines[@]}"; do
      r1="$(tsv_field "$item" 1)"
      r3="$(tsv_field "$item" 3)"
      r4="$(tsv_field "$item" 4)"
      r5="$(tsv_field "$item" 5)"
      r6="$(tsv_field "$item" 6)"
      printf '  - %-20s %-10s @ %-18s %s alt.  (%s)\n' "$r1" "${r3:--}" "$r5" "${r6:--}" "${r4:--}"
    done
  fi
  printf '\nSessões abertas (%d):\n' "${#sessions_lines[@]}"
  if [ "${#sessions_lines[@]}" -eq 0 ]; then
    printf '  (nenhuma sessão aberta)\n'
  else
    local item s1 s2 s4 s5
    for item in "${sessions_lines[@]}"; do
      s1="$(tsv_field "$item" 1)"
      s2="$(tsv_field "$item" 2)"
      s4="$(tsv_field "$item" 4)"
      s5="$(tsv_field "$item" 5)"
      printf '  - %s [%s] fase=%s %s\n' "$s1" "${s4:--}" "${s2:--}" "$s5"
    done
  fi
  printf '\nDocumentos (%d):\n' "${#docs_lines[@]}"
  if [ "${#docs_lines[@]}" -eq 0 ]; then
    printf '  (nenhum documento encontrado)\n'
  else
    local item d1 d2 d3
    for item in "${docs_lines[@]}"; do
      d1="$(tsv_field "$item" 1)"
      d2="$(tsv_field "$item" 2)"
      d3="$(tsv_field "$item" 3)"
      printf '  - [%s] %s — %s\n' "$d1" "$d2" "$d3"
    done
  fi
}

cmd_scan() {
  local target="" depth=3
  while [ $# -gt 0 ]; do
    case "$1" in
      --depth)
        [ $# -ge 2 ] || die 1 "Faltou o número depois de --depth."
        depth="$2"; shift 2 ;;
      --depth=*) depth="${1#*=}"; shift ;;
      -h|--help) usage; exit 0 ;;
      -*) die 1 "Opção desconhecida em scan: $1. Use: liz.sh scan <pasta> [--depth N]" ;;
      *)
        if [ -z "$target" ]; then target="$1"; else die 1 "Argumento extra em scan: $1"; fi
        shift ;;
    esac
  done
  [ -n "$target" ] || die 1 "Informe a pasta onde procurar. Uso: liz.sh scan <pasta> [--depth N]"
  case "$depth" in
    ''|*[!0-9]*) die 1 "Profundidade inválida: $depth. Use um número inteiro (ex.: --depth 3)." ;;
  esac

  local scan_dir
  scan_dir="$(to_posix "$target")"
  [ -d "$scan_dir" ] || die 1 "Pasta não encontrada: $target. Confira o caminho."
  scan_dir="$(cd "$scan_dir" && pwd)"

  local maxd=$((depth + 2))
  local found=0 added=0 existing=0
  local vf proj_dir native

  printf '🔍 Procurando projetos com Liz em %s (profundidade %d)...\n' "$(to_native "$scan_dir")" "$depth"

  while IFS= read -r -d '' vf; do
    proj_dir="$(dirname "$(dirname "$vf")")"
    if is_inside_fw "$proj_dir"; then
      continue
    fi
    found=$((found + 1))
    native="$(to_native "$proj_dir")"
    if registry_has "$proj_dir"; then
      existing=$((existing + 1))
      printf '   • já registrado: %s\n' "$native"
    else
      if registry_add "$proj_dir"; then
        added=$((added + 1))
        printf '   ✅ adicionado: %s\n' "$native"
      else
        printf '   ⚠️  falhou ao registrar: %s\n' "$native" >&2
      fi
    fi
  done < <(find "$scan_dir" -maxdepth "$maxd" \
      \( -type d \( -name node_modules -o -name .git -o -name dist -o -name build \) -prune \) \
      -o \( -type f -name .liz-version -path '*/.agents/.liz-version' -print0 \) 2>/dev/null)

  printf '\nResultado: %d encontrado(s), %d novo(s) adicionado(s), %d já estava(m) no registro.\n' \
    "$found" "$added" "$existing"
}

cmd_add() {
  local target="${1:-}"
  [ -n "$target" ] || die 1 "Informe o caminho do projeto. Uso: liz.sh add <caminho>"
  local pdir
  pdir="$(to_posix "$target")"
  [ -d "$pdir" ] || die 1 "Pasta não encontrada: $target. Confira o caminho."
  pdir="$(cd "$pdir" && pwd)"
  if is_inside_fw "$pdir"; then
    die 1 "Esta pasta é o próprio liz-framework. Informe a pasta de um projeto."
  fi
  if [ ! -f "$pdir/.agents/.liz-version" ]; then
    die 1 "Este projeto não tem o Liz instalado (.agents/.liz-version ausente). Use: bash liz.sh install \"$target\""
  fi
  if registry_has "$pdir"; then
    printf 'ℹ️  Projeto já estava no registro: %s\n' "$(to_native "$pdir")"
    return 0
  fi
  registry_add "$pdir" || die 2 "Não consegui gravar no registro (~/.liz/projects.tsv). Verifique permissões."
  printf '✅ Projeto adicionado ao registro: %s\n' "$(to_native "$pdir")"
}

cmd_remove() {
  local target="${1:-}"
  [ -n "$target" ] || die 1 "Informe o caminho do projeto. Uso: liz.sh remove <caminho>"
  if registry_remove "$target"; then
    printf '✅ Removido do registro: %s (nenhum arquivo do projeto foi apagado).\n' "$(to_native "$target")"
  else
    die 1 "Projeto não encontrado no registro: $target. Rode 'bash liz.sh list' para ver os caminhos."
  fi
}

cmd_install() {
  local target="" tools=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --tools)
        [ $# -ge 2 ] || die 1 "Faltou a lista de ferramentas depois de --tools."
        tools="$2"; shift 2 ;;
      --tools=*) tools="${1#*=}"; shift ;;
      -h|--help) usage; exit 0 ;;
      -*) die 1 "Opção desconhecida em install: $1. Use: liz.sh install <pasta> [--tools a,b]" ;;
      *)
        if [ -z "$target" ]; then target="$1"; else die 1 "Argumento extra em install: $1"; fi
        shift ;;
    esac
  done
  [ -n "$target" ] || die 1 "Informe a pasta do projeto. Uso: liz.sh install <pasta> [--tools a,b]"
  local pdir
  pdir="$(to_posix "$target")"
  [ -d "$pdir" ] || die 1 "Pasta não encontrada: $target. Crie a pasta antes ou confira o caminho."
  pdir="$(cd "$pdir" && pwd)"
  if is_inside_fw "$pdir"; then
    die 1 "Não é possível instalar o Liz dentro do próprio repo liz-framework."
  fi

  local args=("$pdir")
  [ -n "$tools" ] && args+=("--tools" "$tools")
  bash "$FW/install.sh" "${args[@]}" || exit 2
}

cmd_update() {
  local target="" do_all=0 do_pull=0
  while [ $# -gt 0 ]; do
    case "$1" in
      --all) do_all=1; shift ;;
      --pull) do_pull=1; shift ;;
      -h|--help) usage; exit 0 ;;
      -*) die 1 "Opção desconhecida em update: $1. Use: liz.sh update <caminho> | --all [--pull]" ;;
      *)
        if [ -z "$target" ]; then target="$1"; else die 1 "Argumento extra em update: $1"; fi
        shift ;;
    esac
  done

  if [ "$do_all" -eq 0 ] && [ -z "$target" ]; then
    die 1 "Informe o caminho de um projeto ou use --all. Uso: liz.sh update <caminho> | --all [--pull]"
  fi
  if [ "$do_all" -eq 1 ] && [ -n "$target" ]; then
    die 1 "Use um caminho específico OU --all, não ambos."
  fi

  if [ "$do_pull" -eq 1 ]; then
    printf '⬇️  Atualizando o liz-framework (git pull --ff-only)...\n'
    if ! git -C "$FW" pull --ff-only; then
      die 2 "Falha ao atualizar o liz-framework (pode haver alterações locais ou histórico divergente). Resolva no repo do framework e tente novamente."
    fi
  fi

  if [ "$do_all" -eq 0 ]; then
    local pdir
    pdir="$(to_posix "$target")"
    [ -d "$pdir" ] || die 1 "Pasta não encontrada: $target. Confira o caminho."
    pdir="$(cd "$pdir" && pwd)"
    if [ ! -f "$pdir/.agents/.liz-version" ]; then
      die 1 "Este projeto não tem o Liz instalado. Use: bash liz.sh install \"$target\""
    fi
    bash "$FW/install.sh" "$pdir" --update || exit 2
    return 0
  fi

  local fw_ver
  fw_ver="$(fw_version)"
  local targets=() target_names=()
  local line p row path name status
  while IFS= read -r line || [ -n "$line" ]; do
    [ -n "$line" ] || continue
    p="${line%%$'\t'*}"
    row="$(project_row "$p" "$fw_ver")"
    path="$(tsv_field "$row" 1)"
    name="$(tsv_field "$row" 2)"
    status="$(tsv_field "$row" 5)"
    if [ "$status" = "desatualizado" ]; then
      targets+=("$path")
      target_names+=("$name")
    fi
  done < <(registry_list)

  if [ "${#targets[@]}" -eq 0 ]; then
    printf '✅ Nenhum projeto desatualizado.\n'
    return 0
  fi

  local ok_count=0 fail_count=0 failed_list=()
  local i pdir
  for i in "${!targets[@]}"; do
    pdir="$(to_posix "${targets[$i]}")"
    printf '\n── Atualizando %s (%s)...\n' "${target_names[$i]}" "${targets[$i]}"
    if bash "$FW/install.sh" "$pdir" --update; then
      ok_count=$((ok_count + 1))
    else
      fail_count=$((fail_count + 1))
      failed_list+=("${target_names[$i]}")
      printf '❌ Falhou ao atualizar %s.\n' "${target_names[$i]}" >&2
    fi
  done

  printf '\nResumo: %d atualizado(s)' "$ok_count"
  if [ "$fail_count" -gt 0 ]; then
    local joined
    joined="$(IFS=', '; printf '%s' "${failed_list[*]}")"
    printf ', %d falhou: %s\n' "$fail_count" "$joined"
    exit 2
  fi
  printf '.\n'
}

cmd_check() {
  printf '🔍 Consultando novidades do liz-framework...\n'
  local fetch_rc=0
  if command -v timeout >/dev/null 2>&1; then
    timeout 20 git -C "$FW" fetch --quiet 2>/dev/null || fetch_rc=$?
  else
    git -C "$FW" fetch --quiet 2>/dev/null || fetch_rc=$?
  fi
  if [ "$fetch_rc" -ne 0 ]; then
    die 2 "Não foi possível consultar o GitHub (sem rede, timeout ou remoto indisponível). Verifique a conexão e tente de novo."
  fi

  if ! git -C "$FW" rev-parse --verify --quiet '@{u}' >/dev/null 2>&1; then
    die 2 "Esta branch do liz-framework não tem remoto configurado (upstream). Configure o tracking da branch para consultar novidades."
  fi

  local behind ahead
  behind="$(git -C "$FW" rev-list --count 'HEAD..@{u}' 2>/dev/null || echo 0)"
  ahead="$(git -C "$FW" rev-list --count '@{u}..HEAD' 2>/dev/null || echo 0)"

  if [ "$behind" -gt 0 ]; then
    printf '⬆️  O framework local está %d commit(s) atrás do GitHub. Rode: bash liz.sh update --all --pull\n' "$behind"
  elif [ "$ahead" -gt 0 ]; then
    printf '✅ O framework local está em dia com o GitHub (v%s, %d commit(s) locais à frente).\n' "$(fw_version)" "$ahead"
  else
    printf '✅ O framework local está em dia com o GitHub (v%s).\n' "$(fw_version)"
  fi
}

cmd_painel() {
  if ! command -v node >/dev/null 2>&1; then
    die 1 "O painel precisa do Node.js (>= 18). Instale com: winget install OpenJS.NodeJS.LTS (ou baixe em nodejs.org)."
  fi
  [ -f "$FW/painel/server.js" ] || die 1 "Arquivo painel/server.js não encontrado."
  exec node "$(to_native "$FW/painel/server.js")"
}

cmd_atalho() {
  if ! command -v powershell.exe >/dev/null 2>&1; then
    printf 'ℹ️  O atalho é só para Windows. Use: bash liz.sh painel\n'
    return 0
  fi
  [ -f "$FW/painel/criar-atalho.ps1" ] || die 1 "Arquivo painel/criar-atalho.ps1 não encontrado."
  local ps_path="$FW/painel/criar-atalho.ps1"
  if command -v cygpath >/dev/null 2>&1; then
    ps_path="$(cygpath -w "$ps_path")"
  fi
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$ps_path" "$@"
}

cmd="${1:-}"
if [ -z "$cmd" ] || [ "$cmd" = "-h" ] || [ "$cmd" = "--help" ]; then
  usage
  exit 0
fi
shift

case "$cmd" in
  list)    cmd_list "$@" ;;
  info)    cmd_info "$@" ;;
  scan)    cmd_scan "$@" ;;
  add)     cmd_add "$@" ;;
  remove)  cmd_remove "$@" ;;
  install) cmd_install "$@" ;;
  update)  cmd_update "$@" ;;
  check)   cmd_check "$@" ;;
  painel)  cmd_painel "$@" ;;
  atalho)  cmd_atalho "$@" ;;
  version) fw_version ;;
  *)       die 1 "Comando desconhecido: $cmd. Rode 'bash liz.sh --help' para ver os comandos." ;;
esac
