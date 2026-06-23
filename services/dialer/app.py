import os
import socket
import time
import uuid
from datetime import datetime, timezone
from typing import Any

import redis
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379/0")
AMI_HOST = os.getenv("AMI_HOST", "freepbx")
AMI_PORT = int(os.getenv("AMI_PORT", "5038"))
AMI_USERNAME = os.getenv("AMI_USERNAME", "telefonia")
AMI_SECRET = os.getenv("AMI_SECRET", "telefonia_ami_dev")
DEFAULT_AGENT_EXTENSION = os.getenv("DEFAULT_AGENT_EXTENSION", "1001")
MAX_ACTIVE_DIALS = int(os.getenv("MAX_ACTIVE_DIALS", "4"))
CALL_MODE = os.getenv("CALL_MODE", "lab_internal")

redis_client = redis.Redis.from_url(REDIS_URL, decode_responses=True)
app = FastAPI(title="Sales Dialer Service", version="1.0.0")


class Lead(BaseModel):
    id: str
    name: str
    phone: str
    priority: int = 50
    status: str = "PENDING"


class DialRequest(BaseModel):
    agentExtension: str = Field(default=DEFAULT_AGENT_EXTENSION, pattern=r"^\d{2,10}$")
    campaignId: str = "default"


@app.on_event("startup")
def startup() -> None:
    seed_leads()


@app.get("/health")
def health() -> dict[str, Any]:
    redis_client.ping()
    return {
        "ok": True,
        "service": "dialer",
        "redis": True,
        "amiHost": AMI_HOST,
        "maxActiveDials": MAX_ACTIVE_DIALS,
        "callMode": CALL_MODE,
    }


@app.get("/leads")
def list_leads() -> dict[str, Any]:
    leads = [load_lead(key.split(":", 1)[1]) for key in sorted(redis_client.keys("lead:*"))]
    next_lead = next_pending_lead()
    return {
        "pending": redis_client.zcard("campaign:default:pending"),
        "nextLead": next_lead,
        "leads": [lead for lead in leads if lead is not None],
    }


@app.post("/leads")
def create_lead(lead: Lead) -> dict[str, Any]:
    save_lead(lead)
    if lead.status == "PENDING":
        redis_client.zadd("campaign:default:pending", {lead.id: lead.priority})
    return {"ok": True, "lead": lead.model_dump()}


@app.post("/dial/next")
def dial_next(request: DialRequest) -> dict[str, Any]:
    active = active_call_count()
    if active >= MAX_ACTIVE_DIALS:
        raise HTTPException(status_code=429, detail="Nodo de marcacion saturado")

    next_items = redis_client.zrevrange(f"campaign:{request.campaignId}:pending", 0, 0)
    if not next_items:
        return {"ok": False, "reason": "NO_LEADS", "message": "No hay leads pendientes"}

    lead_id = next_items[0]
    redis_client.zrem(f"campaign:{request.campaignId}:pending", lead_id)
    lead = load_lead(lead_id)
    if not lead:
        raise HTTPException(status_code=404, detail="Lead no encontrado")

    validate_destination_for_call_mode(lead["phone"])

    call_id = str(uuid.uuid4())
    now = utcnow()
    call = {
        "id": call_id,
        "leadId": lead["id"],
        "leadName": lead["name"],
        "phone": lead["phone"],
        "agentExtension": request.agentExtension,
        "status": "DIALING",
        "campaignId": request.campaignId,
        "createdAt": now,
        "updatedAt": now,
    }
    redis_client.hset(f"call:{call_id}", mapping=call)
    redis_client.sadd("calls:active", call_id)
    redis_client.hset(f"lead:{lead_id}", mapping={"status": "DIALING", "updatedAt": now})

    originate_result = originate_call(request.agentExtension, lead["phone"], call_id)
    if not originate_result["ok"]:
        redis_client.hset(f"call:{call_id}", mapping={"status": "ORIGINATE_FAILED", "updatedAt": utcnow()})
        redis_client.srem("calls:active", call_id)
        redis_client.hset(f"lead:{lead_id}", mapping={"status": "PENDING", "updatedAt": utcnow()})
        redis_client.zadd(f"campaign:{request.campaignId}:pending", {lead_id: int(lead.get("priority", 50))})

    return {
        "ok": originate_result["ok"],
        "call": redis_client.hgetall(f"call:{call_id}"),
        "lead": load_lead(lead_id),
        "asterisk": originate_result,
    }


@app.post("/calls/{call_id}/complete")
def complete_call(call_id: str, status: str = "COMPLETED") -> dict[str, Any]:
    key = f"call:{call_id}"
    if not redis_client.exists(key):
        raise HTTPException(status_code=404, detail="Llamada no encontrada")

    redis_client.hset(key, mapping={"status": status, "updatedAt": utcnow()})
    redis_client.srem("calls:active", call_id)
    return {"ok": True, "call": redis_client.hgetall(key)}


@app.get("/calls")
def list_calls() -> dict[str, Any]:
    calls = [redis_client.hgetall(key) for key in sorted(redis_client.keys("call:*"))]
    return {
        "active": active_call_count(),
        "calls": sorted(calls, key=lambda item: item.get("createdAt", ""), reverse=True),
    }


def seed_leads() -> None:
    leads = [
        Lead(id="lead-9005", name="Cliente Interesado", phone="9005", priority=95),
        Lead(id="lead-9001", name="Cliente Carlos", phone="9001", priority=88),
        Lead(id="lead-9004", name="Cliente Reclamo", phone="9004", priority=80),
        Lead(id="lead-9003", name="Cliente Empresa Demo", phone="9003", priority=70),
    ]

    if redis_client.exists("campaign:default:seeded") and all(redis_client.exists(f"lead:{lead.id}") for lead in leads):
        return

    for old_lead_id in ["lead-1002", "lead-demo-1", "lead-demo-2"]:
        redis_client.delete(f"lead:{old_lead_id}")
        redis_client.zrem("campaign:default:pending", old_lead_id)

    for lead in leads:
        save_lead(lead)
        redis_client.zadd("campaign:default:pending", {lead.id: lead.priority})

    redis_client.set("campaign:default:seeded", "true")


@app.post("/campaigns/{campaign_id}/reset")
def reset_campaign(campaign_id: str = "default") -> dict[str, Any]:
    redis_client.delete(f"campaign:{campaign_id}:pending")
    redis_client.delete("calls:active")

    for key in redis_client.keys("call:*"):
        redis_client.delete(key)

    for key in redis_client.keys("lead:*"):
        lead_id = key.split(":", 1)[1]
        lead = load_lead(lead_id)
        if not lead:
            continue
        redis_client.hset(key, mapping={"status": "PENDING", "updatedAt": utcnow()})
        redis_client.zadd(f"campaign:{campaign_id}:pending", {lead_id: int(lead.get("priority", 50))})

    return list_leads()


def save_lead(lead: Lead) -> None:
    redis_client.hset(
        f"lead:{lead.id}",
        mapping={
            **lead.model_dump(),
            "createdAt": utcnow(),
            "updatedAt": utcnow(),
        },
    )


def load_lead(lead_id: str) -> dict[str, str] | None:
    data = redis_client.hgetall(f"lead:{lead_id}")
    return data or None


def next_pending_lead() -> dict[str, str] | None:
    next_items = redis_client.zrevrange("campaign:default:pending", 0, 0)
    if not next_items:
        return None
    return load_lead(next_items[0])


def active_call_count() -> int:
    return redis_client.scard("calls:active")


def originate_call(agent_extension: str, lead_phone: str, call_id: str) -> dict[str, Any]:
    action_id = f"dialer-{call_id}"
    payload = {
        "Action": "Originate",
        "ActionID": action_id,
        "Channel": f"PJSIP/{agent_extension}",
        "Context": "sales-campaign",
        "Exten": lead_phone,
        "Priority": "1",
        "CallerID": f"Ventas <{agent_extension}>",
        "Variable": f"CALLCENTER_CALL_ID={call_id}",
        "Async": "true",
    }

    try:
        with socket.create_connection((AMI_HOST, AMI_PORT), timeout=4) as sock:
            sock.settimeout(4)
            read_ami_frame(sock)
            send_ami_action(sock, {
                "Action": "Login",
                "Username": AMI_USERNAME,
                "Secret": AMI_SECRET,
                "Events": "off",
            })
            login_response = read_ami_frame(sock)
            if "Success" not in login_response:
                return {"ok": False, "error": login_response.strip() or "AMI login failed"}
            send_ami_action(sock, payload)
            response = read_ami_frame(sock)
            send_ami_action(sock, {"Action": "Logoff"})
    except OSError as error:
        return {"ok": False, "error": str(error)}

    return {
        "ok": "Error" not in response,
        "actionId": action_id,
        "response": response.strip(),
        "channel": payload["Channel"],
        "context": payload["Context"],
    }


def validate_destination_for_call_mode(destination: str) -> None:
    if CALL_MODE == "lab_internal":
        if destination not in {"9001", "9002", "9003", "9004", "9005"}:
            raise HTTPException(
                status_code=400,
                detail="CALL_MODE=lab_internal solo permite leads internos 9001-9005",
            )
        return

    if CALL_MODE == "sip_trunk_ready":
        raise HTTPException(
            status_code=501,
            detail="CALL_MODE=sip_trunk_ready esta documentado, pero no implementa proveedor SIP real",
        )

    raise HTTPException(status_code=400, detail=f"CALL_MODE no soportado: {CALL_MODE}")


def send_ami_action(sock: socket.socket, fields: dict[str, str]) -> None:
    frame = "\r\n".join([f"{key}: {value}" for key, value in fields.items()])
    sock.sendall(f"{frame}\r\n\r\n".encode("utf-8"))


def read_ami_frame(sock: socket.socket) -> str:
    data = b""
    deadline = time.time() + 4
    while b"\r\n\r\n" not in data and time.time() < deadline:
        chunk = sock.recv(4096)
        if not chunk:
            break
        data += chunk
    return data.decode("utf-8", errors="replace")


def utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()
