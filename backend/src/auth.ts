import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";

const enabled = process.env.AUTH_ENABLED !== "false";
const username = process.env.AUTH_USERNAME ?? "admin";
const password = process.env.AUTH_PASSWORD ?? "telefonia_admin_dev";
const tokenSecret = process.env.AUTH_TOKEN_SECRET ?? "telefonia_local_secret_change_me";
const ttlSeconds = Number(process.env.AUTH_TOKEN_TTL_SECONDS ?? 28800);

export interface AuthenticatedUser {
  username: string;
  exp: number;
}

export function authConfig() {
  return {
    enabled,
    usernameHint: enabled ? username : null,
    tokenTtlSeconds: ttlSeconds,
    defaultCredentials: username === "admin" && password === "telefonia_admin_dev"
  };
}

export function login(input: { username: string; password: string }) {
  if (!enabled) {
    return {
      token: null,
      username: input.username || "local",
      expiresAt: null
    };
  }

  if (!safeEqual(input.username, username) || !safeEqual(input.password, password)) {
    throw new Error("Credenciales invalidas");
  }

  const now = Math.floor(Date.now() / 1000);
  const exp = now + ttlSeconds;
  const payload = base64url(JSON.stringify({ sub: username, iat: now, exp }));
  const signature = sign(payload);

  return {
    token: `${payload}.${signature}`,
    username,
    expiresAt: new Date(exp * 1000).toISOString()
  };
}

export function requireAuth(request: Request, response: Response, next: NextFunction) {
  if (!enabled) {
    next();
    return;
  }

  const token = extractBearerToken(request.headers.authorization);
  const user = token ? verifyToken(token) : null;

  if (!user) {
    response.status(401).json({ error: "No autorizado" });
    return;
  }

  response.locals.user = user;
  next();
}

export function verifyToken(token: string | null | undefined): AuthenticatedUser | null {
  if (!enabled) {
    return { username: "local", exp: Number.MAX_SAFE_INTEGER };
  }

  if (!token) {
    return null;
  }

  const [payload, signature] = token.split(".");

  if (!payload || !signature || !safeEqual(sign(payload), signature)) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      sub?: string;
      exp?: number;
    };

    if (!parsed.sub || !parsed.exp || parsed.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }

    return { username: parsed.sub, exp: parsed.exp };
  } catch {
    return null;
  }
}

function extractBearerToken(header: string | undefined) {
  if (!header) {
    return null;
  }

  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? null;
}

function sign(payload: string) {
  return crypto.createHmac("sha256", tokenSecret).update(payload).digest("base64url");
}

function base64url(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}
