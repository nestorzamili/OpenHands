"""Trusted, SQL-only runner for per-project PostgreSQL migrations.

It reads Prisma migration files as data, never imports or executes project code,
and runs the SQL in a short-lived, read-only psql container with only the
project database's migration role.
"""
from __future__ import annotations

import hashlib
import os
import re
import secrets
import shutil
import stat
import subprocess
import tempfile
import tomllib
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Callable


MIGRATION_DIR_RE = re.compile(r"^[0-9]{14}_[A-Za-z0-9_-]{1,80}$")
MAX_MIGRATION_BYTES = 4 * 1024 * 1024
MAX_TOTAL_MIGRATION_BYTES = 16 * 1024 * 1024
MAX_MIGRATION_FILES = 256
RUNNER_IMAGE = "postgres:17-alpine"
INTERNAL_MIGRATION_TABLE = "_prisma_migrations"


class MigrationError(RuntimeError):
    """A safe, user-displayable migration failure without underlying details."""


@dataclass(frozen=True)
class Migration:
    name: str
    sql: bytes
    checksum: str
    steps: int


def _tokens_and_statements(sql: str) -> list[list[str]]:
    """Tokenize enough PostgreSQL syntax to validate statement classes.

    String literals, quoted identifiers, comments and dollar-quoted bodies are
    treated as opaque tokens, so SQL-like text in comments or strings is not
    interpreted as a command. Procedural SQL is rejected separately.
    """
    statements: list[list[str]] = []
    current: list[str] = []
    i = 0
    length = len(sql)
    while i < length:
        char = sql[i]
        if char.isspace():
            i += 1
            continue
        if sql.startswith("--", i):
            newline = sql.find("\n", i + 2)
            i = length if newline < 0 else newline + 1
            continue
        if sql.startswith("/*", i):
            depth = 1
            i += 2
            while i < length and depth:
                if sql.startswith("/*", i):
                    depth += 1
                    i += 2
                elif sql.startswith("*/", i):
                    depth -= 1
                    i += 2
                else:
                    i += 1
            if depth:
                raise MigrationError("invalid migration SQL")
            continue
        if char == "'":
            i += 1
            while i < length:
                if sql[i] == "'":
                    if i + 1 < length and sql[i + 1] == "'":
                        i += 2
                        continue
                    i += 1
                    break
                if sql[i] == "\\":
                    # Backslash semantics depend on PostgreSQL's
                    # standard_conforming_strings setting. Reject rather than
                    # risk disagreeing about a quote/statement boundary.
                    raise MigrationError("backslash escapes are not allowed in migration strings")
                i += 1
            else:
                raise MigrationError("invalid migration SQL")
            current.append("<STRING>")
            continue
        if char == '"':
            i += 1
            identifier = []
            while i < length:
                if sql[i] == '"':
                    if i + 1 < length and sql[i + 1] == '"':
                        identifier.append('"')
                        i += 2
                        continue
                    i += 1
                    break
                identifier.append(sql[i])
                i += 1
            else:
                raise MigrationError("invalid migration SQL")
            current.append("<IDENT:" + "".join(identifier).lower() + ">")
            continue
        if char == "$":
            match = re.match(r"\$[A-Za-z_][A-Za-z0-9_]*\$|\$\$", sql[i:])
            if match:
                delimiter = match.group(0)
                end = sql.find(delimiter, i + len(delimiter))
                if end < 0:
                    raise MigrationError("invalid migration SQL")
                i = end + len(delimiter)
                current.append("<DOLLAR_STRING>")
                continue
        if char == ";":
            if current:
                statements.append(current)
                current = []
            i += 1
            continue
        if char.isalpha() or char == "_":
            match = re.match(r"[A-Za-z_][A-Za-z0-9_$]*", sql[i:])
            assert match is not None
            current.append(match.group(0).upper())
            i += len(match.group(0))
            continue
        if char.isdigit():
            match = re.match(r"[0-9]+", sql[i:])
            assert match is not None
            current.append("<NUMBER>")
            i += len(match.group(0))
            continue
        current.append(char)
        i += 1
    if current:
        statements.append(current)
    return statements


def validate_migration_sql(sql: str) -> int:
    """Permit ordinary Prisma schema DDL only; reject control/privilege SQL."""
    if not sql.strip() or "\x00" in sql:
        raise MigrationError("empty or invalid migration SQL")
    if any(re.match(r"^\s*\\", line) for line in sql.splitlines()):
        raise MigrationError("psql directives are not allowed in migrations")
    statements = _tokens_and_statements(sql)
    forbidden = {
        "GRANT", "REVOKE", "ROLE", "DATABASE", "TABLESPACE", "SECURITY",
        "DEFINER", "TRIGGER", "FUNCTION", "PROCEDURE", "RULE", "POLICY",
        "EXTENSION", "EXECUTE", "COPY", "PROGRAM", "REASSIGN", "OWNED",
        "AUTHORIZATION", "CONCURRENTLY", "DBLINK", "DBLINK_CONNECT",
        "DBLINK_EXEC", "PG_READ_FILE", "PG_READ_BINARY_FILE", "PG_LS_DIR",
        "PG_STAT_FILE", "LO_IMPORT", "LO_EXPORT",
    }
    safe_functions = {
        "NEXTVAL", "CURRVAL", "GEN_RANDOM_UUID", "UUID_GENERATE_V4", "NOW",
        "TRANSACTION_TIMESTAMP", "STATEMENT_TIMESTAMP", "CURRENT_TIMESTAMP",
        "LOWER", "UPPER", "LENGTH", "CHAR_LENGTH", "BTRIM", "LTRIM", "RTRIM",
        "SUBSTRING", "ABS", "ROUND", "CEIL", "CEILING", "FLOOR", "DATE_TRUNC",
        "COALESCE", "NULLIF",
    }
    syntax_parentheses = {
        "TABLE", "INDEX", "SEQUENCE", "TYPE", "VARCHAR", "CHAR", "CHARACTER",
        "NUMERIC", "DECIMAL", "BIT", "VARBIT", "TIMESTAMP", "TIMESTAMPTZ",
        "TIME", "TIMETZ", "INTERVAL", "DOUBLE", "REAL", "FLOAT", "INTEGER",
        "INT", "SMALLINT", "BIGINT", "BOOLEAN", "UUID", "JSON", "JSONB",
        "VECTOR", "KEY", "CHECK", "UNIQUE", "PRIMARY", "IN", "AS", "ENUM",
        "CAST", "DEFAULT", "USING", "BTREE", "HASH", "GIST", "GIN", "SPGIST", "BRIN",
    }
    for tokens in statements:
        if not tokens:
            continue
        if any(token in forbidden for token in tokens):
            raise MigrationError("migration uses a forbidden database operation")
        if any(token in {f"<IDENT:{INTERNAL_MIGRATION_TABLE}>", INTERNAL_MIGRATION_TABLE.upper()} for token in tokens):
            raise MigrationError("migration references the protected migration ledger")
        if tokens[0] == "CREATE":
            prefix = tokens[1:4]
            if prefix[:1] == ["UNIQUE"]:
                valid = prefix[1:2] == ["INDEX"]
            elif prefix[:2] == ["MATERIALIZED", "VIEW"]:
                valid = False
            else:
                valid = bool(prefix) and prefix[0] in {"TABLE", "TYPE", "SEQUENCE", "INDEX"}
            if not valid:
                raise MigrationError("unsupported CREATE statement in migration")
            if "AS" in tokens and "SELECT" in tokens and tokens.index("AS") < tokens.index("SELECT"):
                raise MigrationError("CREATE TABLE AS SELECT is not allowed")
        elif tokens[0] == "ALTER":
            if len(tokens) < 2 or tokens[1] not in {"TABLE", "TYPE", "SEQUENCE", "INDEX"}:
                raise MigrationError("unsupported ALTER statement in migration")
            for pair in (("OWNER", "TO"), ("SET", "SCHEMA"), ("SET", "TABLESPACE")):
                if any(tokens[i:i + 2] == list(pair) for i in range(len(tokens) - 1)):
                    raise MigrationError("migration cannot change ownership or object scope")
        elif tokens[0] == "DROP":
            if len(tokens) < 2 or tokens[1] not in {"TABLE", "TYPE", "SEQUENCE", "INDEX", "VIEW"}:
                raise MigrationError("unsupported DROP statement in migration")
        elif tokens[0] == "COMMENT":
            if len(tokens) < 3 or tokens[1] != "ON" or tokens[2] not in {"TABLE", "COLUMN", "TYPE", "INDEX", "SEQUENCE"}:
                raise MigrationError("unsupported COMMENT statement in migration")
        else:
            raise MigrationError("unsupported statement in migration")
        for i, token in enumerate(tokens[:-1]):
            if tokens[i + 1] != "(":
                continue
            if token in safe_functions or token in syntax_parentheses:
                continue
            # Only the immediate table target before a column/index list is
            # exempted; arbitrary identifiers elsewhere remain function calls.
            object_target = False
            if tokens[0] == "CREATE" and len(tokens) > 1 and tokens[1] == "TABLE":
                target = 2
                if tokens[target:target + 3] == ["IF", "NOT", "EXISTS"]:
                    target += 3
                if target + 1 < len(tokens) and tokens[target + 1] == ".":
                    target += 2
                object_target = i == target
            if tokens[0] == "CREATE" and "ON" in tokens:
                on_index = tokens.index("ON")
                target = on_index + 1
                if target + 1 < len(tokens) and tokens[target + 1] == ".":
                    target += 2
                object_target = object_target or i == target
            if "REFERENCES" in tokens:
                references_index = tokens.index("REFERENCES")
                target = references_index + 1
                if target + 1 < len(tokens) and tokens[target + 1] == ".":
                    target += 2
                object_target = object_target or i == target
            if object_target:
                continue
            if token.startswith("<IDENT:") or re.fullmatch(r"[A-Z_][A-Z0-9_$]*", token):
                raise MigrationError("migration uses a function outside the safe allowlist")
    if not statements:
        raise MigrationError("empty migration SQL")
    return len(statements)


def _open_dir(parent_fd: int, name: str) -> int:
    return os.open(name, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0), dir_fd=parent_fd)


def _read_file_at(directory_fd: int, name: str, max_bytes: int) -> bytes:
    fd = os.open(name, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0), dir_fd=directory_fd)
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_size > max_bytes:
            raise MigrationError("invalid migration file")
        chunks = []
        remaining = max_bytes + 1
        while remaining:
            chunk = os.read(fd, min(65536, remaining))
            if not chunk:
                break
            chunks.append(chunk)
            remaining -= len(chunk)
        content = b"".join(chunks)
        if len(content) > max_bytes:
            raise MigrationError("migration file is too large")
        return content
    finally:
        os.close(fd)


def collect_project_migrations(project_dir: Path) -> list[Migration]:
    """Read only standard Prisma migration files through no-follow file handles."""
    project_dir = Path(project_dir)
    try:
        project_fd = os.open(project_dir, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0))
    except FileNotFoundError:
        return []
    except OSError as error:
        raise MigrationError("invalid project migration directory") from error
    prisma_fd = migrations_fd = None
    try:
        try:
            prisma_fd = _open_dir(project_fd, "prisma")
        except FileNotFoundError:
            return []
        schema = None
        try:
            schema = _read_file_at(prisma_fd, "schema.prisma", MAX_MIGRATION_BYTES)
        except FileNotFoundError:
            return []
        except OSError as error:
            raise MigrationError("invalid Prisma schema") from error
        if not schema or b"\x00" in schema:
            raise MigrationError("invalid Prisma schema")
        try:
            migrations_fd = _open_dir(prisma_fd, "migrations")
        except FileNotFoundError as error:
            raise MigrationError("Prisma migrations directory is required") from error
        except OSError as error:
            raise MigrationError("invalid Prisma migrations directory") from error
        try:
            lock_bytes = _read_file_at(migrations_fd, "migration_lock.toml", 4096)
            lock = tomllib.loads(lock_bytes.decode("utf-8"))
        except (FileNotFoundError, UnicodeError, tomllib.TOMLDecodeError, OSError) as error:
            raise MigrationError("invalid Prisma migration lock") from error
        if lock.get("provider") != "postgresql":
            raise MigrationError("only PostgreSQL Prisma migrations are supported")
        entries = os.listdir(migrations_fd)
        names = [name for name in entries if name != "migration_lock.toml"]
        if len(names) > MAX_MIGRATION_FILES:
            raise MigrationError("too many project migrations")
        if any(not MIGRATION_DIR_RE.fullmatch(name) for name in names):
            raise MigrationError("invalid Prisma migration name")
        migrations: list[Migration] = []
        total = 0
        for name in sorted(names):
            try:
                migration_fd = _open_dir(migrations_fd, name)
            except OSError as error:
                raise MigrationError("invalid Prisma migration directory") from error
            try:
                if set(os.listdir(migration_fd)) != {"migration.sql"}:
                    raise MigrationError("invalid Prisma migration directory contents")
                content = _read_file_at(migration_fd, "migration.sql", MAX_MIGRATION_BYTES)
            except OSError as error:
                raise MigrationError("invalid Prisma migration file") from error
            finally:
                os.close(migration_fd)
            try:
                decoded = content.decode("utf-8")
            except UnicodeError as error:
                raise MigrationError("migration SQL must be UTF-8") from error
            if b"\x00" in content:
                raise MigrationError("invalid migration SQL")
            steps = validate_migration_sql(decoded)
            total += len(content)
            if total > MAX_TOTAL_MIGRATION_BYTES:
                raise MigrationError("project migrations are too large")
            migrations.append(Migration(name, content, hashlib.sha256(content).hexdigest(), steps))
        if not migrations:
            raise MigrationError("Prisma schema has no migrations")
        return migrations
    finally:
        if migrations_fd is not None:
            os.close(migrations_fd)
        if prisma_fd is not None:
            os.close(prisma_fd)
        os.close(project_fd)


def _sql_literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def migration_wrapper(migration: Migration, project_slug: str, advisory_key: int) -> str:
    migration_id = str(uuid.uuid4())
    name = _sql_literal(migration.name)
    checksum = _sql_literal(migration.checksum)
    row_id = _sql_literal(migration_id)
    return f"""\\set ON_ERROR_STOP on
BEGIN;
SELECT pg_advisory_xact_lock({advisory_key});
CREATE TABLE IF NOT EXISTS public.{INTERNAL_MIGRATION_TABLE} (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  checksum VARCHAR(64) NOT NULL,
  finished_at TIMESTAMPTZ,
  migration_name VARCHAR(255) NOT NULL,
  logs TEXT,
  rolled_back_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  applied_steps_count INTEGER NOT NULL DEFAULT 0
);
DO $webgen$
DECLARE item record;
BEGIN
  SELECT count(*) AS row_count, min(checksum) AS saved_checksum,
         bool_and(finished_at IS NOT NULL AND rolled_back_at IS NULL) AS complete
    INTO item FROM public.{INTERNAL_MIGRATION_TABLE} WHERE migration_name={name};
  IF item.row_count > 1 THEN RAISE EXCEPTION 'duplicate migration history'; END IF;
  IF item.row_count = 1 AND (item.saved_checksum <> {checksum} OR item.complete IS DISTINCT FROM TRUE) THEN
    RAISE EXCEPTION 'migration history mismatch';
  END IF;
END
$webgen$;
SELECT NOT EXISTS (
  SELECT 1 FROM public.{INTERNAL_MIGRATION_TABLE}
  WHERE migration_name={name} AND checksum={checksum}
    AND finished_at IS NOT NULL AND rolled_back_at IS NULL
) AS webgen_apply \\gset
\\if :webgen_apply
INSERT INTO public.{INTERNAL_MIGRATION_TABLE}
  (id, checksum, started_at, migration_name, applied_steps_count)
VALUES ({row_id}, {checksum}, now(), {name}, 0);
\\i /migration.sql
UPDATE public.{INTERNAL_MIGRATION_TABLE}
SET finished_at=now(), applied_steps_count={migration.steps}
WHERE id={row_id};
\\endif
COMMIT;
"""


class MigrationRunner:
    """Runs each migration in a short-lived, least-privilege psql container."""

    def __init__(
        self,
        runtime_dir: Path,
        docker_environment: dict[str, str],
        run: Callable = subprocess.run,
        image: str = RUNNER_IMAGE,
    ) -> None:
        self.runtime_dir = Path(runtime_dir)
        self.docker_environment = dict(docker_environment)
        self.run = run
        self.image = image

    def _environment_file(self, directory: Path, database: str, role: str, password: str) -> Path:
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,63}", database) or not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_-]{0,62}", role):
            raise MigrationError("invalid migration target")
        if not isinstance(password, str) or not re.fullmatch(r"[A-Za-z0-9_-]{32,128}", password):
            raise MigrationError("invalid migration credentials")
        target = directory / "connection.env"
        fd = os.open(target, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        try:
            with os.fdopen(fd, "w", encoding="ascii") as output:
                output.write(f"PGHOST=postgres\nPGPORT=5432\nPGUSER={role}\nPGDATABASE={database}\nPGPASSWORD={password}\nPGSSLMODE=disable\n")
                output.flush()
                os.fsync(output.fileno())
        except BaseException:
            target.unlink(missing_ok=True)
            raise
        return target

    def _run_one(self, slug: str, database: str, role: str, password: str, migration: Migration) -> None:
        if not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", slug):
            raise MigrationError("invalid migration project")
        try:
            self.runtime_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
            if self.runtime_dir.is_symlink():
                raise MigrationError("invalid migration runtime directory")
            os.chmod(self.runtime_dir, 0o700)
            info = self.runtime_dir.stat()
            if info.st_uid != os.geteuid() or info.st_mode & 0o077:
                raise MigrationError("invalid migration runtime directory")
            work = Path(tempfile.mkdtemp(prefix="webgen-migration-", dir=self.runtime_dir))
            os.chmod(work, 0o700)
        except OSError as error:
            raise MigrationError("migration runner unavailable") from error
        container_name = "webgen-migrate-" + uuid.uuid4().hex
        env_file = None
        try:
            migration_file = work / "migration.sql"
            wrapper_file = work / "runner.sql"
            for path, content in (
                (migration_file, migration.sql),
                (wrapper_file, migration_wrapper(migration, slug, int.from_bytes(hashlib.sha256(slug.encode("ascii")).digest()[:8], "big", signed=True)).encode("utf-8")),
            ):
                fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o444)
                with os.fdopen(fd, "wb") as output:
                    output.write(content)
                    output.flush()
                    os.fsync(output.fileno())
                os.chmod(path, 0o444)
            env_file = self._environment_file(work, database, role, password)
            command = [
                "docker", "run", "--rm", "--pull=never", "--name", container_name,
                "--label", "com.dck.webgen.migration=" + slug,
                "--network", "dck", "--read-only", "--cap-drop=ALL",
                "--security-opt=no-new-privileges", "--pids-limit=32", "--memory=256m",
                "--tmpfs", "/tmp:rw,noexec,nosuid,nodev,size=16m", "--user", "65534:65534",
                "--env-file", str(env_file),
                "--mount", f"type=bind,src={migration_file},dst=/migration.sql,readonly",
                "--mount", f"type=bind,src={wrapper_file},dst=/runner.sql,readonly",
                "--entrypoint", "psql", self.image,
                "-X", "-q", "-v", "ON_ERROR_STOP=1", "-f", "/runner.sql",
            ]
            result = self.run(
                command,
                capture_output=True,
                text=True,
                timeout=330,
                check=False,
                env=self.docker_environment,
            )
            if result.returncode:
                raise MigrationError("database migration failed")
        except subprocess.TimeoutExpired as error:
            raise MigrationError("database migration timed out") from error
        except OSError as error:
            raise MigrationError("migration runner unavailable") from error
        finally:
            # If the client times out, remove only the uniquely named runner
            # container created by this invocation. `docker rm -f` is harmless
            # when `--rm` already removed it.
            try:
                self.run(
                    ["docker", "rm", "-f", container_name],
                    capture_output=True,
                    text=True,
                    timeout=10,
                    check=False,
                    env=self.docker_environment,
                )
            except Exception:
                pass
            shutil.rmtree(work, ignore_errors=True)

    def apply(self, slug: str, database: str, role: str, password: str, migrations: list[Migration]) -> None:
        for migration in migrations:
            self._run_one(slug, database, role, password, migration)
