import json
import os
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch
import sys

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
        service.nginx = Path(directory.name)
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
            service.materialize_env = unittest.mock.Mock()

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
            service.materialize_env.assert_called_once_with("shop", project, "session-key", "/preview/shop")
            service.compose.assert_called_once_with("shop", project, "deploy")
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
            service.materialize_env = unittest.mock.Mock()

            class Result:
                returncode = 0

            service.compose = unittest.mock.Mock(return_value=Result())
            service._health = unittest.mock.Mock(return_value=True)
            service._snapshot_routes = unittest.mock.Mock(return_value={})
            service._set_route = unittest.mock.Mock()
            service.update_meta = unittest.mock.Mock()
            service.project = unittest.mock.Mock(return_value={"slug": "shop"})

            service.action("shop", {"action": "deploy"}, "session-key")

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

    def test_materializes_only_project_secrets_and_quotes_values(self):
        with tempfile.TemporaryDirectory() as d:
            project = Path(d)
            (project / ".dck.json").write_text(json.dumps({"port": 3000, "authProvider": "better-auth"}))
            (project / ".env.example").write_text(
                "NEXT_PUBLIC_SITE_NAME=Shop\nDATABASE_URL=placeholder\nBETTER_AUTH_SECRET=placeholder\nAPP_BASE_PATH=/\n"
            )
            (project / "docker-compose.yml").write_text(
                """services:
  app:
    image: node:22-alpine
    container_name: shop-app
    environment:
      DATABASE_URL: ${DATABASE_URL}
      BETTER_AUTH_SECRET: ${BETTER_AUTH_SECRET}
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
            list_body = json.dumps(
                {
                    "secrets": [
                        {"name": "DATABASE_URL_SHOP"},
                        {"name": "BETTER_AUTH_SECRET_SHOP"},
                        {"name": "OTHER_SECRET_ANOTHER_APP"},
                    ]
                }
            ).encode()
            bodies = {
                "/api/settings/secrets": list_body,
                "/api/settings/secrets/DATABASE_URL_SHOP": b"postgres://user:p$ss${TOKEN}\"'#fragment",
                "/api/settings/secrets/BETTER_AUTH_SECRET_SHOP": b"s3cr3t-value",
            }
            requests = []

            def fake_urlopen(request, timeout=0):
                requests.append(request)
                path = request.full_url.removeprefix("http://127.0.0.1:8012")
                return _Response(bodies[path])

            service = self.make_service()
            with patch("webgen_control.urlopen", side_effect=fake_urlopen):
                service.materialize_env("shop", project, "session-key", "/preview/shop")

            env_text = (project / ".env").read_text()
            self.assertIn("NEXT_PUBLIC_SITE_NAME=Shop", env_text)
            self.assertNotIn("DATABASE_URL=placeholder", env_text)
            self.assertIn('DATABASE_URL="postgres://user:p$$ss$${TOKEN}\\\"\'#fragment"', env_text)
            self.assertIn('BETTER_AUTH_SECRET="s3cr3t-value"', env_text)
            self.assertIn('APP_BASE_PATH="/preview/shop"', env_text)
            self.assertNotIn("OTHER_SECRET", env_text)
            if os.name == "posix": self.assertEqual((project / ".env").stat().st_mode & 0o777, 0o600)
            self.assertTrue(all(r.get_header("X-session-api-key") == "session-key" for r in requests))

    def test_missing_required_secret_fails_without_writing_env(self):
        with tempfile.TemporaryDirectory() as d:
            project = Path(d)
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

            class EmptyResponse(_Response):
                def __init__(self):
                    super().__init__(b'{"secrets":[]}')

            service = self.make_service()
            with patch("webgen_control.urlopen", return_value=EmptyResponse()):
                with self.assertRaises(SecretMaterializationError) as caught:
                    service.materialize_env("shop", project, "session-key", "/preview/shop")
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


if __name__ == "__main__":
    unittest.main()
