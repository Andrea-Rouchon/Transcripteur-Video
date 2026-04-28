import { NextRequest } from "next/server";
import { spawn } from "child_process";
import { randomUUID, createHash } from "crypto";
import path from "path";
import fs from "fs";
import os from "os";
import { validateUrl } from "@/app/lib/validateUrl";

// ── Rate limiting ─────────────────────────────────────────────────────────────

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = parseInt(process.env.RATE_LIMIT_MAX ?? "5", 10);
const ipTimestamps = new Map<string, number[]>();

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;
  const prev = (ipTimestamps.get(ip) ?? []).filter((t) => t > windowStart);
  if (prev.length >= RATE_LIMIT_MAX) return false;
  prev.push(now);
  ipTimestamps.set(ip, prev);
  return true;
}

// ── In-memory transcript cache ────────────────────────────────────────────────

const CACHE_TTL_MS = 24 * 60 * 60_000; // 24 h

interface TranscriptResult {
  language: string;
  segments: { start: number; end: number; text: string }[];
}

interface CacheEntry {
  result: TranscriptResult;
  expiresAt: number;
}

const transcriptCache = new Map<string, CacheEntry>();

// ── Startup cleanup of orphaned temp audio files ──────────────────────────────
{
  const tmpDir = os.tmpdir();
  const oneHourAgo = Date.now() - 60 * 60_000;
  try {
    for (const file of fs.readdirSync(tmpDir)) {
      if (!file.endsWith(".mp3")) continue;
      const filePath = path.join(tmpDir, file);
      try {
        if (fs.statSync(filePath).mtimeMs < oneHourAgo) fs.unlinkSync(filePath);
      } catch {
        // best-effort
      }
    }
  } catch {
    // best-effort
  }
}

function getCacheKey(url: string, model: string): string {
  return createHash("sha256").update(`${url}::${model}`).digest("hex");
}

// ── Timeouts (configurable via env, in minutes) ──────────────────────────────

const DOWNLOAD_TIMEOUT_MS =
  parseInt(process.env.DOWNLOAD_TIMEOUT_MIN ?? "10", 10) * 60_000;
const TRANSCRIBE_TIMEOUT_MS =
  parseInt(process.env.TRANSCRIBE_TIMEOUT_MIN ?? "120", 10) * 60_000;

// ── Script runner with timeout ────────────────────────────────────────────────

function runScript(
  command: string,
  args: string[],
  timeoutMs: number,
  signal?: AbortSignal
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const proc = spawn(command, args);
    let stdout = "";
    let stderr = "";
    let settled = false;

    function settle(result: { stdout: string; stderr: string; code: number }) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolve(result);
    }

    const timer = setTimeout(() => {
      proc.kill("SIGTERM");
      settle({ stdout, stderr: stderr + "\nProcess timed out.", code: 1 });
    }, timeoutMs);

    function onAbort() {
      proc.kill("SIGTERM");
      settle({ stdout, stderr: "Annulé par l'utilisateur.", code: 130 });
    }

    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener("abort", onAbort);

    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("close", (code) => {
      settle({ stdout, stderr, code: code ?? 1 });
    });
  });
}

// ── SSE helpers ───────────────────────────────────────────────────────────────

const VALID_MODELS = ["tiny", "base", "small", "medium", "large"] as const;
type WhisperModel = (typeof VALID_MODELS)[number];

function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function errorResponse(message: string, status: number): Response {
  return new Response(sseEvent("error", { message, code: status }), {
    status,
    headers: { "Content-Type": "text/event-stream" },
  });
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  // Rate limiting
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    req.headers.get("x-real-ip") ??
    "unknown";

  if (!checkRateLimit(ip)) {
    return errorResponse("Trop de requêtes. Réessaie dans une minute.", 429);
  }

  // Parse body
  let body: { url?: string; model?: string };
  try {
    body = await req.json();
  } catch {
    return errorResponse("Corps JSON invalide.", 400);
  }

  const { url, model = "base" } = body;

  if (!url || typeof url !== "string") {
    return errorResponse("Champ 'url' manquant.", 400);
  }

  if (!validateUrl(url)) {
    return errorResponse(
      "URL non autorisée. Seuls YouTube et Vimeo sont supportés.",
      400
    );
  }

  const whisperModel: WhisperModel = VALID_MODELS.includes(
    model as WhisperModel
  )
    ? (model as WhisperModel)
    : "base";

  // Cache hit
  const cacheKey = getCacheKey(url, whisperModel);
  const cached = transcriptCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    const encoder = new TextEncoder();
    return new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              sseEvent("progress", {
                step: "cached",
                message: "Résultat trouvé en cache.",
              })
            )
          );
          controller.enqueue(
            encoder.encode(sseEvent("result", cached.result))
          );
          controller.close();
        },
      }),
      {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
        },
      }
    );
  }

  const tmpDir = os.tmpdir();
  const jobId = randomUUID();
  const audioPath = path.join(tmpDir, `${jobId}.mp3`);
  const scriptsDir = path.join(process.cwd(), "scripts");
  const pythonBin = process.env.PYTHON_BIN ?? "python3";
  const encoder = new TextEncoder();

  // Create a dedicated AbortController for the job so we are not tied to
  // req.signal's lifecycle (which may be aborted after body consumption in
  // some runtimes). We propagate client disconnects by listening to req.signal.
  const jobAbort = new AbortController();
  function onClientAbort() { jobAbort.abort(); }
  if (!req.signal.aborted) {
    req.signal.addEventListener("abort", onClientAbort, { once: true });
  }

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) =>
        controller.enqueue(encoder.encode(sseEvent(event, data)));

      try {
        // Step 1: Download audio (5-minute timeout)
        send("progress", {
          step: "downloading",
          message: "Téléchargement de l'audio en cours…",
        });

        const dlResult = await runScript(
          pythonBin,
          [path.join(scriptsDir, "download.py"), url, audioPath],
          DOWNLOAD_TIMEOUT_MS,
          jobAbort.signal
        );

        if (dlResult.code !== 0) {
          const msg = dlResult.stderr.replace(/^ERROR:\s*/i, "").trim();
          send("error", {
            message: msg || "Le téléchargement a échoué.",
            code: dlResult.code,
          });
          return;
        }

        // Step 2: Transcribe (15-minute timeout)
        send("progress", {
          step: "transcribing",
          message: `Transcription en cours avec le modèle « ${whisperModel} »… (peut prendre plusieurs minutes)`,
        });

        const trResult = await runScript(
          pythonBin,
          [path.join(scriptsDir, "transcribe.py"), audioPath, whisperModel],
          TRANSCRIBE_TIMEOUT_MS,
          jobAbort.signal
        );

        if (trResult.code !== 0) {
          const msg = trResult.stderr.replace(/^ERROR:\s*/i, "").trim();
          send("error", {
            message: msg || "La transcription a échoué.",
            code: trResult.code,
          });
          return;
        }

        let parsed: TranscriptResult;
        try {
          parsed = JSON.parse(trResult.stdout);
        } catch {
          send("error", {
            message: "Impossible d'analyser le résultat de la transcription.",
          });
          return;
        }

        // Store in cache
        transcriptCache.set(cacheKey, {
          result: parsed,
          expiresAt: Date.now() + CACHE_TTL_MS,
        });

        send("result", parsed);
      } finally {
        req.signal.removeEventListener("abort", onClientAbort);
        try {
          if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath);
        } catch {
          // best-effort cleanup
        }
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
