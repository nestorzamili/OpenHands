import http.client
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile
import threading
import time
import unittest
import sys
from urllib.request import urlopen

sys.path.insert(0, str(Path(__file__).parents[1]))
from webgen_control import Service


@unittest.skipUnless(shutil.which("nginx"), "nginx executable required")
class NginxIntegrationTest(unittest.TestCase):
    def test_preview_uri_and_owner_endpoint(self):
        class App(BaseHTTPRequestHandler):
            def do_GET(self):
                if self.path == "/preview/shop/":
                    self.send_response(308)
                    self.send_header("Location", "/preview/shop")
                    self.end_headers()
                    return
                status = 200 if self.path.split("?")[0] == "/preview/shop" or self.path.startswith("/preview/shop/") else 404
                self.send_response(status)
                self.end_headers()
                self.wfile.write(self.path.encode())

            def log_message(self, *args):
                pass

        backend = ThreadingHTTPServer(("127.0.0.1", 0), App)
        thread = threading.Thread(target=backend.serve_forever, daemon=True)
        thread.start()
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            port = listener.getsockname()[1]
        try:
            with tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                route = Service.__new__(Service).config("shop", {"port": backend.server_port}, True)
                config = root / "nginx.conf"
                config.write_text(f"pid {root}/nginx.pid;\nerror_log {root}/error.log;\nevents {{}}\nhttp {{ access_log off; server {{ listen 127.0.0.1:{port};\n{route}\n}} }}")
                subprocess.run(["nginx", "-t", "-c", str(config)], check=True, capture_output=True)
                process = subprocess.Popen(["nginx", "-c", str(config), "-g", "daemon off;"], stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
                try:
                    for _ in range(100):
                        try:
                            with socket.create_connection(("127.0.0.1", port), timeout=.1): break
                        except OSError: time.sleep(.02)
                    for path in ("/preview/shop/", "/preview/shop/_next/static/app.js?v=1", "/preview/shop/api/dck/owner-seed"):
                        with urlopen(f"http://127.0.0.1:{port}{path}", timeout=2) as response:
                            self.assertEqual(response.status, 200)
                            self.assertEqual(response.read().decode(), path.rstrip("/"))
                    connection = http.client.HTTPConnection("127.0.0.1", port, timeout=2)
                    connection.request("GET", "/preview/shop?x=1")
                    response = connection.getresponse()
                    self.assertEqual(response.status, 200)
                    self.assertEqual(response.read().decode(), "/preview/shop?x=1")
                    connection.close()
                finally:
                    process.terminate()
                    process.communicate(timeout=5)
        finally:
            backend.shutdown(); backend.server_close(); thread.join(timeout=2)
