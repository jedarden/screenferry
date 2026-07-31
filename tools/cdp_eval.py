#!/usr/bin/env python3
"""
Evaluate an expression in a Chrome tab over the DevTools protocol.

Used by tools/devrig.sh to read `window.sfStats` off the phone without OCR-ing a
screenshot — the numbers matter too much to read them out of a JPEG.

    python3 cdp_eval.py <ws-url> '<js expression>'

Speaks just enough of the WebSocket framing to avoid a dependency; the payloads
here are small and single-frame.
"""

import base64
import json
import os
import socket
import struct
import sys
from urllib.parse import urlparse


def ws_connect(url):
    u = urlparse(url)
    sock = socket.create_connection((u.hostname, u.port or 80), timeout=10)
    key = base64.b64encode(os.urandom(16)).decode()
    path = u.path + (f"?{u.query}" if u.query else "")
    sock.sendall(
        f"GET {path} HTTP/1.1\r\n"
        f"Host: {u.hostname}:{u.port}\r\n"
        "Upgrade: websocket\r\nConnection: Upgrade\r\n"
        f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n".encode()
    )
    buf = b""
    while b"\r\n\r\n" not in buf:
        chunk = sock.recv(4096)
        if not chunk:
            raise RuntimeError("handshake closed")
        buf += chunk
    if b"101" not in buf.split(b"\r\n")[0]:
        raise RuntimeError(f"handshake failed: {buf.split(chr(13).encode())[0]!r}")
    return sock


def ws_send(sock, payload: bytes):
    header = bytearray([0x81])  # FIN + text
    mask = os.urandom(4)
    n = len(payload)
    if n < 126:
        header.append(0x80 | n)
    elif n < 65536:
        header.append(0x80 | 126)
        header += struct.pack(">H", n)
    else:
        header.append(0x80 | 127)
        header += struct.pack(">Q", n)
    header += mask
    sock.sendall(bytes(header) + bytes(b ^ mask[i % 4] for i, b in enumerate(payload)))


def ws_recv(sock) -> bytes:
    def read(n):
        out = b""
        while len(out) < n:
            c = sock.recv(n - len(out))
            if not c:
                raise RuntimeError("closed")
            out += c
        return out

    b0, b1 = read(2)
    length = b1 & 0x7F
    if length == 126:
        length = struct.unpack(">H", read(2))[0]
    elif length == 127:
        length = struct.unpack(">Q", read(8))[0]
    masked = b1 & 0x80
    mask = read(4) if masked else b""
    data = read(length)
    if masked:
        data = bytes(b ^ mask[i % 4] for i, b in enumerate(data))
    return data


def main():
    if len(sys.argv) < 3:
        print("usage: cdp_eval.py <ws-url> <expression>", file=sys.stderr)
        return 2
    ws, expr = sys.argv[1], sys.argv[2]
    sock = ws_connect(ws)
    ws_send(
        sock,
        json.dumps(
            {
                "id": 1,
                "method": "Runtime.evaluate",
                "params": {"expression": expr, "returnByValue": True, "awaitPromise": True},
            }
        ).encode(),
    )
    for _ in range(20):
        msg = json.loads(ws_recv(sock))
        if msg.get("id") == 1:
            res = msg.get("result", {}).get("result", {})
            val = res.get("value")
            if val is None:
                print(json.dumps(msg.get("result", {}), indent=2))
                return 1
            try:
                print(json.dumps(json.loads(val), indent=2))
            except (TypeError, ValueError):
                print(val)
            return 0
    print("no response", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
