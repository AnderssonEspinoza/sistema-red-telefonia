import fcntl
import json
import os
import socket
import struct
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


PORT = int(os.getenv("HOST_NETWORK_AGENT_PORT", "7040"))
BIND = os.getenv("HOST_NETWORK_AGENT_BIND", "0.0.0.0")


def detect_network():
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
        probe.connect(("1.1.1.1", 80))
        ip = probe.getsockname()[0]

    interface = default_interface()
    netmask = interface_netmask(interface) if interface else None
    cidr = mask_to_cidr(netmask) if netmask else suggest_cidr(ip)

    return {
        "lanIp": ip,
        "lanCidr": cidr,
        "lanNet": network_address(ip, cidr),
        "interface": interface,
        "source": "host-network-agent",
    }


def default_interface():
    with open("/proc/net/route", "r", encoding="utf-8") as routes:
        next(routes, None)
        for line in routes:
            fields = line.split()
            if len(fields) >= 2 and fields[1] == "00000000":
                return fields[0]
    return None


def interface_netmask(interface):
    request = struct.pack("256s", interface[:15].encode())
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
        response = fcntl.ioctl(sock.fileno(), 0x891B, request)
    return socket.inet_ntoa(response[20:24])


def mask_to_cidr(mask):
    bits = "".join(f"{int(part):08b}" for part in mask.split("."))
    return bits.count("1")


def suggest_cidr(ip):
    return 16 if ip.startswith("10.") else 24


def network_address(ip, cidr):
    address = int.from_bytes(socket.inet_aton(ip), "big")
    mask = (0xFFFFFFFF << (32 - cidr)) & 0xFFFFFFFF
    return socket.inet_ntoa((address & mask).to_bytes(4, "big"))


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path not in ("/", "/detect", "/health"):
            self.send_json({"ok": False, "error": "Not found"}, 404)
            return

        try:
            payload = {"ok": True, **detect_network()}
            self.send_json(payload)
        except Exception as error:
            self.send_json({"ok": False, "error": str(error)}, 500)

    def log_message(self, format, *args):
        return

    def send_json(self, payload, status=200):
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


if __name__ == "__main__":
    ThreadingHTTPServer((BIND, PORT), Handler).serve_forever()
