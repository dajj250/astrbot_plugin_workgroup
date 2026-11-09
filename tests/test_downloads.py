import hashlib
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch
from downloads import download_file


class DownloadTests(unittest.TestCase):
    def test_proxy_routes_request_and_verifies_actual_bytes_without_overwriting(self):
        requests = []
        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                requests.append(self.path)
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b"actual-proxy-response")
            def log_message(self, *args):
                pass
        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with tempfile.TemporaryDirectory() as tmp:
                proxy = f"http://127.0.0.1:{server.server_port}"
                result = download_file("http://download.invalid/source", Path(tmp), "file.txt", "proxy", proxy)
                self.assertEqual(requests[0], "http://download.invalid/source")
                self.assertEqual(result["route"], "proxy")
                self.assertEqual(result["sha256"], hashlib.sha256(b"actual-proxy-response").hexdigest())
                self.assertEqual(Path(result["path"]).read_bytes(), b"actual-proxy-response")
                with self.assertRaises(FileExistsError):
                    download_file("http://download.invalid/source", Path(tmp), "file.txt", "proxy", proxy)
                self.assertFalse(list(Path(tmp).glob(".download-*")))
                with self.assertRaises(ValueError):
                    download_file("file:///C:/private.txt", Path(tmp), "file2.txt", "direct")
                with self.assertRaises(ValueError):
                    download_file("https://example.org", Path(tmp), "../outside.txt", "direct")
                with patch("downloads.discover_proxy_url", return_value=proxy):
                    detected = download_file("http://download.invalid/detected", Path(tmp), "detected.txt", "detect")
                self.assertEqual(detected["route"], "proxy")
                self.assertEqual(detected["proxy_url"], proxy)
        finally:
            server.shutdown()
            server.server_close()
            thread.join()
