import {
  CreateBucketCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client
} from "@aws-sdk/client-s3";
import {
  CreateQueueCommand,
  GetQueueUrlCommand,
  ListQueuesCommand,
  SendMessageCommand,
  SQSClient
} from "@aws-sdk/client-sqs";
import { CircuitBreaker } from "./circuitBreaker.js";
import { assertSupplierAvailable, type DemoSupplier } from "./demoFailures.js";

const enabled = process.env.FLOCI_ENABLED !== "false";
const endpoint = process.env.FLOCI_ENDPOINT ?? "http://floci:4566";
const region = process.env.FLOCI_REGION ?? "us-east-1";
const queueName = process.env.CALL_EVENTS_QUEUE_NAME ?? "call-events";
const bucketName = process.env.EVIDENCE_BUCKET_NAME ?? "telefonia-evidencias";
const credentials = {
  accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? "test",
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? "test"
};

const sqsClient = new SQSClient({ endpoint, region, credentials });
const s3Client = new S3Client({ endpoint, region, credentials, forcePathStyle: true });
const sqsCircuit = new CircuitBreaker("floci-sqs", 3, 15000);
const s3Circuit = new CircuitBreaker("floci-s3", 3, 15000);

let queueUrl: string | null = null;
let bucketReady = false;
let sqsLastError: string | null = null;
let s3LastError: string | null = null;

export interface PublishCallEventResult {
  queueUrl: string | null;
  evidenceKey: string | null;
}

export async function initFloci() {
  if (!enabled) {
    return;
  }

  await Promise.all([ensureQueue(), ensureBucket()]);
}

export async function publishCallEvent(event: Record<string, unknown>): Promise<PublishCallEventResult> {
  if (!enabled) {
    return { queueUrl: null, evidenceKey: null };
  }

  const body = JSON.stringify({
    ...event,
    publishedAt: new Date().toISOString()
  });

  let evidenceKey: string | null = null;

  await sqsCircuit
    .execute(async () => {
      assertSupplierAvailable("floci-sqs");
      await ensureQueue();

      if (!queueUrl) {
        throw new Error("Floci SQS queue URL is not available");
      }

      await sqsClient.send(
        new SendMessageCommand({
          QueueUrl: queueUrl,
          MessageBody: body
        })
      );
      sqsLastError = null;
    })
    .catch((error: unknown) => {
      sqsLastError = error instanceof Error ? error.message : String(error);
    });

  await s3Circuit
    .execute(async () => {
      assertSupplierAvailable("floci-s3");
      await ensureBucket();

      const key = buildEvidenceKey(event);
      await s3Client.send(
        new PutObjectCommand({
          Bucket: bucketName,
          Key: key,
          Body: body,
          ContentType: "application/json"
        })
      );
      evidenceKey = key;
      s3LastError = null;
    })
    .catch((error: unknown) => {
      s3LastError = error instanceof Error ? error.message : String(error);
    });

  return { queueUrl, evidenceKey };
}

export async function checkFloci() {
  if (!enabled) {
    return {
      enabled,
      ok: true,
      endpoint,
      queueName,
      queueUrl: null,
      bucketName,
      bucketReady: false,
      circuit: sqsCircuit.snapshot(),
      lastError: null,
      sqs: supplierStatus(true, sqsCircuit, null, { queueUrl: null }),
      s3: supplierStatus(true, s3Circuit, null, { bucketName, bucketReady: false })
    };
  }

  const [sqs, s3] = await Promise.all([checkSqs(), checkS3()]);
  const lastError = [sqs.error, s3.error].filter(Boolean).join(" | ") || null;

  return {
    enabled,
    ok: sqs.ok && s3.ok,
    endpoint,
    queueName,
    queueUrl,
    bucketName,
    bucketReady,
    circuit: sqsCircuit.snapshot(),
    lastError,
    sqs: supplierStatus(sqs.ok, sqsCircuit, sqs.error, { queueUrl }),
    s3: supplierStatus(s3.ok, s3Circuit, s3.error, { bucketName, bucketReady })
  };
}

export function flociStatus() {
  return {
    enabled,
    endpoint,
    queueName,
    queueUrl,
    bucketName,
    bucketReady,
    sqs: supplierStatus(sqsLastError === null, sqsCircuit, sqsLastError, { queueUrl }),
    s3: supplierStatus(s3LastError === null, s3Circuit, s3LastError, { bucketName, bucketReady })
  };
}

export function setFlociCircuitDemo(supplier: DemoSupplier, open: boolean) {
  const circuit = supplier === "floci-sqs" ? sqsCircuit : supplier === "floci-s3" ? s3Circuit : null;

  if (!circuit) {
    return;
  }

  if (open) {
    circuit.forceOpen();
  } else {
    circuit.success();
  }
}

async function ensureQueue() {
  if (queueUrl) {
    return;
  }

  try {
    const existing = await sqsClient.send(new GetQueueUrlCommand({ QueueName: queueName }));
    queueUrl = existing.QueueUrl ?? null;
  } catch {
    const created = await sqsClient.send(new CreateQueueCommand({ QueueName: queueName }));
    queueUrl = created.QueueUrl ?? null;
  }
}

async function ensureBucket() {
  if (bucketReady) {
    return;
  }

  try {
    await s3Client.send(new HeadBucketCommand({ Bucket: bucketName }));
  } catch {
    await s3Client.send(new CreateBucketCommand({ Bucket: bucketName })).catch((error: unknown) => {
      const name = typeof error === "object" && error !== null && "name" in error ? String(error.name) : "";

      if (!["BucketAlreadyOwnedByYou", "BucketAlreadyExists"].includes(name)) {
        throw error;
      }
    });
  }

  bucketReady = true;
}

async function checkSqs() {
  try {
    await sqsCircuit.execute(async () => {
      assertSupplierAvailable("floci-sqs");
      await ensureQueue();
      await sqsClient.send(new ListQueuesCommand({ MaxResults: 1 }));
    });
    sqsLastError = null;
    return { ok: true, error: null };
  } catch (error) {
    sqsLastError = error instanceof Error ? error.message : String(error);
    return { ok: false, error: sqsLastError };
  }
}

async function checkS3() {
  try {
    await s3Circuit.execute(async () => {
      assertSupplierAvailable("floci-s3");
      await ensureBucket();
      await s3Client.send(new HeadBucketCommand({ Bucket: bucketName }));
    });
    s3LastError = null;
    return { ok: true, error: null };
  } catch (error) {
    bucketReady = false;
    s3LastError = error instanceof Error ? error.message : String(error);
    return { ok: false, error: s3LastError };
  }
}

function supplierStatus(
  ok: boolean,
  circuit: CircuitBreaker,
  error: string | null,
  extra: Record<string, unknown>
) {
  return {
    ok,
    circuit: circuit.snapshot(),
    lastError: error,
    ...extra
  };
}

function buildEvidenceKey(event: Record<string, unknown>) {
  const id = sanitizeKeyPart(String(event.id ?? event.amiLinkedId ?? event.amiUniqueId ?? "sin-id"));
  const estado = sanitizeKeyPart(String(event.estado ?? "evento"));
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `llamadas/${id}/${timestamp}-${estado}.json`;
}

function sanitizeKeyPart(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80);
}
