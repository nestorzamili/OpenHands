import os
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from webgen_migrations import (
    Migration,
    MigrationError,
    MigrationRunner,
    collect_project_migrations,
    migration_wrapper,
    validate_migration_sql,
)


class MigrationPolicyTests(unittest.TestCase):
    def make_project(self, root: Path, sql: str) -> Path:
        project = root / "webgen" / "isolated-test"
        migrations = project / "prisma" / "migrations" / "20261016000100_initial"
        migrations.mkdir(parents=True)
        (project / "prisma" / "schema.prisma").write_text(
            'datasource db { provider = "postgresql" url = env("DATABASE_URL") }\n'
        )
        (project / "prisma" / "migrations" / "migration_lock.toml").write_text(
            'provider = "postgresql"\n'
        )
        (migrations / "migration.sql").write_text(sql)
        return project

    def test_collects_standard_postgres_prisma_migrations_and_checksum(self):
        with tempfile.TemporaryDirectory() as directory:
            project = self.make_project(Path(directory), 'CREATE TABLE "probe" ("id" INTEGER PRIMARY KEY);\n')
            files = collect_project_migrations(project)
        self.assertEqual(len(files), 1)
        self.assertEqual(files[0].name, "20261016000100_initial")
        self.assertEqual(len(files[0].checksum), 64)
        self.assertEqual(files[0].steps, 1)

    def test_requires_postgresql_lock_and_a_migration_for_prisma_schema(self):
        with tempfile.TemporaryDirectory() as directory:
            project = self.make_project(Path(directory), 'CREATE TABLE "probe" ("id" INTEGER);')
            (project / "prisma" / "migrations" / "migration_lock.toml").write_text('provider = "mysql"\n')
            with self.assertRaises(MigrationError):
                collect_project_migrations(project)
        with tempfile.TemporaryDirectory() as directory:
            project = Path(directory) / "project"
            (project / "prisma").mkdir(parents=True)
            (project / "prisma" / "schema.prisma").write_text('datasource db { provider = "postgresql" }')
            with self.assertRaises(MigrationError):
                collect_project_migrations(project)

    def test_rejects_privilege_changes_procedural_sql_and_psql_commands(self):
        for sql in (
            'GRANT CREATE ON SCHEMA public TO dck_runtime_x;',
            'DO $$ BEGIN EXECUTE \'GRANT CREATE ON SCHEMA public TO x\'; END $$;',
            'CREATE FUNCTION public.bad() RETURNS void LANGUAGE sql AS \'SELECT 1\';',
            '\\connect another_database\nCREATE TABLE probe(id int);',
            'ALTER TABLE probe OWNER TO dck_runtime_x;',
            'CREATE INDEX CONCURRENTLY probe_idx ON probe(id);',
        ):
            with self.subTest(sql=sql), self.assertRaises(MigrationError):
                validate_migration_sql(sql)

    def test_rejects_migration_ledger_edits(self):
        with self.assertRaises(MigrationError):
            validate_migration_sql('DROP TABLE public."_prisma_migrations";')

    def test_rejects_backslash_ambiguous_string_statement_boundary(self):
        sql = (
            "CREATE TABLE \"safe\" (\"value\" TEXT DEFAULT 'prefix\\'); "
            "DROP TABLE \"protected\"; 'tail');"
        )
        with self.assertRaises(MigrationError):
            validate_migration_sql(sql)

    def test_allows_standard_sequence_default_but_rejects_arbitrary_functions(self):
        self.assertEqual(
            validate_migration_sql('CREATE TABLE probe (id BIGINT DEFAULT nextval(\'probe_id_seq\'));'),
            1,
        )
        with self.assertRaises(MigrationError):
            validate_migration_sql('CREATE INDEX probe_idx ON probe (public.hidden_privileged_function(id));')

    def test_rejects_symlinked_migration_sql(self):
        with tempfile.TemporaryDirectory() as directory:
            project = self.make_project(Path(directory), 'CREATE TABLE probe(id int);')
            migration_file = project / "prisma" / "migrations" / "20261016000100_initial" / "migration.sql"
            replacement = migration_file.with_suffix(".real")
            migration_file.rename(replacement)
            migration_file.symlink_to(replacement)
            with self.assertRaises(MigrationError):
                collect_project_migrations(project)


class MigrationRunnerTests(unittest.TestCase):
    def migration(self, sql='CREATE TABLE "probe" ("id" INTEGER PRIMARY KEY);'):
        checksum = "a" * 64
        return Migration("20261016000100_initial", sql.encode(), checksum, 1)

    def test_runner_passes_only_protected_env_file_and_read_only_sql_to_container(self):
        password = "m" * 64
        seen = {}

        def fake_run(command, **kwargs):
            if command[1] == "run":
                seen["command"] = command
                env_file = Path(command[command.index("--env-file") + 1])
                seen["env"] = env_file.read_text()
                seen["mode"] = env_file.stat().st_mode & 0o777
                migration_mount = next(item for item in command if "dst=/migration.sql" in item)
                wrapper_mount = next(item for item in command if "dst=/runner.sql" in item)
                seen["migration"] = Path(migration_mount.split("src=", 1)[1].split(",dst=", 1)[0]).read_text()
                seen["wrapper"] = Path(wrapper_mount.split("src=", 1)[1].split(",dst=", 1)[0]).read_text()
                return SimpleNamespace(returncode=0, stdout="", stderr="")
            return SimpleNamespace(returncode=0, stdout="", stderr="")

        with tempfile.TemporaryDirectory() as directory:
            runtime = Path(directory) / "run"
            runner = MigrationRunner(runtime, {"PATH": "/usr/bin", "HOME": "/root"}, run=fake_run)
            runner.apply("isolated-test", "dck_isolated-test", "dck_migrate_" + "b" * 32, password, [self.migration()])
            self.assertEqual(list(runtime.iterdir()), [])

        self.assertEqual(seen["mode"], 0o600)
        self.assertIn(f"PGPASSWORD={password}", seen["env"])
        command = seen["command"]
        self.assertIn("--network", command)
        self.assertEqual(command[command.index("--network") + 1], "dck")
        self.assertIn("--read-only", command)
        self.assertIn("--cap-drop=ALL", command)
        self.assertEqual(command[command.index("--user") + 1], "65534:65534")
        self.assertNotIn(password, " ".join(command))
        self.assertNotIn(password, seen["migration"])
        self.assertNotIn(password, seen["wrapper"])
        self.assertIn("_prisma_migrations", seen["wrapper"])
        self.assertIn("/migration.sql", seen["wrapper"])

    def test_runner_hides_database_error_details(self):
        password = "p" * 64

        def fake_run(command, **kwargs):
            if command[1] == "run":
                return SimpleNamespace(returncode=1, stdout="", stderr="bad SQL; " + password)
            return SimpleNamespace(returncode=0, stdout="", stderr="")

        with tempfile.TemporaryDirectory() as directory:
            runner = MigrationRunner(Path(directory) / "run", {"PATH": "/usr/bin"}, run=fake_run)
            with self.assertRaises(MigrationError) as caught:
                runner.apply("isolated-test", "dck_isolated-test", "dck_migrate_" + "b" * 32, password, [self.migration()])
        self.assertEqual(str(caught.exception), "database migration failed")
        self.assertNotIn(password, str(caught.exception))

    def test_wrapper_is_project_scoped_and_records_checksum_transactionally(self):
        migration = self.migration()
        sql = migration_wrapper(migration, "isolated-test", -12345)
        self.assertIn("BEGIN;", sql)
        self.assertIn("COMMIT;", sql)
        self.assertIn("pg_advisory_xact_lock(-12345)", sql)
        self.assertIn(migration.checksum, sql)
        self.assertIn(migration.name, sql)
        self.assertIn("\\if :webgen_apply", sql)
        self.assertNotIn("DROP DATABASE", sql)


if __name__ == "__main__":
    unittest.main()
