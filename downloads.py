"""Download task artifacts over an explicit HTTP proxy or a direct connection."""
import hashlib
import os
import socket
import ssl
import tempfile
import urllib.request
from pathlib import Path
from urllib.parse import urlsplit


def _valid_proxy(value: str) -> str:
    """Return a safe HTTP(S) proxy URL without credentials, or an empty string."""
    value = str(value or "").strip()
    if value and "://" not in value:
        value = "http://" + value
    parsed = urlsplit(value)
    if parsed.scheme in {"http", "https"} and parsed.hostname and not parsed.username and not parsed.password:
        return value.rstrip("/")
    return ""


def discover_proxy_url() -> str:
    """Read the current host proxy on every call; no network or saved instance id is required."""
    # Explicit process settings win and work on non-Windows hosts as well.
    for key in ("HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"):
        candidate = _valid_proxy(os.environ.get(key, ""))
        if candidate:
            return candidate
    if os.name == "nt":
        try:
            import winreg
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER,
                                r"Software\Microsoft\Windows\CurrentVersion\Internet Settings") as key:
                enabled = int(winreg.QueryValueEx(key, "ProxyEnable")[0] or 0)
                raw = str(winreg.QueryValueEx(key, "ProxyServer")[0] or "") if enabled else ""
            # Windows also permits http=host:port;https=host:port.
            fields = dict(part.split("=", 1) for part in raw.split(";") if "=" in part)
            candidate = _valid_proxy(fields.get("https") or fields.get("http") or raw)
            if candidate:
                return candidate
        except (OSError, ValueError):
            pass
    # Last resort for local proxy clients whose system-proxy switch is off.
    for port in (7890, 7891, 7892, 7897, 7900, 10809, 1080):
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.04):
                return f"http://127.0.0.1:{port}"
        except OSError:
            continue
    return ""


def download_file(url: str, directory: Path, filename: str, mode="proxy", proxy_url="") -> dict:
    parsed = urlsplit(url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError("下载地址须为不含账号密码的 HTTP/HTTPS URL")
    if not filename or Path(filename).name != filename or any(c in filename for c in '/\\:') or filename in {".", ".."}:
        raise ValueError("文件名须为单个文件名，不允许路径")
    if mode not in {"proxy", "direct", "auto", "detect"}:
        raise ValueError("下载模式无效")
    proxy = urlsplit(proxy_url)
    if proxy_url and (proxy.scheme not in {"http", "https"} or not proxy.hostname or proxy.username or proxy.password):
        raise ValueError("代理地址须为不含账号密码的 HTTP/HTTPS URL")
    detected_proxy = discover_proxy_url() if mode in {"auto", "detect"} else ""
    effective_proxy = proxy_url or detected_proxy
    if mode in {"proxy", "detect"} and not effective_proxy:
        raise ValueError("代理模式尚未配置代理地址")
    directory = directory.resolve()
    directory.mkdir(parents=True, exist_ok=True)
    target = directory / filename
    routes = ([effective_proxy] if effective_proxy else []) + ([""] if mode in {"auto", "direct"} else [])
    if mode == "direct":
        routes = [""]
    for index, route in enumerate(routes):
        partial = None
        try:
            # 补充 Python 环境的公共根证书，保留系统信任与 HTTPS 校验。
            context = ssl.create_default_context()
            try:
                import certifi
            except ImportError:
                pass
            else:
                context.load_verify_locations(cafile=certifi.where())
            opener = urllib.request.build_opener(
                urllib.request.ProxyHandler({"http": route, "https": route} if route else {}),
                urllib.request.HTTPSHandler(context=context))
            req = urllib.request.Request(url, headers={"User-Agent": "AstrBot-Workgroup/1.3.1"})
            fd, partial_name = tempfile.mkstemp(prefix=".download-", dir=directory)
            partial = Path(partial_name)
            digest = hashlib.sha256()
            size = 0
            with os.fdopen(fd, "wb") as output, opener.open(req, timeout=25) as response:
                while True:
                    chunk = response.read(256 * 1024)
                    if not chunk:
                        break
                    size += len(chunk)
                    if size > 128 * 1024 * 1024:
                        raise ValueError("下载文件超过 128 MiB 上限")
                    digest.update(chunk)
                    output.write(chunk)
            if not size:
                raise ValueError("下载结果为空")
            # Atomic no-overwrite publication, including when the destination is a symlink.
            os.link(partial, target)
            return {"path": str(target), "bytes": size, "sha256": digest.hexdigest(),
                    "route": "proxy" if route else "direct",
                    "proxy_url": route if route else ""}
        except Exception as exc:
            if isinstance(exc, FileExistsError) or index == len(routes) - 1 or not isinstance(exc, (OSError, urllib.error.URLError)):
                raise
        finally:
            if partial is not None:
                partial.unlink(missing_ok=True)
    raise RuntimeError("没有可用下载通道")
