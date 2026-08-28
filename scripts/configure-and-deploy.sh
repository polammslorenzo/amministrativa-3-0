#!/bin/sh
set -eu

if [ "$#" -ne 2 ]; then
  echo "Uso: ./scripts/configure-and-deploy.sh PROJECT_REF https://NOMEUTENTE.github.io" >&2
  exit 1
fi

PROJECT_REF="$1"
GITHUB_ORIGIN="${2%/}"
ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
ENV_FILE="${ADMIN3_ENV_FILE:-$ROOT_DIR/.env.local}"
SUPABASE_CLI_VERSION="${SUPABASE_CLI_VERSION:-2.81.3}"

case "$PROJECT_REF" in
  *[!a-z0-9]*|'') echo "PROJECT_REF non valido." >&2; exit 1 ;;
esac

case "$GITHUB_ORIGIN" in
  https://*.github.io) ;;
  *) echo "Indica la sola origine GitHub Pages, per esempio https://nomeutente.github.io" >&2; exit 1 ;;
esac

if [ ! -f "$ENV_FILE" ]; then
  echo "Manca il file locale delle credenziali: $ENV_FILE" >&2
  echo "Copia .env.example in .env.local oppure indica il percorso con ADMIN3_ENV_FILE." >&2
  exit 1
fi

OPENAI_KEY=$(awk -F= '/^[[:space:]]*OPENAI_API_KEY[[:space:]]*=/{sub(/^[^=]*=/,""); gsub(/^[[:space:]]+|[[:space:]]+$/,""); print; exit}' "$ENV_FILE")
if [ -z "$OPENAI_KEY" ]; then
  echo "OPENAI_API_KEY non è valorizzata in .env.local." >&2
  exit 1
fi

SECRET_FILE=$(mktemp "${TMPDIR:-/tmp}/admin3-secrets.XXXXXX")
trap 'rm -f "$SECRET_FILE"' EXIT HUP INT TERM
chmod 600 "$SECRET_FILE"
{
  printf 'OPENAI_API_KEY=%s\n' "$OPENAI_KEY"
  printf 'OPENAI_MODEL=gpt-5-mini\n'
  printf 'ALLOWED_ORIGINS=%s\n' "$GITHUB_ORIGIN"
} > "$SECRET_FILE"

cd "$ROOT_DIR"
npx --yes "supabase@$SUPABASE_CLI_VERSION" link --project-ref "$PROJECT_REF"
npx --yes "supabase@$SUPABASE_CLI_VERSION" secrets set --env-file "$SECRET_FILE"
npx --yes "supabase@$SUPABASE_CLI_VERSION" functions deploy agent --no-verify-jwt
node scripts/set-config.mjs "$PROJECT_REF"

echo "Deploy completato. Ora pubblica o aggiorna il repository GitHub Pages."
