# =============================================================================
# lib/registry.sh — funções do registro local de projetos (~/.liz/projects.tsv).
#
# Destinado a ser carregado com `source` (ou `.`) por install.sh e liz.sh.
# Não ativa `set -e` próprio para não interferir no chamador.
# =============================================================================

liz_home() {
  local raw="${LIZ_HOME:-${HOME:-}/.liz}"
  to_posix "$raw"
}

to_native() {
  local p="${1:-}"
  [ -n "$p" ] || { printf '\n'; return 0; }
  if command -v cygpath >/dev/null 2>&1; then
    p="$(cygpath -m "$p" 2>/dev/null || printf '%s' "$p")"
  fi
  p="${p//\\//}"
  # remove barra final, exceto raiz "/" ou "D:/"
  while [ "${#p}" -gt 1 ] && [ "${p%/}" != "$p" ]; do
    case "$p" in
      ?:/) break ;;
      *) p="${p%/}" ;;
    esac
  done
  printf '%s\n' "$p"
}

to_posix() {
  local p="${1:-}"
  [ -n "$p" ] || { printf '\n'; return 0; }
  if command -v cygpath >/dev/null 2>&1; then
    p="$(cygpath -u "$p" 2>/dev/null || printf '%s' "$p")"
  fi
  while [ "${#p}" -gt 1 ] && [ "${p%/}" != "$p" ]; do
    p="${p%/}"
  done
  printf '%s\n' "$p"
}

_registry_norm_key() {
  local n
  n="$(to_native "${1:-}")"
  if command -v cygpath >/dev/null 2>&1; then
    printf '%s\n' "$n" | tr '[:upper:]' '[:lower:]'
  else
    printf '%s\n' "$n"
  fi
}

_registry_resolve() {
  local raw="${1:-}"
  [ -n "$raw" ] || { printf '\n'; return 0; }
  local p
  p="$(to_posix "$raw")"
  if [ -d "$p" ]; then
    p="$(cd "$p" 2>/dev/null && pwd || printf '%s' "$p")"
  fi
  to_native "$p"
}

registry_file() {
  printf '%s/projects.tsv\n' "$(liz_home)"
}

registry_list() {
  local f
  f="$(registry_file)"
  [ -f "$f" ] || return 0
  awk '
    { sub(/\r$/, "") }
    /^[ \t]*$/ || /^[ \t]*#/ { next }
    { print }
  ' "$f"
}

registry_has() {
  local target_raw="${1:-}"
  [ -n "$target_raw" ] || return 1
  local f
  f="$(registry_file)"
  [ -f "$f" ] || return 1
  local target_key
  target_key="$(_registry_norm_key "$(_registry_resolve "$target_raw")")"
  local line col1 key
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%$'\r'}"
    case "$line" in
      ""|\#*) continue ;;
    esac
    col1="${line%%$'\t'*}"
    key="$(_registry_norm_key "$col1")"
    if [ "$key" = "$target_key" ]; then
      return 0
    fi
  done < "$f"
  return 1
}

registry_add() {
  local target_raw="${1:-}"
  [ -n "$target_raw" ] || return 1
  local home f native target_key
  home="$(liz_home)"
  mkdir -p "$home" || return 1
  f="$home/projects.tsv"
  native="$(_registry_resolve "$target_raw")"
  [ -n "$native" ] || return 1
  target_key="$(_registry_norm_key "$native")"

  if [ -f "$f" ] && registry_has "$native"; then
    return 0
  fi

  local tmp
  tmp="$(mktemp "$home/projects.tsv.XXXXXX")" || return 1
  if [ -f "$f" ]; then
    if ! cat "$f" > "$tmp"; then
      rm -f "$tmp"
      return 1
    fi
  fi
  local now
  now="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  if ! printf '%s\t%s\n' "$native" "$now" >> "$tmp"; then
    rm -f "$tmp"
    return 1
  fi
  if ! mv "$tmp" "$f"; then
    rm -f "$tmp"
    return 1
  fi
  return 0
}

registry_remove() {
  local target_raw="${1:-}"
  [ -n "$target_raw" ] || return 1
  local home f target_key
  home="$(liz_home)"
  f="$home/projects.tsv"
  [ -f "$f" ] || return 1
  target_key="$(_registry_norm_key "$(_registry_resolve "$target_raw")")"

  local tmp removed=0 line col1 key
  tmp="$(mktemp "$home/projects.tsv.XXXXXX")" || return 1
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%$'\r'}"
    case "$line" in
      ""|\#*)
        printf '%s\n' "$line" >> "$tmp"
        continue
        ;;
    esac
    col1="${line%%$'\t'*}"
    key="$(_registry_norm_key "$col1")"
    if [ "$key" = "$target_key" ]; then
      removed=1
    else
      printf '%s\n' "$line" >> "$tmp"
    fi
  done < "$f"

  if [ "$removed" -eq 0 ]; then
    rm -f "$tmp"
    return 1
  fi
  if ! mv "$tmp" "$f"; then
    rm -f "$tmp"
    return 1
  fi
  return 0
}
