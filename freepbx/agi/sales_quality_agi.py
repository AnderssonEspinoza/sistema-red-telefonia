#!/usr/bin/env python3
import json
import os
import sys
import urllib.request
from datetime import datetime, timezone

TRANSCRIPTION_URL = os.getenv("TRANSCRIPTION_SERVICE_URL", "http://transcription-service:7020")


def read_agi_env() -> dict[str, str]:
    env: dict[str, str] = {}
    while True:
        line = sys.stdin.readline().strip()
        if line == "":
            break
        if ":" in line:
            key, value = line.split(":", 1)
            env[key.strip()] = value.strip()
    return env


def agi_command(command: str) -> None:
    sys.stdout.write(command + "\n")
    sys.stdout.flush()
    sys.stdin.readline()


def post_transcription(payload: dict[str, str]) -> None:
    data = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        f"{TRANSCRIPTION_URL}/transcriptions",
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        urllib.request.urlopen(request, timeout=2).read()
    except Exception:
        return


def main() -> None:
    env = read_agi_env()
    call_id = env.get("agi_arg_1") or env.get("agi_uniqueid") or datetime.now(timezone.utc).isoformat()
    caller = env.get("agi_callerid", "")
    extension = env.get("agi_extension", "")
    agi_command('VERBOSE "Sales quality AGI started" 1')
    agi_command(f'SET VARIABLE CALLCENTER_AGI_SEEN "{call_id}"')
    post_transcription(
        {
            "callId": call_id,
            "leadName": extension,
            "agentExtension": caller,
            "text": (
                f"Llamada de ventas iniciada por AGI. Cliente {extension}. "
                "El cliente consulta por precio, demo y contrato."
            ),
        }
    )
    agi_command('VERBOSE "Sales quality AGI finished" 1')


if __name__ == "__main__":
    main()
