#!/usr/bin/env bash
set -uo pipefail

CONTAINER="${CONTAINER:-dck-agentic-canvas}"

if [ -z "${AUTOMATION_DB_URL:-}" ]; then
  echo "AUTOMATION_DB_URL is not set." >&2
  exit 1
fi

SYNC_URL="${AUTOMATION_DB_URL/postgresql+asyncpg:\/\//postgresql+pg8000://}"

docker exec "$CONTAINER" pip install -q "pg8000==1.31.5"

AUTOMATION_DB_URL="$SYNC_URL" docker exec -i -e AUTOMATION_DB_URL="$SYNC_URL" "$CONTAINER" python - <<'PYEOF'
import os
from pathlib import Path
from alembic import command
from alembic.config import Config
import openhands.automation.app as appmod

migrations_path = Path(appmod.__file__).parent / "migrations"
cfg = Config()
cfg.set_main_option("script_location", str(migrations_path))
cfg.set_main_option("sqlalchemy.url", os.environ["AUTOMATION_DB_URL"])
command.upgrade(cfg, "head")
print("MIGRATION_OK")
PYEOF
