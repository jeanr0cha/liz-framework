#!/usr/bin/env bash
# =============================================================================
# painel/teste-seguranca.sh — verifica os requisitos S1–S15 do painel local.
#
# Sobe o servidor com LIZ_NO_OPEN=1, usa LIZ_HOME e projetos temporários e
# apaga tudo ao encerrar. Sai com código 0 se tudo passar, ou 1 se algo falhar.
# =============================================================================
set -euo pipefail

FW="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
SERVER_PID=""
FAILS=0

cleanup() {
  if [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

pass() { printf 'OK     %s\n' "$*"; }
fail() { printf 'FALHOU %s\n' "$*" >&2; FAILS=$((FAILS + 1)); }

check_status() {
  local label="$1" expected="$2" got="$3"
  if [ "$got" = "$expected" ]; then pass "$label (HTTP $got)"; else fail "$label (esperava HTTP $expected, veio $got)"; fi
}

# --- Preparar projeto e registro temporários ---------------------------------
export LIZ_HOME="$TMP_DIR/liz-home"
PROJ="$TMP_DIR/meu-projeto"
OUTSIDE="$TMP_DIR/fora.md"
mkdir -p "$LIZ_HOME" "$PROJ/.agents" "$PROJ/docs/specs" "$PROJ/docs/technical-context"
printf 'framework: liz-framework\nversion: 0.2.0\ntools: claude\n' > "$PROJ/.agents/.liz-version"
printf '# Projeto Teste\n\nTexto normal.\n' > "$PROJ/AGENTS.md"
printf '# Spec\n\n<script>alert(1)</script>\n' > "$PROJ/docs/specs/spec.md"
printf 'SEGREDO=123\n' > "$PROJ/.env"
printf '# Fora\n' > "$OUTSIDE"

if command -v cygpath >/dev/null 2>&1; then
  PROJ_NATIVE="$(cygpath -m "$PROJ")"
  FW_NATIVE="$(cygpath -m "$FW")"
else
  PROJ_NATIVE="$PROJ"
  FW_NATIVE="$FW"
fi
printf '%s\t2026-01-01T00:00:00Z\n' "$PROJ_NATIVE" > "$LIZ_HOME/projects.tsv"

# --- Subir servidor em modo headless -----------------------------------------
OUT_LOG="$TMP_DIR/server.out"
LIZ_NO_OPEN=1 LIZ_PORT=0 LIZ_IDLE_MS=4000 LIZ_STARTUP_GRACE_MS=30000 \
  node "$FW/painel/server.js" > "$OUT_LOG" 2>&1 &
SERVER_PID=$!

URL=""
for _ in $(seq 1 40); do
  if [ -s "$OUT_LOG" ]; then
    URL="$(awk '/^URL: / { print $2; exit }' "$OUT_LOG" | tr -d '\r\n')"
    [ -n "$URL" ] && break
  fi
  sleep 0.25
done
[ -n "$URL" ] || { fail "Servidor não imprimiu URL"; cat "$OUT_LOG" >&2; exit 1; }

BASE="${URL%%\?*}"
BASE="${BASE%/}"
TOKEN="${URL#*?t=}"
HOST_PORT="${BASE#http://}"

# S1: bind somente em 127.0.0.1
case "$BASE" in
  http://127.0.0.1:*) pass "S1 servidor escuta em 127.0.0.1 ($HOST_PORT)" ;;
  *) fail "S1 endereço inesperado: $BASE" ;;
esac

# S2: token obrigatório na página e na API
check_status "S2 GET / sem token" 401 "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/")"
check_status "S2 GET / com token errado" 401 "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/?t=errado")"
check_status "S2 GET / com token válido" 200 "$(curl -s -o /dev/null -w '%{http_code}' "$URL")"
check_status "S2 GET /api/state sem header" 401 "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/state")"
check_status "S2 GET /api/state token errado" 401 "$(curl -s -o /dev/null -w '%{http_code}' -H 'X-Liz-Token: errado' "$BASE/api/state")"

# S3: validação de Host (anti DNS rebinding)
check_status "S3 Host inválido" 403 "$(curl -s -o /dev/null -w '%{http_code}' -H 'Host: evil.com' -H "X-Liz-Token: $TOKEN" "$BASE/api/state")"

# S4: Origin e Content-Type obrigatórios em POST
check_status "S4 POST sem Origin" 403 "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H "X-Liz-Token: $TOKEN" -H 'Content-Type: application/json' -d '{}' "$BASE/api/ping")"
check_status "S4 POST Origin inválido" 403 "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Origin: http://evil.com' -H "X-Liz-Token: $TOKEN" -H 'Content-Type: application/json' -d '{}' "$BASE/api/ping")"
check_status "S4 POST Content-Type inválido" 400 "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H "Origin: $BASE" -H "X-Liz-Token: $TOKEN" -H 'Content-Type: text/plain' -d '{}' "$BASE/api/ping")"
check_status "S4 POST ping válido" 200 "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H "Origin: $BASE" -H "X-Liz-Token: $TOKEN" -H 'Content-Type: application/json' -d '{}' "$BASE/api/ping")"

# S5: sem CORS e OPTIONS retorna 405
HDRS="$(curl -s -D - -o /dev/null "$URL")"
if printf '%s' "$HDRS" | grep -qi '^Access-Control-Allow-'; then
  fail "S5 cabeçalho CORS encontrado"
else
  pass "S5 sem cabeçalhos Access-Control-Allow-*"
fi
check_status "S5 OPTIONS retorna 405" 405 "$(curl -s -o /dev/null -w '%{http_code}' -X OPTIONS "$BASE/api/state")"

# S7: validação de caminhos (não registrado / próprio framework / começando com -)
check_status "S7 update projeto não registrado" 403 "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H "Origin: $BASE" -H "X-Liz-Token: $TOKEN" -H 'Content-Type: application/json' -d '{"path":"/nao/existe"}' "$BASE/api/update")"
check_status "S7 install na pasta do framework" 400 "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H "Origin: $BASE" -H "X-Liz-Token: $TOKEN" -H 'Content-Type: application/json' -d "{\"folder\":\"$FW_NATIVE\"}" "$BASE/api/install")"
check_status "S7 scan com flag (-rf)" 400 "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H "Origin: $BASE" -H "X-Liz-Token: $TOKEN" -H 'Content-Type: application/json' -d '{"folder":"-rf"}' "$BASE/api/scan")"

# S8 & S13: leitura de docs restrita (.md permitido, ../ e .env bloqueados)
ENC_PROJ="$(node -e "console.log(encodeURIComponent(process.argv[1]))" "$PROJ_NATIVE")"
check_status "S8 GET /api/doc AGENTS.md válido" 200 "$(curl -s -o /dev/null -w '%{http_code}' -H "X-Liz-Token: $TOKEN" "$BASE/api/doc?path=$ENC_PROJ&file=AGENTS.md")"
check_status "S8 GET /api/doc docs/specs/spec.md válido" 200 "$(curl -s -o /dev/null -w '%{http_code}' -H "X-Liz-Token: $TOKEN" "$BASE/api/doc?path=$ENC_PROJ&file=docs/specs/spec.md")"
check_status "S8 GET /api/doc traversal ../.env" 403 "$(curl -s -o /dev/null -w '%{http_code}' -H "X-Liz-Token: $TOKEN" "$BASE/api/doc?path=$ENC_PROJ&file=../../.env")"
check_status "S8 GET /api/doc .env direto" 403 "$(curl -s -o /dev/null -w '%{http_code}' -H "X-Liz-Token: $TOKEN" "$BASE/api/doc?path=$ENC_PROJ&file=.env")"
check_status "S8 GET /api/doc traversal ../fora.md" 403 "$(curl -s -o /dev/null -w '%{http_code}' -H "X-Liz-Token: $TOKEN" "$BASE/api/doc?path=$ENC_PROJ&file=../fora.md")"

# S9: verificação estática de funções perigosas
if grep -rn -E "shell:[[:space:]]*true|execSync|exec\(|eval\(|new Function|innerHTML" "$FW/painel/server.js" "$FW/painel/public/app.js"; then
  fail "S9 uso proibido encontrado em painel/"
else
  pass "S9 sem shell:true, exec, eval, new Function ou innerHTML"
fi

# S10: CSP e cabeçalhos de segurança no HTML
if printf '%s' "$HDRS" | grep -qi "^Content-Security-Policy:.*default-src 'none'" &&
   printf '%s' "$HDRS" | grep -qi "^X-Content-Type-Options: nosniff" &&
   printf '%s' "$HDRS" | grep -qi "^Referrer-Policy: no-referrer" &&
   printf '%s' "$HDRS" | grep -qi "^Cache-Control: no-store"; then
  pass "S10 CSP e cabeçalhos de segurança presentes"
else
  fail "S10 faltam cabeçalhos de segurança na resposta HTML"
fi

# S12: limite de corpo POST (16 KB) e JSON inválido
check_status "S12 POST JSON inválido" 400 "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H "Origin: $BASE" -H "X-Liz-Token: $TOKEN" -H 'Content-Type: application/json' -d '{invalido' "$BASE/api/ping")"
BIG_BODY="$TMP_DIR/big.json"
node -e "process.stdout.write('{\"x\":\"' + 'a'.repeat(20000) + '\"}')" > "$BIG_BODY"
check_status "S12 POST corpo > 16 KB" 413 "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H "Origin: $BASE" -H "X-Liz-Token: $TOKEN" -H 'Content-Type: application/json' --data-binary "@$BIG_BODY" "$BASE/api/ping")"

# S15: instância única (segunda instância sai com código 0 avisando)
DUP_OUT="$(LIZ_NO_OPEN=1 node "$FW/painel/server.js" 2>&1 || true)"
if printf '%s' "$DUP_OUT" | grep -qi "já está aberto"; then
  pass "S15 instância única bloqueou segundo servidor"
else
  fail "S15 instância única não detectou servidor ativo ($DUP_OUT)"
fi

# S15: encerramento automático após parar pings (LIZ_IDLE_MS=4000)
sleep 6
if kill -0 "$SERVER_PID" 2>/dev/null; then
  fail "S15 servidor não encerrou após ficar sem ping"
else
  pass "S15 servidor encerrou sozinho após falta de ping"
  SERVER_PID=""
fi

printf '\n'
if [ "$FAILS" -gt 0 ]; then
  printf '❌ %d verificação(ões) falharam.\n' "$FAILS" >&2
  exit 1
fi
printf '✅ Todas as verificações de segurança passaram.\n'
