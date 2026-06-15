import os
from typing import Any

import redis
from fastapi import FastAPI
from pymongo import MongoClient

REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379/0")
MONGO_URL = os.getenv("MONGO_URL", "mongodb://mongo:27017")
MONGO_DB = os.getenv("MONGO_DB", "callcenter")

redis_client = redis.Redis.from_url(REDIS_URL, decode_responses=True)
mongo = MongoClient(MONGO_URL)
db = mongo[MONGO_DB]
app = FastAPI(title="Call Center Metrics Service", version="1.0.0")


@app.get("/health")
def health() -> dict[str, Any]:
    redis_client.ping()
    mongo.admin.command("ping")
    return {"ok": True, "service": "metrics", "redis": True, "mongo": True}


@app.get("/summary")
def summary() -> dict[str, Any]:
    calls = [redis_client.hgetall(key) for key in redis_client.keys("call:*")]
    leads = [redis_client.hgetall(key) for key in redis_client.keys("lead:*")]
    transcripts = list(db["transcripts"].find())
    answered = count_status(calls, ["ANSWERED", "COMPLETED"])
    failed = count_status(calls, ["NOANSWER", "ORIGINATE_FAILED", "BUSY", "FAILED"])
    dialing = count_status(calls, ["DIALING"])
    opportunities = sum(1 for item in transcripts if item.get("analysis", {}).get("opportunity"))
    masked = sum(1 for item in transcripts if item.get("sensitiveDataMasked"))
    avg_quality = round(
        sum(float(item.get("analysis", {}).get("qualityScore", 0)) for item in transcripts) / len(transcripts),
        2,
    ) if transcripts else 0
    pending = sum(1 for lead in leads if lead.get("status") == "PENDING")

    return {
        "leadsTotal": len(leads),
        "leadsPending": pending,
        "callsTotal": len(calls),
        "callsDialing": dialing,
        "callsAnswered": answered,
        "callsFailed": failed,
        "answerRatePercent": round((answered / len(calls)) * 100) if calls else 0,
        "transcriptsTotal": len(transcripts),
        "salesOpportunities": opportunities,
        "sensitiveMasked": masked,
        "averageQualityScore": avg_quality,
    }


def count_status(calls: list[dict[str, str]], statuses: list[str]) -> int:
    expected = set(statuses)
    return sum(1 for call in calls if call.get("status") in expected)
