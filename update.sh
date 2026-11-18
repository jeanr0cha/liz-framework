#!/usr/bin/env bash
# update.sh — atualiza o Liz Framework num projeto já instalado.
# Uso: bash ../liz-framework/update.sh [destino] [--pull] [--tools ...] [--dry-run]
#   --pull  baixa a versão mais nova do liz-framework (git pull) antes de atualizar
set -euo pipefail
FW="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ARGS=()
for a in "$@"; do
  if [ "$a" = "--pull" ]; then
    echo "⬇️  Atualizando o liz-framework (git pull)..."
    git -C "$FW" pull --ff-only
  else
    ARGS+=("$a")
  fi
done
exec bash "$FW/install.sh" ${ARGS[@]+"${ARGS[@]}"} --update
