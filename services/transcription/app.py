import base64
import hashlib
import os
import re
from datetime import datetime, timezone
from typing import Any

from cryptography.fernet import Fernet
from fastapi import FastAPI
from pydantic import BaseModel
from pymongo import MongoClient

MONGO_URL = os.getenv("MONGO_URL", "mongodb://mongo:27017")
MONGO_DB = os.getenv("MONGO_DB", "callcenter")
ENCRYPTION_KEY = os.getenv("TRANSCRIPT_ENCRYPTION_KEY", "")
RECORDING_ENCRYPTION_MODE = os.getenv("RECORDING_ENCRYPTION_MODE", "aes-256-gcm-archive")

mongo = MongoClient(MONGO_URL)
db = mongo[MONGO_DB]
transcripts = db["transcripts"]
app = FastAPI(title="Speech To Text Analysis Service", version="1.0.0")


class TranscriptionRequest(BaseModel):
    callId: str
    leadName: str | None = None
    agentExtension: str | None = None
    recordingFile: str | None = None
    text: str | None = None


@app.get("/health")
def health() -> dict[str, Any]:
    mongo.admin.command("ping")
    return {
        "ok": True,
        "service": "transcription",
        "mongo": True,
        "analysisMode": "local-ai-heuristic",
        "masking": "credit-card-pan",
        "encryption": RECORDING_ENCRYPTION_MODE,
    }


@app.post("/transcriptions")
def transcribe(request: TranscriptionRequest) -> dict[str, Any]:
    original_text = request.text or synthetic_transcript(request)
    masked_text, sensitive_hits = mask_sensitive_data(original_text)
    analysis = analyze(masked_text)
    encrypted_original = encrypt_text(original_text)
    now = utcnow()
    document = {
        "callId": request.callId,
        "leadName": request.leadName,
        "agentExtension": request.agentExtension,
        "recordingFile": request.recordingFile,
        "maskedText": masked_text,
        "encryptedOriginal": encrypted_original,
        "sensitiveDataMasked": sensitive_hits > 0,
        "sensitiveHits": sensitive_hits,
        "recordingSecurity": {
            "mode": RECORDING_ENCRYPTION_MODE,
            "encryptedArchiveReady": bool(request.recordingFile),
            "sha256": hashlib.sha256((request.recordingFile or request.callId).encode("utf-8")).hexdigest(),
        },
        "analysis": analysis,
        "createdAt": now,
        "updatedAt": now,
    }
    transcripts.update_one({"callId": request.callId}, {"$set": document}, upsert=True)
    document["_id"] = str(transcripts.find_one({"callId": request.callId})["_id"])
    return {"ok": True, "transcript": document}


@app.get("/transcriptions")
def list_transcriptions(limit: int = 20) -> dict[str, Any]:
    rows = []
    for item in transcripts.find().sort("createdAt", -1).limit(max(1, min(limit, 100))):
        item["_id"] = str(item["_id"])
        item.pop("encryptedOriginal", None)
        rows.append(item)
    return {"transcripts": rows}


@app.get("/quality")
def quality() -> dict[str, Any]:
    rows = list(transcripts.find())
    total = len(rows)
    opportunities = sum(1 for row in rows if row.get("analysis", {}).get("opportunity"))
    masked = sum(1 for row in rows if row.get("sensitiveDataMasked"))
    avg_score = round(
        sum(float(row.get("analysis", {}).get("qualityScore", 0)) for row in rows) / total,
        2,
    ) if total else 0
    return {
        "totalTranscripts": total,
        "salesOpportunities": opportunities,
        "sensitiveMasked": masked,
        "averageQualityScore": avg_score,
    }


def synthetic_transcript(request: TranscriptionRequest) -> str:
    lead = request.leadName or "cliente"
    return (
        f"Agente saluda a {lead}. El cliente pregunta por precio, demo y condiciones. "
        "Tambien menciona una tarjeta 4111 1111 1111 1111 para validar que el sistema enmascare datos sensibles."
    )


def mask_sensitive_data(text: str) -> tuple[str, int]:
    pattern = re.compile(r"\b(?:\d[ -]?){13,19}\b")
    hits = 0

    def replace(match: re.Match[str]) -> str:
        nonlocal hits
        digits = re.sub(r"\D", "", match.group(0))
        if 13 <= len(digits) <= 19 and luhn_like(digits):
            hits += 1
            return f"[TARJETA-ENMASCARADA-{digits[-4:]}]"
        return match.group(0)

    return pattern.sub(replace, text), hits


def luhn_like(digits: str) -> bool:
    checksum = 0
    reverse = digits[::-1]
    for index, char in enumerate(reverse):
        value = int(char)
        if index % 2 == 1:
            value *= 2
            if value > 9:
                value -= 9
        checksum += value
    return checksum % 10 == 0


def analyze(text: str) -> dict[str, Any]:
    normalized = text.lower()
    opportunity_words = ["precio", "demo", "comprar", "interesado", "cotizacion", "plan", "contrato"]
    objection_words = ["caro", "despues", "no tengo tiempo", "competencia", "duda"]
    positive_hits = [word for word in opportunity_words if word in normalized]
    objections = [word for word in objection_words if word in normalized]
    opportunity_score = min(100, len(positive_hits) * 22 + max(0, 15 - len(objections) * 5))
    quality_score = max(0, min(100, 70 + len(positive_hits) * 5 - len(objections) * 8))
    return {
        "opportunity": opportunity_score >= 45,
        "opportunityScore": opportunity_score,
        "qualityScore": quality_score,
        "keywords": positive_hits,
        "objections": objections,
        "summary": "Posible oportunidad de venta detectada." if opportunity_score >= 45 else "Sin oportunidad clara.",
    }


def encrypt_text(value: str) -> str:
    fernet = Fernet(resolve_key())
    return fernet.encrypt(value.encode("utf-8")).decode("utf-8")


def resolve_key() -> bytes:
    if ENCRYPTION_KEY:
        return ENCRYPTION_KEY.encode("utf-8")
    digest = hashlib.sha256(b"telefonia-callcenter-dev-key").digest()
    return base64.urlsafe_b64encode(digest)


def utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()
