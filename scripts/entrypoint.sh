#!/usr/bin/env sh
set -eu

# Ensure database directory exists when using SQLite (DATABASE_URL starts with file:)
if [ -n "${DATABASE_URL:-}" ] && echo "$DATABASE_URL" | grep -qE '^file:'; then
  # Strip leading 'file:'
  DB_PATH=${DATABASE_URL#file:}
  # If path is not absolute, make it relative to current working dir
  case "$DB_PATH" in
    /*) : ;; # absolute
    *) DB_PATH="$(pwd)/$DB_PATH" ;;
  esac
  DB_DIR=$(dirname "$DB_PATH")
  mkdir -p "$DB_DIR"
fi

# Generate Prisma client for the runtime env (no-op if already present)
if command -v npx >/dev/null 2>&1; then
  echo "Generating Prisma client..."
  npx prisma generate --schema=./prisma/schema.prisma >/dev/null 2>&1 || true
fi

echo "Applying Prisma migrations (deploy)..."
npx prisma migrate deploy --schema=./prisma/schema.prisma

# Optional: print current DB status (best-effort)
npx prisma migrate status --schema=./prisma/schema.prisma || true

exec "$@"
