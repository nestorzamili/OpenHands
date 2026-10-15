import json
import os
import shutil
import socket
import subprocess
import tempfile
import threading
import unittest
import uuid
from contextlib import nullcontext
from pathlib import Path
from unittest.mock import patch
import sys
import yaml

sys.path.insert(0, str(Path(__file__).parents[1]))
from webgen_control import *  # noqa: F403,E402


class _Response:
    def __init__(self, body):
        self.body = body
        self.status = 200

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return None

    def read(self, size=-1):
        return self.body if size < 0 else self.body[:size]


def _handler_call(service, method, path, body=None, authenticated=True, actual_auth=False):
    from types import SimpleNamespace
    handler = Handler.__new__(Handler)
    handler.path = path
    handler.headers = {"X-Session-API-Key": "session-key"}
    handler.server = SimpleNamespace(service=service)
    if not actual_auth:
        handler.auth = lambda: authenticated
    handler.body = lambda: body or {}
    replies = []
    handler.send = lambda status, payload: replies.append((status, payload))
    getattr(handler, method)()
    return replies


class TestWebgen(unittest.TestCase):
    # @spec WR-019 — Runtime status tolerates containers without healthchecks.
    def test_runtime_status_handles_optional_health_and_failed_containers(self):
        from subprocess import CompletedProcess

        containers = [
            ("a" * 12, "shop", "running", {"ExitCode": 0, "Health": {"Status": "healthy"}}),
            ("b" * 12, "worker", "running", {"ExitCode": 0}),
            ("c" * 12, "failed", "exited", {"ExitCode": 1}),
        ]
        listing = "\n".join(json.dumps({
            "ID": cid, "Names": f"{slug}-app", "State": state,
            "Status": "Up" if state == "running" else "Exited (1)",
            "Labels": f"com.docker.compose.project={slug}",
        }) for cid, slug, state, _ in containers)
        inspection = "\n".join(f"{cid}|{json.dumps(state)}" for cid, _, _, state in containers)
        service = self.make_service()
        with tempfile.TemporaryDirectory() as d:
            service.root = Path(d)
            for _, slug, _, _ in containers:
                project = service.root / slug
                project.mkdir()
                (project / ".dck.json").write_text(json.dumps({"port": 3000}))
            with patch("webgen_control.subprocess.run", side_effect=[
                CompletedProcess([], 0, stdout=listing),
                CompletedProcess([], 0, stdout=inspection),
            ]):
                projects = {p["slug"]: p for p in service.projects()}

        self.assertEqual(projects["shop"]["status"], "running")
        self.assertEqual(projects["shop"]["containers"][0]["health"], "healthy")
        self.assertEqual(projects["worker"]["status"], "running")
        self.assertIsNone(projects["worker"]["containers"][0]["health"])
        self.assertEqual(projects["failed"]["status"], "error")

    def test_runtime_reports_starting_and_only_the_active_address(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d)
            (p / ".dck.json").write_text(json.dumps({
                "port": 3000, "previewPath": "/preview/shop",
                "subdomain": "shop.dckautoposting.com",
            }))
            service = self.make_service()
            project = service.project("shop", p, {"shop": [{
                "id": "c", "name": "shop-app", "state": "running", "health": "starting", "exit_code": None,
            }]})
            self.assertEqual(project["status"], "starting")
            self.assertIsNone(project["preview_path"])
            self.assertEqual(project["subdomain"], "shop.dckautoposting.com")

    def setUp(self):
        if not hasattr(os, "chown"):
            ownership = patch("webgen_control.os.chown", create=True)
            ownership.start()
            self.addCleanup(ownership.stop)

    def test_seed_authorization_http_response_is_recoverable(self):
        from types import SimpleNamespace
        handler = Handler.__new__(Handler)
        handler.path = "/api/webgen-provisioning/projects/shop/conversations/c/authorize-deploy"
        handler.auth = lambda: True
        handler.body = lambda: {}
        with tempfile.TemporaryDirectory() as d:
            service = self.make_service()
            service.seed = SeedStore(master_path=Path(d) / "key")
            service.owner_state = lambda _: "unreachable"
            handler.server = SimpleNamespace(service=service)
            replies = []
            handler.send = lambda code, body: replies.append((code, body))
            handler.do_POST()
        self.assertEqual(replies, [(410, {"error": "owner_authorization_required"})])

    def test_delete_without_database_does_not_contact_postgres(self):
        from unittest.mock import Mock
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "shop"
            p.mkdir()
            (p / ".dck.json").write_text(json.dumps({"needsDatabase": False}))
            service = self.make_service()
            service._snapshot_routes = Mock(return_value={})
            service.nginx_reload = Mock()
            service.all_container_status = Mock(return_value={})
            service.compose = Mock(return_value=Mock(returncode=0))
            with patch("webgen_control.subprocess.run") as run:
                service._delete("shop", p)
            run.assert_not_called()
            self.assertFalse(p.exists())

    def test_delete_filesystem_failure_keeps_and_reinjects_runtime_secrets(self):
        from types import SimpleNamespace
        service = self.make_service()
        project_id = "00000000-0000-4000-8000-000000000001"
        p = service.root / "shop"
        p.mkdir()
        (p / ".dck.json").write_text(json.dumps({
            "port": 3000, "projectId": project_id, "needsDatabase": False
        }))
        (p / "docker-compose.yml").write_text(
            "services:\n  app:\n    container_name: shop-app\n    networks: [dck]\n"
            "    ports:\n      - '127.0.0.1:3000:3000'\nnetworks:\n  dck:\n    external: true\n"
        )
        service.runtime_secrets.bind(project_id, "shop")
        service.runtime_secrets.put(project_id, "API_TOKEN", "rollback-secret")
        service._snapshot_routes = lambda slug: {}
        service._restore_routes = lambda old: None
        service.nginx_reload = lambda: None
        service.project = lambda *args: {"status": "running"}
        calls = []
        def compose(slug, path, action, runtime_env_file=None):
            calls.append(action)
            if action == "deploy":
                calls.append(Path(runtime_env_file).read_text())
            return SimpleNamespace(returncode=0)
        service.compose = compose

        with patch("webgen_control.shutil.rmtree", side_effect=OSError("disk error")):
            with self.assertRaises(WebgenOperationError) as caught:
                service._delete("shop", p)

        self.assertEqual(caught.exception.code, "delete_failed")
        self.assertTrue(p.exists())
        self.assertEqual(service.runtime_secrets.values(project_id), {"API_TOKEN": "rollback-secret"})
        self.assertEqual(calls[0], "delete")
        self.assertEqual(calls[1], "deploy")
        self.assertIn('API_TOKEN="rollback-secret"', calls[2])

    def test_delete_filesystem_failure_does_not_drop_database(self):
        from types import SimpleNamespace
        service = self.make_service()
        project_id = "00000000-0000-4000-8000-000000000002"
        p = service.root / "shop"
        p.mkdir()
        (p / ".dck.json").write_text(json.dumps({
            "port": 3000, "projectId": project_id, "needsDatabase": True
        }))
        service.runtime_secrets.bind(project_id, "shop")
        service.runtime_secrets.put(project_id, "DATABASE_URL", "preserve-db-secret")
        service._snapshot_routes = lambda slug: {}
        service._restore_routes = lambda old: None
        service.nginx_reload = lambda: None
        service.project = lambda *args: {"status": "stopped"}
        service.all_container_status = lambda: {}
        service.compose = lambda *args, **kwargs: SimpleNamespace(returncode=0)
        with patch("webgen_control.subprocess.run", return_value=SimpleNamespace(returncode=0)) as run:
            with patch("webgen_control.shutil.rmtree", side_effect=OSError("disk error")):
                with self.assertRaises(WebgenOperationError):
                    service._delete("shop", p)
        self.assertEqual(run.call_count, 1)
        self.assertIn("SELECT 1", run.call_args.args[0])
        self.assertNotIn("DROP DATABASE", run.call_args.args[0])
        self.assertTrue(p.exists())
        self.assertEqual(
            service.runtime_secrets.values(project_id),
            {"DATABASE_URL": "preserve-db-secret"},
        )

    def test_database_preflight_failure_preserves_project_and_containers(self):
        from unittest.mock import Mock
        with tempfile.TemporaryDirectory() as d:
            p = Path(d)
            (p / ".dck.json").write_text(json.dumps({"needsDatabase": True}))
            service = self.make_service()
            service.compose = Mock()
            with patch.dict(os.environ, {"WEBGEN_POSTGRES_USER": "custom_owner"}), \
                 patch("webgen_control.subprocess.run", return_value=Mock(returncode=1)) as run:
                with self.assertRaises(WebgenOperationError): service._delete("shop", p)
            args = run.call_args.args[0]
            self.assertEqual(args[args.index("-U") + 1], "custom_owner")
            self.assertEqual(args[args.index("-d") + 1], "postgres")
            service.compose.assert_not_called()
            self.assertTrue((p / ".dck.json").exists())

    def test_owner_target_uses_explicit_transition_base(self):
        service = self.make_service()
        with patch("webgen_control.subprocess.run") as run:
            run.return_value.returncode = 0
            run.return_value.stdout = "172.18.0.4"
            self.assertEqual(service.app_target("shop", "/preview/shop"),
                             "http://172.18.0.4:3000/preview/shop/api/dck/owner-seed")
            self.assertEqual(service.app_target("shop", ""),
                             "http://172.18.0.4:3000/api/dck/owner-seed")

    def test_readiness_retries_then_succeeds_and_times_out(self):
        service = self.make_service()
        with patch.object(service, "_health", side_effect=[False, True]), \
             patch("webgen_control.time.sleep"), \
             patch("webgen_control.subprocess.run") as run:
            run.return_value.stdout = "running"
            service.wait_ready("shop", 3000, "/preview/shop/", timeout=5)
        with patch.object(service, "_health", return_value=False), \
             patch("webgen_control.time.monotonic", side_effect=[0, 0, 6, 6]), \
             patch("webgen_control.time.sleep"), \
             patch("webgen_control.subprocess.run") as run:
            run.return_value.stdout = "running"
            with self.assertRaises(WebgenOperationError) as caught:
                service.wait_ready("shop", 3000, "/", timeout=5)
            self.assertEqual(caught.exception.code, "readiness_timeout")

    def test_missing_seed_has_reentry_error(self):
        with tempfile.TemporaryDirectory() as d:
            store = SeedStore(master_path=Path(d) / "key")
            with self.assertRaises(OwnerSeedUnavailable):
                store.authorize("shop", "conversation")

    def test_preview_proxy_preserves_prefix(self):
        config = self.make_service().config("shop", {"port": 3001}, True)
        self.assertIn("proxy_pass http://127.0.0.1:3001;", config)
        self.assertIn("location = /preview/shop", config)

    def make_service(self):
        service = Service.__new__(Service)
        service.canvas = "http://127.0.0.1:8012/api/workspaces"
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        base = Path(directory.name)
        service.nginx = base / "nginx"
        service.nginx.mkdir()
        service.state = base / "state"
        service.state.mkdir(mode=0o700)
        service.runtime_dir = base / "run"
        service.runtime_dir.mkdir(mode=0o700)
        service.seed = SeedStore(master_path=service.state / "master.key")
        service.runtime_secrets = RuntimeSecretStore(
            service.state / "runtime-secrets.enc", service.seed.master
        )
        service.migration_lock = threading.Lock()
        service.root = base / "projects"
        service.root.mkdir()
        service.locks = {}
        service.guard = threading.Lock()
        return service

    def make_project(self, p):
        (p / ".dck.json").write_text(json.dumps({"port": 3000}))
        (p / "docker-compose.yml").write_text(
            """services:
  app:
    image: node:22-alpine
    container_name: x-app
    ports:
      - target: 3000
        published: "3000"
        host_ip: 127.0.0.1
    networks: [dck]
networks:
  dck:
    external: true
    name: dck
"""
        )

    def test_validation_and_canonical(self):
        self.assertTrue(valid_slug("catatan-uang"))
        self.assertFalse(valid_slug("../x"))
        self.assertFalse(valid_subdomain("agent"))
        self.assertFalse(valid_subdomain("-bad"))
        self.assertEqual(
            canonical_signed_payload(1, "x", "c", 1, 2, "n", "ÃƒÂ©", None, " p  ").decode(),
            '[1,"x","c",1,2,"n","ÃƒÂ©",null," p  "]',
        )

    def test_route_switch_writes_single_published_or_preview_config(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            project = root / "shop"
            project.mkdir()
            self.make_project(project)
            service = self.make_service()
            service.nginx = root / "nginx"
            published = service.nginx / "published-shop.conf"
            preview = service.nginx / "preview-shop.conf"

            with patch.object(service, "nginx_reload") as reload_nginx:
                service._set_route("shop", project, {"port": 3000}, "my-shop")
            self.assertIn("server_name my-shop.dckautoposting.com;", published.read_text())
            self.assertFalse(preview.exists())
            self.assertEqual(json.loads((project / ".dck.json").read_text())["subdomain"], "my-shop.dckautoposting.com")
            reload_nginx.assert_called_once_with(expected_config=published)

            with patch.object(service, "nginx_reload") as reload_nginx:
                service._set_route("shop", project, {"port": 3000}, None)
            self.assertFalse(published.exists())
            self.assertIn("location /preview/shop/", preview.read_text())
            self.assertEqual(json.loads((project / ".dck.json").read_text())["previewPath"], "/preview/shop")
            reload_nginx.assert_called_once_with(expected_config=preview)

    def test_nginx_reload_requires_expected_route_file_to_be_loaded(self):
        service = self.make_service()
        expected = Path("/etc/nginx/dck-apps/published-shop.conf")

        class Result:
            returncode = 0
            stderr = ""

            def __init__(self, stdout=""):
                self.stdout = stdout

        calls = []
        include_loaded = True

        def run(command, **kwargs):
            calls.append(command)
            if command == ["nginx", "-T"]:
                return Result(
                    f"# configuration file {expected}:\n" if include_loaded else ""
                )
            return Result()

        with patch("webgen_control.subprocess.run", side_effect=run):
            service.nginx_reload(expected_config=expected)
        self.assertEqual(calls, [["nginx", "-t"], ["nginx", "-T"], ["systemctl", "reload", "nginx"]])

        calls.clear()
        include_loaded = False
        with patch("webgen_control.subprocess.run", side_effect=run):
            with self.assertRaisesRegex(RuntimeError, "not included"):
                service.nginx_reload(expected_config=expected)
        self.assertEqual(calls, [["nginx", "-t"], ["nginx", "-T"]])

    def test_failed_project_list_auth_is_not_followed_by_a_404(self):
        handler = Handler.__new__(Handler)
        handler.path = "/api/webgen/projects"
        handler.auth = lambda: False
        responses = []
        handler.send = lambda code, body: responses.append(code)

        handler.do_GET()

        self.assertEqual(responses, [])

    def test_seed_encrypted_expiring_once(self):
        with tempfile.TemporaryDirectory() as d:
            seed = SeedStore(ttl=2, master_path=Path(d) / "key")
            self.assertNotIn("secret", repr(seed.records))
            staged = seed.stage("x", "conv", "a@b.test", None, "123456789012345")
            self.assertEqual(
                staged["verification_key"],
                SeedStore(ttl=2, master_path=Path(d) / "key").public_key("x"),
            )
            self.assertNotEqual(seed.public_key("x"), seed.public_key("y"))
            self.assertEqual(seed.authorize("x", "conv")["status"], "authorized")
            got = seed.consume("x", "conv")
            self.assertEqual(list(got[1:]), ["a@b.test", None, "123456789012345"])
            with self.assertRaises(OwnerSeedUnavailable):
                seed.consume("x", "conv")

    @unittest.skipUnless(os.name == "posix", "POSIX ownership and permission contract")
    def test_atomic_metadata_is_agent_readable(self):
        with tempfile.TemporaryDirectory() as d:
            project = Path(d) / "project"
            project.mkdir()
            target = project / ".dck.json"
            atomic_json(target, {"lastStatus": "running"})
            self.assertEqual(json.loads(target.read_text())["lastStatus"], "running")
            self.assertEqual(target.stat().st_mode & 0o777, 0o644)
            self.assertEqual(target.stat().st_uid, project.stat().st_uid)
            self.assertFalse(list(project.glob("*.tmp-*")))

    def test_commands_are_allowlisted(self):
        command = command_for("safe-app", "deploy", Path("/x/docker-compose.yml"))
        self.assertEqual(
            command,
            ["docker", "compose", "-p", "safe-app", "-f", str(Path("/x/docker-compose.yml")), "up", "-d", "--build"],
        )
        self.assertEqual(command_for("safe-app", "start", Path("/x/docker-compose.yml"))[-2:], ["up", "-d"])
        self.assertEqual(command_for("safe-app", "restart", Path("/x/docker-compose.yml"))[-2:], ["up", "-d"])
        self.assertEqual(command_for("safe-app", "stop", Path("/x/docker-compose.yml"))[-2:], ["down", "--remove-orphans"])
        with self.assertRaises(ValueError):
            command_for("../x", "deploy", Path("/x"))

    def test_safe_project_rejects_symlinks(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            (root / "ok").mkdir()
            (root / "ok" / ".dck.json").write_text("{}")
            self.assertIsNotNone(safe_project(root, "ok"))
            try:
                (root / "link").symlink_to(root / "ok", target_is_directory=True)
            except OSError as error:
                if getattr(error, "winerror", None) == 1314: self.skipTest("Windows symlink privilege unavailable")
                raise
            self.assertIsNone(safe_project(root, "link"))

    def test_compose_rejects_rendered_unsafe_policy(self):
        with tempfile.TemporaryDirectory() as d:
            project = Path(d)
            self.make_project(project)
            service = self.make_service()
            bad = {
                "networks": {"dck": {"external": True, "name": "dck"}},
                "services": {
                    "app": {
                        "container_name": "x-app",
                        "networks": ["dck"],
                        "ports": [{"target": 3000, "published": "3000", "host_ip": "127.0.0.1"}],
                        "volumes": ["host:/host"],
                    }
                },
            }

            class Result:
                returncode = 0
                stdout = json.dumps(bad)

            with patch("webgen_control.subprocess.run", return_value=Result()):
                with self.assertRaises(ValueError):
                    service.compose_config("x", project)

    def test_compose_rejects_external_env_file_before_docker(self):
        with tempfile.TemporaryDirectory() as d:
            project = Path(d)
            self.make_project(project)
            content = (project / "docker-compose.yml").read_text().replace(
                "    networks: [dck]", "    networks: [dck]\n    env_file: ../host.env"
            )
            (project / "docker-compose.yml").write_text(content)
            service = self.make_service()
            with patch("webgen_control.subprocess.run") as run:
                with self.assertRaises(ValueError):
                    service.compose_config("x", project)
                run.assert_not_called()

    def test_compose_preserves_docker_state_directory_in_its_clean_environment(self):
        from subprocess import CompletedProcess
        with tempfile.TemporaryDirectory() as d:
            project = Path(d)
            self.make_project(project)
            service = self.make_service()
            service.build_lock = threading.RLock()
            config = {
                "networks": {"dck": {"external": True, "name": "dck"}},
                "services": {"app": {
                    "container_name": "x-app", "networks": ["dck"],
                    "ports": [{"target": 3000, "published": "3000", "host_ip": "127.0.0.1"}],
                }},
            }
            with patch.dict(os.environ, {
                "WEBGEN_DOCKER_CONFIG": str(project / "docker-state"),
                "UNRELATED_HOST_SECRET": "must-not-leak",
            }), patch("webgen_control.subprocess.run", side_effect=[
                CompletedProcess([], 0, stdout=json.dumps(config)),
                CompletedProcess([], 0),
            ]) as run:
                service.compose("x", project, "deploy")

            for call in run.call_args_list:
                self.assertEqual(call.kwargs["env"].get("DOCKER_CONFIG"), str(project / "docker-state"))
                self.assertNotIn("UNRELATED_HOST_SECRET", call.kwargs["env"])

    @unittest.skipUnless(os.name == "posix", "POSIX snapshot permission contract")
    def test_compose_validates_and_executes_the_same_root_owned_snapshot(self):
        with tempfile.TemporaryDirectory() as d:
            project = Path(d)
            self.make_project(project)
            original = project / "docker-compose.yml"
            source_bytes = original.read_bytes()
            service = self.make_service()
            service.build_lock = threading.RLock()
            captured = {}

            def validate(slug, path, compose_file=None, source_bytes=None):
                self.assertEqual(slug, "x")
                self.assertEqual(path, project)
                self.assertEqual(source_bytes, original.read_bytes())
                self.assertNotEqual(compose_file, original)
                self.assertTrue(compose_file.is_file())
                self.assertEqual(compose_file.stat().st_mode & 0o777, 0o400)
                captured["snapshot"] = compose_file

            class Result:
                returncode = 0
                stdout = ""
                stderr = ""

            def run(command, **kwargs):
                snapshot = Path(command[command.index("-f") + 1])
                self.assertEqual(snapshot, captured["snapshot"])
                self.assertEqual(snapshot.read_bytes(), source_bytes)
                self.assertEqual(command[command.index("--project-directory") + 1], str(project))
                self.assertEqual(command[-3:], ["up", "-d", "--build"])
                return Result()

            with patch.object(service, "compose_config", side_effect=validate), patch(
                "webgen_control.subprocess.run", side_effect=run
            ):
                service.compose("x", project, "deploy")

    def test_compose_runs_distinct_allowlisted_sequences_for_each_lifecycle_action(self):
        with tempfile.TemporaryDirectory() as d:
            project = Path(d)
            self.make_project(project)
            service = self.make_service()
            service.build_lock = threading.RLock()

            class Result:
                returncode = 0
                stdout = ""
                stderr = ""

            for action, expected in {
                "deploy": [["up", "-d", "--build"]],
                "rebuild": [["down", "--remove-orphans"], ["up", "-d", "--build"]],
                "start": [["up", "-d"]],
                "restart": [["down", "--remove-orphans"], ["up", "-d"]],
                "stop": [["down", "--remove-orphans"]],
            }.items():
                calls = []

                def run(command, **kwargs):
                    calls.append(command)
                    return Result()

                with patch.object(service, "compose_config"), patch(
                    "webgen_control.subprocess.run", side_effect=run
                ):
                    service.compose("x", project, action)
                tails = [command[command.index("--project-directory") + 2:] for command in calls]
                self.assertEqual(tails, expected, action)

    def test_deploy_uses_same_origin_preview_without_publishing(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            project = root / "shop"
            project.mkdir()
            self.make_project(project)
            service = self.make_service()
            service.root = root
            service.locks = {}
            service.guard = threading.Lock()
            service._ensure_unique_subdomain = lambda slug, subdomain: None
            runtime_env = Path("/host/state/runtime.env")
            service.materialize_env = unittest.mock.Mock(return_value=nullcontext(runtime_env))

            class Result:
                returncode = 0

            service.compose = unittest.mock.Mock(return_value=Result())
            service._health = unittest.mock.Mock(return_value=True)
            service._snapshot_routes = unittest.mock.Mock(return_value={})
            service._set_route = unittest.mock.Mock()
            service.update_meta = unittest.mock.Mock()
            service.project = unittest.mock.Mock(return_value={"slug": "shop"})

            result = service.action(
                "shop", {"action": "deploy"}, "session-key"
            )

            self.assertEqual(result, {"slug": "shop"})
            service.materialize_env.assert_called_once_with("shop", project, "/preview/shop")
            service.compose.assert_called_once_with("shop", project, "deploy", runtime_env)
            service._health.assert_called_once_with("shop", 3000, "/preview/shop/", timeout=3)
            service._set_route.assert_called_once_with(
                "shop", project, {"port": 3000}, None
            )

    def test_deploy_without_subdomain_preserves_the_existing_public_domain(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            project = root / "shop"
            project.mkdir()
            self.make_project(project)
            (project / ".dck.json").write_text(
                json.dumps({"port": 3000, "subdomain": "current-shop.dckautoposting.com"})
            )
            service = self.make_service()
            service.root = root
            service.locks = {}
            service.guard = threading.Lock()
            service._ensure_unique_subdomain = unittest.mock.Mock()
            runtime_env = Path("/host/state/runtime.env")
            service.materialize_env = unittest.mock.Mock(return_value=nullcontext(runtime_env))

            class Result:
                returncode = 0

            service.compose = unittest.mock.Mock(return_value=Result())
            service._health = unittest.mock.Mock(return_value=True)
            service._snapshot_routes = unittest.mock.Mock(return_value={})
            service._set_route = unittest.mock.Mock()
            service.update_meta = unittest.mock.Mock()
            service.project = unittest.mock.Mock(return_value={"slug": "shop"})

            service.action("shop", {"action": "deploy"}, "session-key")
            service.materialize_env.assert_called_once_with("shop", project, "")
            service.compose.assert_called_once_with("shop", project, "deploy", runtime_env)

            service._set_route.assert_called_once_with(
                "shop", project, {"port": 3000, "subdomain": "current-shop.dckautoposting.com"}, "current-shop"
            )
            service._ensure_unique_subdomain.assert_not_called()

    def test_deploy_rejects_publication_parameters_before_side_effects(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            project = root / "shop"
            project.mkdir()
            self.make_project(project)
            service = self.make_service()
            service.root = root
            service.locks = {}
            service.guard = threading.Lock()
            service.compose = unittest.mock.Mock()

            with self.assertRaisesRegex(ValueError, "subdomain requires publish"):
                service.action("shop", {"action": "deploy", "subdomain": "valid-domain"})
            service.compose.assert_not_called()

    def test_runtime_secrets_are_encrypted_off_workspace_and_injected_only_for_app(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d) / "projects"
            project = root / "shop"
            project.mkdir(parents=True)
            (project / ".dck.json").write_text(json.dumps({"port": 3000, "authProvider": "better-auth"}))
            (project / ".env.example").write_text(
                "NEXT_PUBLIC_SITE_NAME=Shop\nDATABASE_URL=placeholder\nBETTER_AUTH_SECRET=placeholder\nAPP_BASE_PATH=/\n"
            )
            (project / "docker-compose.yml").write_text(
                """services:
  app:
    image: node:22-alpine
    container_name: shop-app
    env_file: .env
    ports:
      - target: 3000
        published: "3000"
        host_ip: 127.0.0.1
    networks: [dck]
networks:
  dck:
    external: true
    name: dck
"""
            )
            service = self.make_service()
            service.root = root
            service.build_lock = threading.RLock()
            project_id = service._ensure_project_id("shop", project)
            database_url = "postgres://user:p$ss${TOKEN}\"'#fragment"
            auth_secret = "s3cr3t-value"
            service.runtime_secrets.put(project_id, "DATABASE_URL", database_url)
            service.runtime_secrets.put(project_id, "BETTER_AUTH_SECRET", auth_secret)
            encrypted = service.runtime_secrets.path.read_bytes()
            self.assertNotIn(database_url.encode(), encrypted)
            self.assertNotIn(auth_secret.encode(), encrypted)
            captured = {}

            class Result:
                returncode = 0
                stdout = ""
                stderr = ""

            def fake_run(command, **kwargs):
                compose_files = [Path(command[i + 1]) for i, arg in enumerate(command[:-1]) if arg == "-f"]
                self.assertEqual(len(compose_files), 2)
                captured["overlay"] = compose_files[1].read_text()
                return Result()

            with patch("webgen_control.urlopen") as urlopen:
                with service.materialize_env("shop", project, "/preview/shop") as runtime_env:
                    self.assertNotEqual(runtime_env.parent, project)
                    self.assertIn(service.runtime_dir.resolve(), runtime_env.resolve().parents)
                    self.assertNotIn(service.state.resolve(), runtime_env.resolve().parents)
                    self.assertEqual(runtime_env.stat().st_mode & 0o777, 0o600)
                    runtime_text = runtime_env.read_text()
                    self.assertIn('DATABASE_URL="postgres://user:p$$ss$${TOKEN}\\\"\'#fragment"', runtime_text)
                    self.assertIn('BETTER_AUTH_SECRET="s3cr3t-value"', runtime_text)
                    project_env = (project / ".env").read_text()
                    self.assertIn("NEXT_PUBLIC_SITE_NAME=Shop", project_env)
                    self.assertNotIn(database_url, project_env)
                    self.assertNotIn(auth_secret, project_env)
                    self.assertNotIn("DATABASE_URL=placeholder", project_env)
                    with patch.object(service, "compose_config"), patch(
                        "webgen_control.subprocess.run", side_effect=fake_run
                    ):
                        service.compose("shop", project, "deploy", runtime_env)
                urlopen.assert_not_called()

            self.assertNotIn(database_url, captured["overlay"])
            self.assertNotIn(auth_secret, captured["overlay"])
            self.assertIn("services:\n  app:\n    env_file:", captured["overlay"])
            self.assertFalse(runtime_env.exists())

    @unittest.skipUnless(
        os.getenv("WEBGEN_DOCKER_INTEGRATION") == "1",
        "set WEBGEN_DOCKER_INTEGRATION=1 to run the real-container test",
    )
    def test_runtime_environment_saved_by_api_is_visible_inside_container(self):
        if not shutil.which("docker"):
            self.skipTest("Docker CLI is unavailable")
        service = self.make_service()
        docker_env = service.docker_environment()
        for command in (["docker", "info"], ["docker", "compose", "version"]):
            result = subprocess.run(
                command,
                capture_output=True,
                text=True,
                timeout=20,
                check=False,
                env=docker_env,
            )
            if result.returncode:
                self.skipTest("Docker Engine or Compose is unavailable")

        network_created = False
        if subprocess.run(
            ["docker", "network", "inspect", "dck"],
            capture_output=True,
            timeout=10,
            check=False,
            env=docker_env,
        ).returncode:
            created = subprocess.run(
                ["docker", "network", "create", "dck"],
                capture_output=True,
                text=True,
                timeout=20,
                check=False,
                env=docker_env,
            )
            if created.returncode:
                self.fail("Could not create the required dck integration-test network")
            network_created = True

        container_name = None
        try:
            with tempfile.TemporaryDirectory() as d:
                service.root = Path(d) / "projects"
                service.root.mkdir()
                service.build_lock = threading.RLock()
                slug = "runtime-env-test-" + uuid.uuid4().hex[:10]
                project = service.root / slug
                project.mkdir()
                with socket.socket() as listener:
                    listener.bind(("127.0.0.1", 0))
                    published_port = listener.getsockname()[1]
                (project / ".dck.json").write_text(
                    json.dumps({"port": published_port, "needsDatabase": False})
                )
                server_code = chr(10).join(
                    [
                        "from http.server import BaseHTTPRequestHandler, HTTPServer",
                        "class Handler(BaseHTTPRequestHandler):",
                        " def do_GET(self):",
                        "  self.send_response(200); self.end_headers(); self.wfile.write(b'ok')",
                        " def log_message(self, *args): pass",
                        "HTTPServer(('0.0.0.0', 3000), Handler).serve_forever()",
                    ]
                )
                container_name = slug + "-app"
                compose = {
                    "services": {
                        "app": {
                            "image": "python:3.12-alpine",
                            "container_name": container_name,
                            "entrypoint": ["python3"],
                            "command": ["-c", server_code],
                            "ports": [
                                {
                                    "target": 3000,
                                    "published": str(published_port),
                                    "host_ip": "127.0.0.1",
                                }
                            ],
                            "networks": ["dck"],
                        }
                    },
                    "networks": {"dck": {"external": True, "name": "dck"}},
                }
                (project / "docker-compose.yml").write_text(yaml.safe_dump(compose))

                probe_value = "container-probe-" + uuid.uuid4().hex
                saved = _handler_call(
                    service,
                    "do_PUT",
                    f"/api/webgen/projects/{slug}/runtime-secrets",
                    {"name": "CONTAINER_PROBE", "value": probe_value},
                )
                self.assertEqual(saved[0][0], 200)
                self.assertNotIn(probe_value, json.dumps(saved[0][1]))

                service.nginx_reload = lambda *args, **kwargs: None
                service.action(slug, {"action": "start"})
                self.assertEqual(service.metadata(project)["lastStatus"], "running")
                self.assertEqual(list(service.runtime_dir.iterdir()), [])
                self.assertNotIn(probe_value, (project / ".env").read_text())

                verified = subprocess.run(
                    [
                        "docker",
                        "exec",
                        "-i",
                        container_name,
                        "python3",
                        "-c",
                        "import os,sys; sys.exit(0 if os.environ.get('CONTAINER_PROBE') == sys.stdin.read() else 1)",
                    ],
                    input=probe_value,
                    capture_output=True,
                    text=True,
                    timeout=20,
                    check=False,
                    env=docker_env,
                )
                self.assertEqual(
                    verified.returncode,
                    0,
                    "The API-saved Environment value was not visible inside the app container",
                )
        finally:
            if container_name:
                subprocess.run(
                    ["docker", "rm", "-f", container_name],
                    capture_output=True,
                    timeout=30,
                    check=False,
                    env=docker_env,
                )
            if network_created:
                subprocess.run(
                    ["docker", "network", "rm", "dck"],
                    capture_output=True,
                    timeout=20,
                    check=False,
                    env=docker_env,
                )

    def test_missing_required_secret_fails_without_writing_env(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d) / "projects"
            project = root / "shop"
            project.mkdir(parents=True)
            (project / ".dck.json").write_text(json.dumps({"port": 3000, "authProvider": "better-auth"}))
            (project / "docker-compose.yml").write_text(
                """services:
  app:
    image: node:22-alpine
    container_name: shop-app
    environment:
      DATABASE_URL: "${DATABASE_URL}"
      BETTER_AUTH_SECRET: "${BETTER_AUTH_SECRET}"
    ports:
      - target: 3000
        published: "3000"
        host_ip: 127.0.0.1
    networks: [dck]
networks:
  dck:
    external: true
    name: dck
"""
            )
            service = self.make_service()
            service.root = root
            with self.assertRaises(SecretMaterializationError) as caught:
                with service.materialize_env("shop", project, "/preview/shop"):
                    self.fail("missing required secrets must not produce an env file")
            self.assertEqual(caught.exception.status, 422)
            self.assertEqual(caught.exception.code, "secrets_required")
            self.assertFalse((project / ".env").exists())

    def test_seed_delivery_retries_and_consumes_on_success(self):
        with tempfile.TemporaryDirectory() as d:
            seed = SeedStore(master_path=Path(d) / "key")
            seed.stage("x", "c", "a@b.test", None, "123456789012345")
            seed.authorize("x", "c")
            service = Service.__new__(Service)
            service.seed = seed
            service.app_target = lambda *args: "http://127.0.0.1:1/seed"
            with patch("webgen_control.urlopen", side_effect=OSError("temporary")):
                self.assertFalse(service.deliver_seed("x", Path(d), "c"))
            self.assertTrue(seed.authorized("x", "c"))

            class ConflictResponse(_Response):
                status = 409

            with patch("webgen_control.urlopen", return_value=ConflictResponse(b"{}")):
                self.assertTrue(service.deliver_seed("x", Path(d), "c"))
            self.assertFalse(seed.authorized("x", "c"))

    def test_batched_status_is_filtered_sanitized_and_unknown_on_failure(self):
        service = self.make_service()

        class Failure:
            returncode = 1
            stdout = ""

        with patch("webgen_control.subprocess.run", return_value=Failure()) as run:
            self.assertIsNone(service.all_container_status())
            self.assertEqual(run.call_args.args[0][0:4], ["docker", "ps", "-a", "--filter"])

        with tempfile.TemporaryDirectory() as d:
            service.root = Path(d)
            (service.root / "x").mkdir()
            (service.root / "x" / ".dck.json").write_text(json.dumps({"port": 3000}))
            status = {
                "x": [
                    {
                        "id": "1",
                        "name": "x-app",
                        "state": "running",
                        "health": "healthy",
                        "exit_code": 0,
                        "image": "secret",
                    }
                ]
            }
            with patch.object(service, "all_container_status", return_value=status):
                project = service.projects()[0]
            self.assertEqual(project["path"], "/projects/webgen/x")
            self.assertEqual(set(project["containers"][0]), {"id", "name", "state", "health", "exit_code"})
            self.assertEqual(project["status"], "running")

    def test_runtime_store_encrypts_values_isolates_projects_and_retains_binding(self):
        import uuid
        service = self.make_service()
        alpha_id, beta_id = str(uuid.uuid4()), str(uuid.uuid4())
        service.runtime_secrets.bind(alpha_id, "alpha")
        service.runtime_secrets.bind(beta_id, "beta")
        service.runtime_secrets.put(alpha_id, "API_TOKEN", "alpha-private-value")
        service.runtime_secrets.put(beta_id, "API_TOKEN", "beta-private-value")
        ciphertext = service.runtime_secrets.path.read_bytes()
        self.assertNotIn(b"alpha-private-value", ciphertext)
        self.assertNotIn(b"beta-private-value", ciphertext)

        reopened = RuntimeSecretStore(service.runtime_secrets.path, service.seed.master)
        self.assertEqual(reopened.values(alpha_id), {"API_TOKEN": "alpha-private-value"})
        self.assertEqual(reopened.values(beta_id), {"API_TOKEN": "beta-private-value"})
        with self.assertRaises(WebgenOperationError) as caught:
            reopened.bind(alpha_id, "beta")
        self.assertEqual(caught.exception.code, "project_identity_conflict")
        reopened.delete(alpha_id, "API_TOKEN")
        self.assertEqual(reopened.identity_for_slug("alpha"), alpha_id)

    def test_runtime_store_write_failure_restores_memory_and_persisted_state(self):
        service = self.make_service()
        project_id = "00000000-0000-4000-8000-000000000001"
        service.runtime_secrets.bind(project_id, "shop")
        before = service.runtime_secrets.path.read_bytes()
        with patch.object(service.runtime_secrets, "_save", side_effect=OSError("disk full")):
            with self.assertRaises(OSError):
                service.runtime_secrets.put(project_id, "API_TOKEN", "not-persisted")
        self.assertEqual(service.runtime_secrets.values(project_id), {})
        self.assertEqual(service.runtime_secrets.path.read_bytes(), before)

        service.runtime_secrets.put(project_id, "API_TOKEN", "persisted")
        before = service.runtime_secrets.path.read_bytes()
        with patch.object(service.runtime_secrets, "_save", side_effect=OSError("disk full")):
            with self.assertRaises(OSError):
                service.runtime_secrets.delete(project_id, "API_TOKEN")
        self.assertEqual(service.runtime_secrets.values(project_id), {"API_TOKEN": "persisted"})
        self.assertEqual(service.runtime_secrets.path.read_bytes(), before)

        with patch("webgen_control.os.fsync", side_effect=[None, OSError("directory fsync"), None, None]):
            with self.assertRaises(OSError):
                service.runtime_secrets.put(project_id, "OTHER_TOKEN", "not-committed")
        self.assertEqual(service.runtime_secrets.values(project_id), {"API_TOKEN": "persisted"})
        self.assertEqual(service.runtime_secrets.path.read_bytes(), before)

    def test_runtime_store_double_persistence_failure_locks_service(self):
        service = self.make_service()
        project_id = "00000000-0000-4000-8000-000000000001"
        service.runtime_secrets.bind(project_id, "shop")

        # New blob fsync succeeds; commit dir fsync fails; rollback blob fsync
        # succeeds; rollback dir fsync fails, leaving disk state uncertain.
        with patch("webgen_control.os.fsync", side_effect=[None, OSError("commit directory fsync"), None, OSError("rollback directory fsync")]):
            with self.assertRaises(RuntimeSecretStoreUnavailable):
                service.runtime_secrets.put(project_id, "API_TOKEN", "not-committed")

        self.assertFalse(service.runtime_secrets.healthy)
        for operation in (
            lambda: service.runtime_secrets.values(project_id),
            lambda: service.runtime_secrets.list(project_id),
            lambda: service.runtime_secrets.put(project_id, "OTHER_TOKEN", "blocked"),
        ):
            with self.assertRaises(RuntimeSecretStoreUnavailable):
                operation()
        self.assertEqual(
            _handler_call(service, "do_GET", "/healthz"),
            [(503, {"error": "runtime_secret_store_unavailable"})],
        )

    def test_backup_tar_roundtrip_preserves_master_key_and_encrypted_store_pair(self):
        import shutil
        import subprocess
        service = self.make_service()
        project_id = "00000000-0000-4000-8000-000000000001"
        service.runtime_secrets.bind(project_id, "shop")
        service.runtime_secrets.put(project_id, "API_TOKEN", "backup-only-value")
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "source"
            state = source / "var/lib/dck-webgen-control"
            state.mkdir(parents=True)
            (source / "opt/dck-agentic").mkdir(parents=True)
            shutil.copy2(service.state / "master.key", state / "webgen-control.key")
            shutil.copy2(service.runtime_secrets.path, state / "runtime-secrets.enc")
            for item in state.iterdir():
                item.chmod(0o600)
            state.chmod(0o700)
            archive = root / "backup.tgz"
            subprocess.run([
                "tar", "--numeric-owner", "-czf", str(archive), "-C", str(source),
                "opt/dck-agentic", "var/lib/dck-webgen-control",
            ], check=True, capture_output=True)
            restored = root / "restored"
            restored.mkdir()
            subprocess.run([
                "tar", "--numeric-owner", "-xzf", str(archive), "-C", str(restored),
            ], check=True, capture_output=True)
            restored_state = restored / "var/lib/dck-webgen-control"
            key = restored_state / "webgen-control.key"
            store_path = restored_state / "runtime-secrets.enc"
            self.assertEqual(key.read_bytes(), service.seed.master)
            for path in (restored_state, key, store_path):
                self.assertEqual(path.stat().st_mode & 0o077, 0)
                self.assertEqual(path.stat().st_uid, os.geteuid())
            reopened = RuntimeSecretStore(store_path, key.read_bytes())
            self.assertEqual(reopened.values(project_id), {"API_TOKEN": "backup-only-value"})

    def test_runtime_secret_api_is_authenticated_scoped_and_never_returns_values(self):
        service = self.make_service()
        for slug in ("shop", "other"):
            project = service.root / slug
            project.mkdir()
            (project / ".dck.json").write_text(json.dumps({"port": 3000}))
        service._legacy_secret_candidates = lambda slug, key: []
        secret_value = "do-not-return-this-value"
        service.compose = unittest.mock.Mock()

        status, saved = _handler_call(
            service,
            "do_PUT",
            "/api/webgen/projects/shop/runtime-secrets",
            {"name": "DATABASE_URL", "value": secret_value},
        )[0]
        self.assertEqual(status, 200)
        self.assertNotIn(secret_value, json.dumps(saved))

        status, shop_payload = _handler_call(
            service, "do_GET", "/api/webgen/projects/shop/runtime-secrets"
        )[0]
        status_other, other_payload = _handler_call(
            service, "do_GET", "/api/webgen/projects/other/runtime-secrets"
        )[0]
        self.assertEqual((status, status_other), (200, 200))
        self.assertEqual([item["name"] for item in shop_payload["secrets"]], ["DATABASE_URL"])
        self.assertEqual(other_payload["secrets"], [])
        self.assertNotIn(secret_value, json.dumps(shop_payload))
        self.assertNotIn(secret_value, json.dumps(other_payload))
        self.assertNotIn("value", shop_payload["secrets"][0])

        service.all_container_status = lambda: {}
        status, project_list = _handler_call(service, "do_GET", "/api/webgen/projects")[0]
        self.assertEqual(status, 200)
        self.assertNotIn(secret_value, json.dumps(project_list))

        unauthorized = _handler_call(
            service,
            "do_GET",
            "/api/webgen/projects/shop/runtime-secrets",
            authenticated=False,
        )
        self.assertEqual(unauthorized, [])
        self.assertEqual(
            _handler_call(
                service,
                "do_PUT",
                "/api/webgen/projects/shop/runtime-secrets",
                {"name": "OTHER_TOKEN", "value": "must-not-save"},
                authenticated=False,
            ),
            [],
        )
        deleted = _handler_call(
            service,
            "do_DELETE",
            "/api/webgen/projects/shop/runtime-secrets/DATABASE_URL",
        )[0]
        self.assertEqual(deleted, (200, {"deleted": True}))
        self.assertEqual(service.runtime_secrets.values(shop_payload["project_id"]), {})
        service.compose.assert_not_called()

    def test_runtime_secret_api_runs_real_auth_and_keeps_project_scope(self):
        from urllib.error import HTTPError
        service = self.make_service()
        for slug in ("shop", "other"):
            project = service.root / slug
            project.mkdir()
            (project / ".dck.json").write_text(json.dumps({"port": 3000}))
        service._legacy_secret_candidates = lambda slug, key: []

        def authenticated_request(request, timeout):
            header = next((value for name, value in request.header_items() if name.lower() == "x-session-api-key"), None)
            if header != "session-key":
                raise HTTPError(request.full_url, 401, "unauthorized", {}, None)
            return _Response(b"{}")

        with patch("webgen_control.urlopen", side_effect=authenticated_request) as upstream:
            status, _ = _handler_call(
                service, "do_PUT", "/api/webgen/projects/shop/runtime-secrets",
                {"name": "API_TOKEN", "value": "private"}, actual_auth=True,
            )[0]
            self.assertEqual(status, 200)
            status, other = _handler_call(
                service, "do_GET", "/api/webgen/projects/other/runtime-secrets",
                actual_auth=True,
            )[0]
            self.assertEqual(status, 200)
            self.assertEqual(other["secrets"], [])
            self.assertGreaterEqual(upstream.call_count, 2)

        with patch("webgen_control.urlopen", side_effect=lambda request, timeout: (_ for _ in ()).throw(
            HTTPError(request.full_url, 401, "unauthorized", {}, None)
        )):
            denied = _handler_call(
                service, "do_PUT", "/api/webgen/projects/other/runtime-secrets",
                {"name": "OTHER_TOKEN", "value": "must-not-save"}, actual_auth=True,
            )
        self.assertEqual(denied, [(401, {"error": "unauthorized"})])
        other_id = json.loads((service.root / "other" / ".dck.json").read_text())["projectId"]
        self.assertEqual(service.runtime_secrets.values(other_id), {})

    def test_corrupt_project_metadata_fails_closed_without_overwrite(self):
        service = self.make_service()
        project = service.root / "shop"
        project.mkdir()
        metadata = project / ".dck.json"
        metadata.write_bytes(b'{"port":3000, invalid')
        original = metadata.read_bytes()

        status, response = _handler_call(
            service, "do_GET", "/api/webgen/projects/shop/runtime-secrets"
        )[0]

        self.assertEqual(status, 409)
        self.assertEqual(response, {"error": "invalid_project_metadata"})
        self.assertEqual(metadata.read_bytes(), original)
        self.assertEqual(service.runtime_secrets.data, {})

    def test_project_identity_binding_rejects_workspace_id_swap_and_restores_missing_id(self):
        import uuid
        service = self.make_service()
        project = service.root / "shop"
        project.mkdir()
        (project / ".dck.json").write_text(json.dumps({"port": 3000}))
        service._legacy_secret_candidates = lambda slug, key: []
        _handler_call(service, "do_PUT", "/api/webgen/projects/shop/runtime-secrets", {
            "name": "API_TOKEN", "value": "private"
        })
        original_id = json.loads((project / ".dck.json").read_text())["projectId"]

        (project / ".dck.json").write_text(json.dumps({"port": 3000, "projectId": str(uuid.uuid4())}))
        status, error = _handler_call(
            service, "do_GET", "/api/webgen/projects/shop/runtime-secrets"
        )[0]
        self.assertEqual(status, 409)
        self.assertEqual(error["error"], "project_identity_conflict")

        (project / ".dck.json").write_text(json.dumps({"port": 3000}))
        status, payload = _handler_call(
            service, "do_GET", "/api/webgen/projects/shop/runtime-secrets"
        )[0]
        self.assertEqual(status, 200)
        self.assertEqual(payload["project_id"], original_id)
        self.assertEqual(json.loads((project / ".dck.json").read_text())["projectId"], original_id)

    def test_legacy_candidates_are_slug_scoped_and_ambiguous_moves_need_confirmation(self):
        service = self.make_service()
        for slug in ("shop", "app-shop"):
            project = service.root / slug
            project.mkdir()
            (project / ".dck.json").write_text(json.dumps({"port": 3000}))
        service._agent_secret_names = lambda key: [
            "DATABASE_URL_SHOP", "DB_URL_APP_SHOP", "UNSUFFIXED_SECRET"
        ]
        candidates = service._legacy_secret_candidates("shop", "session-key")
        by_source = {item["source_name"]: item for item in candidates}
        self.assertEqual(set(by_source), {"DATABASE_URL_SHOP", "DB_URL_APP_SHOP"})
        self.assertFalse(by_source["DATABASE_URL_SHOP"]["ambiguous"])
        self.assertTrue(by_source["DB_URL_APP_SHOP"]["ambiguous"])
        self.assertNotIn("UNSUFFIXED_SECRET", by_source)

        project = service.root / "shop"
        service._legacy_secret_candidates = lambda slug, key: [by_source["DB_URL_APP_SHOP"]]
        service._secret_request = unittest.mock.Mock(return_value=b"legacy-secret-value")
        with self.assertRaises(WebgenOperationError) as caught:
            service.migrate_runtime_secret("shop", project, "session-key", "DB_URL_APP_SHOP")
        self.assertEqual(caught.exception.code, "migration_confirmation_required")
        service._secret_request.assert_not_called()

        result = service.migrate_runtime_secret(
            "shop", project, "session-key", "DB_URL_APP_SHOP", confirm_ambiguous=True
        )
        self.assertEqual(result, {"name": "DB_URL_APP", "configured": False, "source_removed": False, "pending": True})
        project_id = json.loads((project / ".dck.json").read_text())["projectId"]
        self.assertEqual(service.runtime_secrets.values(project_id), {})
        service._secret_request.side_effect = WebgenOperationError("agent_secret_not_found", 404)
        completed = service.migrate_runtime_secret("shop", project, "session-key", "DB_URL_APP_SHOP")
        self.assertTrue(completed["source_removed"])
        self.assertEqual(service.runtime_secrets.values(project_id), {"DB_URL_APP": "legacy-secret-value"})

    def test_migration_stays_encrypted_and_inactive_until_source_removal_is_confirmed(self):
        service = self.make_service()
        project = service.root / "shop"
        project.mkdir()
        (project / ".dck.json").write_text(json.dumps({"port": 3000}))
        service._legacy_secret_candidates = lambda slug, key: [{
            "source_name": "LEGACY_TOKEN_SHOP", "runtime_name": "LEGACY_TOKEN", "ambiguous": False
        }]
        service._secret_request = unittest.mock.Mock(return_value=b"legacy-only-value")
        result = service.migrate_runtime_secret("shop", project, "session-key", "LEGACY_TOKEN_SHOP")
        self.assertEqual(result, {
            "name": "LEGACY_TOKEN", "configured": False,
            "source_removed": False, "pending": True,
        })
        project_id = json.loads((project / ".dck.json").read_text())["projectId"]
        self.assertEqual(service.runtime_secrets.values(project_id), {})
        listed = service.runtime_secrets.list(project_id)
        self.assertEqual(listed["pending_migrations"], [{
            "name": "LEGACY_TOKEN", "source_name": "LEGACY_TOKEN_SHOP"
        }])
        self.assertNotIn("legacy-only-value", json.dumps(listed))
        self.assertNotIn(b"legacy-only-value", service.runtime_secrets.path.read_bytes())

        service._secret_request.side_effect = SecretMaterializationError(
            "source unavailable", 503, "secret_manager_unavailable"
        )
        with self.assertRaises(SecretMaterializationError) as caught:
            service.migrate_runtime_secret("shop", project, "session-key", "LEGACY_TOKEN_SHOP")
        self.assertEqual(caught.exception.code, "migration_pending")
        self.assertEqual(service.runtime_secrets.values(project_id), {})

        service._secret_request.side_effect = None
        service._secret_request.return_value = b"updated-legacy-value"
        with self.assertRaises(WebgenOperationError) as still_present:
            service.migrate_runtime_secret("shop", project, "session-key", "LEGACY_TOKEN_SHOP")
        self.assertEqual(still_present.exception.code, "migration_source_still_exists")
        self.assertEqual(service.runtime_secrets.values(project_id), {})
        self.assertNotIn(b"updated-legacy-value", service.runtime_secrets.path.read_bytes())

        service._secret_request.side_effect = WebgenOperationError("agent_secret_not_found", 404)
        result = service.migrate_runtime_secret("shop", project, "session-key", "LEGACY_TOKEN_SHOP")
        self.assertTrue(result["source_removed"])
        self.assertEqual(service.runtime_secrets.values(project_id), {"LEGACY_TOKEN": "updated-legacy-value"})
        self.assertEqual(service._secret_request.call_count, 4)

    def test_startup_scrub_removes_legacy_secrets_but_keeps_safe_defaults(self):
        service = self.make_service()
        project = service.root / "shop"
        project.mkdir()
        (project / ".dck.json").write_text(json.dumps({"port": 3000}))
        project_id = "00000000-0000-4000-8000-000000000001"
        service.runtime_secrets.bind(project_id, "shop")
        service.runtime_secrets.put(project_id, "TOKEN", "stored-runtime-secret")
        (project / ".env.example").write_text("NEXT_PUBLIC_SITE_NAME=Shop\nPORT=3000\nDATABASE_URL=placeholder\nTOKEN=example-placeholder\nAWS_SECRET_ACCESS_KEY=placeholder\n")
        (project / ".env").write_text("DATABASE_URL=old-private-value\nTOKEN=old-runtime-secret\nAWS_SECRET_ACCESS_KEY=old-aws-secret\nNEXT_PUBLIC_SITE_NAME=Old\nPORT=4800\nFEATURE_FLAG=enabled\n")
        service._scrub_legacy_workspace_envs()
        cleaned = (project / ".env").read_text()
        self.assertNotIn("old-private-value", cleaned)
        self.assertNotIn("stored-runtime-secret", cleaned)
        self.assertNotIn("old-runtime-secret", cleaned)
        self.assertNotIn("old-aws-secret", cleaned)
        self.assertIn("NEXT_PUBLIC_SITE_NAME=Old", cleaned)
        self.assertIn("PORT=4800", cleaned)
        self.assertIn("FEATURE_FLAG=enabled", cleaned)
        self.assertNotIn("PORT=3000", cleaned)
        self.assertNotIn("TOKEN", cleaned)
        self.assertNotIn("DATABASE_URL", cleaned)
        self.assertIn("NEXT_PUBLIC_SITE_NAME=Old", cleaned)
        self.assertIn('APP_BASE_PATH="/preview/shop"', cleaned)

    def test_custom_compose_env_file_is_scrubbed_before_materialization(self):
        service = self.make_service()
        project = service.root / "shop"
        (project / "config").mkdir(parents=True)
        project_id = "00000000-0000-4000-8000-000000000001"
        (project / ".dck.json").write_text(json.dumps({"port": 3000, "projectId": project_id}))
        env_file = project / "config" / "runtime.env"
        env_file.write_text("API_TOKEN=legacy-workspace-value\nFEATURE_FLAG=enabled\n")
        (project / "docker-compose.yml").write_text(
            "services:\n  app:\n    container_name: shop-app\n    env_file: [config/runtime.env]\n"
            "    networks: [dck]\n    ports:\n      - '127.0.0.1:3000:3000'\n"
            "networks:\n  dck:\n    external: true\n    name: dck\n"
        )
        service.runtime_secrets.bind(project_id, "shop")
        service.runtime_secrets.put(project_id, "API_TOKEN", "active-runtime-value")

        service._scrub_legacy_workspace_envs()
        self.assertNotIn("legacy-workspace-value", env_file.read_text())
        self.assertIn("FEATURE_FLAG=enabled", env_file.read_text())

        with service.materialize_env("shop", project, "/preview/shop") as runtime_env:
            self.assertIn('API_TOKEN="active-runtime-value"', runtime_env.read_text())
            self.assertNotIn("legacy-workspace-value", env_file.read_text())
            self.assertIn("FEATURE_FLAG=enabled", env_file.read_text())

    def test_ambiguous_env_is_quarantined_privately_and_blocks_materialization(self):
        service = self.make_service()
        project = service.root / "shop"
        project.mkdir()
        (project / ".dck.json").write_text(json.dumps({"port": 3000}))
        (project / "docker-compose.yml").write_text(
            "services:\n  app:\n    container_name: shop-app\n    networks: [dck]\n"
            "    ports:\n      - '127.0.0.1:3000:3000'\nnetworks:\n  dck:\n    external: true\n"
        )
        env_file = project / ".env"
        original = b"SAFE_VALUE=keep-me\n${UNPARSED_SYNTAX}\n"
        env_file.write_bytes(original)

        with self.assertLogs("webgen-control", level="WARNING") as captured:
            service._scrub_legacy_workspace_envs()
        self.assertFalse(env_file.exists())
        archive_dir = service.state / "legacy-env-quarantine"
        archives = list(archive_dir.glob("manual-review-shop-*.env"))
        self.assertEqual(len(archives), 1)
        archive = archives[0]
        self.assertEqual(archive.read_bytes(), original)
        self.assertFalse(archive.resolve().is_relative_to(service.root.resolve()))
        self.assertEqual(archive.stat().st_uid, os.geteuid())
        self.assertEqual(archive.stat().st_gid, os.getegid())
        self.assertEqual(archive.stat().st_mode & 0o777, 0o600)
        self.assertEqual(archive_dir.stat().st_mode & 0o777, 0o700)
        self.assertNotIn("keep-me", "\n".join(captured.output))
        with self.assertRaises(WebgenOperationError) as caught:
            with service.materialize_env("shop", project, "/preview/shop"):
                self.fail("ambiguous env syntax must not materialize")
        self.assertEqual(caught.exception.code, "environment_manual_review_required")
        self.assertFalse(env_file.exists())

    def test_unparseable_env_example_quarantines_existing_env(self):
        service = self.make_service()
        project = service.root / "shop"
        project.mkdir()
        env_file = project / ".env"
        original = b"API_TOKEN=private-value\nSAFE_FLAG=keep\n"
        env_file.write_bytes(original)
        (project / ".env.example").write_text("SAFE_FLAG=example\n${UNPARSED_SYNTAX}\n")

        with self.assertLogs("webgen-control", level="WARNING") as captured:
            service._scrub_legacy_workspace_envs()

        self.assertFalse(env_file.exists())
        archives = list((service.state / "legacy-env-quarantine").glob("manual-review-shop-*.env"))
        self.assertEqual(len(archives), 1)
        self.assertEqual(archives[0].read_bytes(), original)
        self.assertEqual(archives[0].stat().st_mode & 0o777, 0o600)
        self.assertNotIn("private-value", "\n".join(captured.output))

    def test_ambiguous_env_quarantine_copies_across_filesystems_before_unlink(self):
        import errno
        service = self.make_service()
        project = service.root / "shop"
        project.mkdir()
        env_file = project / ".env"
        original = b"SAFE_VALUE=keep-me\n${UNPARSED_SYNTAX}\n"
        env_file.write_bytes(original)
        with patch("webgen_control.os.replace", side_effect=OSError(errno.EXDEV, "cross-device move")):
            with self.assertLogs("webgen-control", level="WARNING"):
                service._scrub_legacy_workspace_envs()
        archive_dir = service.state / "legacy-env-quarantine"
        archives = list(archive_dir.glob("manual-review-shop-*.env"))
        self.assertEqual(len(archives), 1)
        self.assertEqual(archives[0].read_bytes(), original)
        self.assertEqual(archives[0].stat().st_mode & 0o777, 0o600)
        self.assertFalse(env_file.exists())

    def test_cross_filesystem_quarantine_source_fsync_failure_blocks_startup(self):
        import errno
        service = self.make_service()
        project = service.root / "shop"
        project.mkdir()
        env_file = project / ".env"
        original = b"API_TOKEN=private-value\n${UNPARSED_SYNTAX}\n"
        env_file.write_bytes(original)
        sync_directory = service._sync_directory

        def fail_source_sync_after_unlink(directory):
            if Path(directory) == project and not env_file.exists():
                raise OSError("source directory fsync failed")
            return sync_directory(directory)

        with patch("webgen_control.os.replace", side_effect=OSError(errno.EXDEV, "cross-device move")), \
             patch.object(service, "_sync_directory", side_effect=fail_source_sync_after_unlink):
            with self.assertLogs("webgen-control", level="ERROR") as captured:
                with self.assertRaisesRegex(RuntimeError, "startup blocked"):
                    service._scrub_legacy_workspace_envs()

        self.assertFalse(env_file.exists())
        archives = list((service.state / "legacy-env-quarantine").glob("manual-review-shop-*.env"))
        self.assertEqual(len(archives), 1)
        self.assertEqual(archives[0].read_bytes(), original)
        self.assertNotIn("private-value", "\n".join(captured.output))

    def test_ambiguous_env_quarantine_falls_back_to_private_state_directory(self):
        service = self.make_service()
        project = service.root / "shop"
        project.mkdir()
        env_file = project / ".env"
        original = b"SAFE_VALUE=keep-me\n${UNPARSED_SYNTAX}\n"
        env_file.write_bytes(original)
        secure_directory = service._secure_private_directory

        def fail_quarantine_subdirectory(path):
            if Path(path).name == "legacy-env-quarantine":
                raise OSError("private subdirectory unavailable")
            return secure_directory(path)

        with patch.object(service, "_secure_private_directory", side_effect=fail_quarantine_subdirectory):
            with self.assertLogs("webgen-control", level="WARNING"):
                service._scrub_legacy_workspace_envs()
        archives = list(service.state.glob("manual-review-shop-*.env"))
        self.assertEqual(len(archives), 1)
        self.assertEqual(archives[0].read_bytes(), original)
        self.assertEqual(archives[0].stat().st_mode & 0o777, 0o600)
        self.assertFalse(env_file.exists())

    def test_ambiguous_env_quarantine_failure_removes_workspace_copy_and_blocks_startup(self):
        service = self.make_service()
        project = service.root / "shop"
        project.mkdir()
        env_file = project / ".env"
        env_file.write_bytes(b"PRIVATE_MARKER=never-log-this\n${UNPARSED_SYNTAX}\n")
        with patch.object(service, "_move_env_to_private", side_effect=OSError("never-log-this")):
            with self.assertLogs("webgen-control", level="ERROR") as captured:
                with self.assertRaisesRegex(RuntimeError, "startup blocked"):
                    service._scrub_legacy_workspace_envs()
        self.assertFalse(env_file.exists())
        self.assertNotIn("never-log-this", "\n".join(captured.output))


if __name__ == "__main__":
    unittest.main()
