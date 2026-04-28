"use client";

import { useState, useEffect, useRef, FormEvent } from "react";
import TranscriptViewer from "@/components/TranscriptViewer";

interface Segment {
  start: number;
  end: number;
  text: string;
}

type Status = "idle" | "loading" | "success" | "error";

interface HistoryEntry {
  id: string;
  url: string;
  model: string;
  language: string;
  segments: Segment[];
  createdAt: number;
}

const WHISPER_MODELS = [
  { value: "tiny", label: "Tiny", hint: "Très rapide, moins précis" },
  { value: "base", label: "Base", hint: "Équilibre vitesse / précision" },
  { value: "small", label: "Small", hint: "Bonne précision" },
  { value: "medium", label: "Medium", hint: "Haute précision, plus lent" },
  { value: "large", label: "Large", hint: "Meilleure précision, très lent" },
] as const;

// ── SSE parser ─────────────────────────────────────────────────────────────────

function* parseSSEBuffer(
  buffer: string
): Generator<{ event: string; data: string }> {
  const blocks = buffer.split("\n\n");
  for (const block of blocks) {
    if (!block.trim()) continue;
    let event = "message";
    let data = "";
    for (const line of block.split("\n")) {
      if (line.startsWith("event: ")) event = line.slice(7).trim();
      else if (line.startsWith("data: ")) data = line.slice(6).trim();
    }
    if (data) yield { event, data };
  }
}

export default function Home() {
  const [url, setUrl] = useState("");
  const [model, setModel] = useState("base");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");
  const [segments, setSegments] = useState<Segment[]>([]);
  const [language, setLanguage] = useState("");
  const [progressMessage, setProgressMessage] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const elapsedRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  useEffect(() => {
    if (status === "loading") {
      setElapsed(0);
      elapsedRef.current = setInterval(() => setElapsed((s) => s + 1), 1000);
    } else {
      if (elapsedRef.current) clearInterval(elapsedRef.current);
    }
    return () => { if (elapsedRef.current) clearInterval(elapsedRef.current); };
  }, [status]);

  useEffect(() => {
    try {
      const stored = localStorage.getItem("transcription-history");
      if (stored) setHistory(JSON.parse(stored));
    } catch {
      // ignore
    }
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;

    const controller = new AbortController();
    abortControllerRef.current = controller;

    setStatus("loading");
    setError("");
    setSegments([]);
    setLanguage("");
    setProgressMessage("Initialisation…");

    try {
      const res = await fetch("/api/transcribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim(), model }),
        signal: controller.signal,
      });

      if (!res.body) throw new Error("Pas de réponse du serveur.");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let resultReceived = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // SSE events are delimited by double newlines; keep the trailing partial block
        const lastSep = buffer.lastIndexOf("\n\n");
        if (lastSep === -1) continue;
        const complete = buffer.slice(0, lastSep + 2);
        buffer = buffer.slice(lastSep + 2);

        for (const { event, data } of parseSSEBuffer(complete)) {
          let parsed: unknown;
          try {
            parsed = JSON.parse(data);
          } catch {
            continue;
          }

          if (event === "progress") {
            setProgressMessage((parsed as { message: string }).message);
          } else if (event === "result") {
            const r = parsed as { segments: Segment[]; language: string };
            resultReceived = true;
            setSegments(r.segments ?? []);
            setLanguage(r.language ?? "");
            setStatus("success");
            const entry: HistoryEntry = {
              id: crypto.randomUUID(),
              url: url.trim(),
              model,
              language: r.language ?? "",
              segments: r.segments ?? [],
              createdAt: Date.now(),
            };
            setHistory((prev) => {
              const updated = [entry, ...prev].slice(0, 10);
              try { localStorage.setItem("transcription-history", JSON.stringify(updated)); } catch { /* ignore */ }
              return updated;
            });
          } else if (event === "error") {
            throw new Error(
              (parsed as { message: string }).message ?? "Une erreur est survenue."
            );
          }
        }
      }

      if (!resultReceived) {
        setStatus("error");
        setError("Transcription interrompue. Veuillez réessayer.");
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") {
        setStatus("idle");
        return;
      }
      setError(err instanceof Error ? err.message : "Une erreur est survenue.");
      setStatus("error");
    } finally {
      abortControllerRef.current = null;
    }
  }

  function handleCancel() {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setStatus("idle");
    setProgressMessage("");
  }

  function handleRestoreFromHistory(entry: HistoryEntry) {
    setUrl(entry.url);
    setModel(entry.model);
    setSegments(entry.segments);
    setLanguage(entry.language);
    setStatus("success");
    setError("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function handleDeleteHistoryEntry(id: string) {
    setHistory((prev) => {
      const updated = prev.filter((e) => e.id !== id);
      try { localStorage.setItem("transcription-history", JSON.stringify(updated)); } catch { /* ignore */ }
      return updated;
    });
  }

  function handleClearHistory() {
    setHistory([]);
    try { localStorage.removeItem("transcription-history"); } catch { /* ignore */ }
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-950 to-slate-900 px-4 py-16">
      <div className="max-w-2xl mx-auto">
        <div className="text-center mb-10">
          <h1 className="text-3xl font-bold text-gray-100 mb-2">
            Transcription vidéo
          </h1>
          <p className="text-gray-400 text-sm">
            Collez un lien YouTube ou Vimeo et obtenez le transcript horodaté
            en quelques secondes.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="flex gap-2">
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://www.youtube.com/watch?v=..."
              required
              disabled={status === "loading"}
              className="flex-1 rounded-xl border border-gray-600 px-4 py-3 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 disabled:opacity-50 bg-gray-900"
            />
            <button
              type="submit"
              disabled={status === "loading" || !url.trim()}
              className="px-5 py-3 rounded-xl bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
            >
              {status === "loading" ? "En cours…" : "Transcrire"}
            </button>
          </div>

          <div className="flex items-center gap-3">
            <span id="model-label" className="text-xs text-gray-400 shrink-0">Modèle Whisper :</span>
            <div className="flex gap-1.5 flex-wrap" role="radiogroup" aria-labelledby="model-label">
              {WHISPER_MODELS.map(({ value, label, hint }) => (
                <button
                  key={value}
                  type="button"
                  title={hint}
                  disabled={status === "loading"}
                  onClick={() => setModel(value)}
                  role="radio"
                  aria-checked={model === value}
                  className={`text-xs px-3 py-1 rounded-full border transition-colors disabled:opacity-50 ${model === value
                    ? "bg-indigo-600 text-white border-indigo-600"
                    : "border-gray-600 text-gray-400 hover:bg-gray-800"
                    }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {(model === "large" || model === "medium") && (
            <p className="text-xs text-amber-300 bg-amber-950/40 border border-amber-800 rounded-md px-3 py-2">
              ⚠️ Le modèle <strong>{model}</strong> est très lent sur CPU
              (~5–10× la durée de la vidéo). Pour une vidéo de 10 min, prévoir
              jusqu&apos;à 1–2 h.
            </p>
          )}
        </form>

        {status === "loading" && (
          <div className="mt-8 flex flex-col items-center gap-3 text-gray-400" aria-live="polite">
            <div
              className="w-8 h-8 border-4 border-indigo-900 border-t-indigo-600 rounded-full animate-spin"
              role="status"
              aria-label="Transcription en cours"
            />
            <p className="text-sm text-center">{progressMessage}</p>
            <p className="text-xs text-gray-500">{elapsed}s écoulée{elapsed > 1 ? "s" : ""}</p>
            <button
              type="button"
              onClick={handleCancel}
              className="mt-1 text-xs text-gray-500 hover:text-red-500 underline transition-colors"
            >
              Annuler
            </button>
          </div>
        )}

        {status === "error" && (
          <div
            role="alert"
            className="mt-6 rounded-xl border border-red-800 bg-red-950/40 px-4 py-3 text-sm text-red-300"
          >
            {error}
          </div>
        )}

        {status === "success" && segments.length > 0 && (
          <TranscriptViewer segments={segments} language={language} />
        )}

        {status === "success" && segments.length === 0 && (
          <div className="mt-6 text-center text-sm text-gray-400">
            Aucun segment de transcription trouvé.
          </div>
        )}

        {history.length > 0 && (
          <section className="mt-12" aria-labelledby="history-heading">
            <div className="flex items-center justify-between mb-3">
              <h2 id="history-heading" className="text-sm font-semibold text-gray-300">
                Historique
              </h2>
              <button
                type="button"
                onClick={handleClearHistory}
                className="text-xs text-gray-500 hover:text-red-500 transition-colors"
              >
                Tout effacer
              </button>
            </div>
            <ul className="flex flex-col gap-2">
              {history.map((entry) => (
                <li
                  key={entry.id}
                  className="flex items-center justify-between rounded-xl border border-gray-700 bg-gray-900 px-4 py-3 text-sm shadow-sm"
                >
                  <button
                    type="button"
                    onClick={() => handleRestoreFromHistory(entry)}
                    className="flex-1 text-left min-w-0"
                    title={entry.url}
                  >
                    <span className="block truncate text-gray-200 font-medium">{entry.url}</span>
                    <span className="text-xs text-gray-500">
                      {new Date(entry.createdAt).toLocaleString()} · {entry.model}
                      {entry.language ? ` · ${entry.language}` : ""}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteHistoryEntry(entry.id)}
                    aria-label="Supprimer cette transcription de l'historique"
                    className="ml-3 text-gray-600 hover:text-red-400 transition-colors shrink-0"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </main>
  );
}
