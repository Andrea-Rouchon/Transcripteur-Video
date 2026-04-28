"use client";

import { useState, useMemo } from "react";

interface Segment {
  start: number;
  end: number;
  text: string;
}

interface TranscriptViewerProps {
  segments: Segment[];
  language: string;
}

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}


function downloadBlob(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function TranscriptViewer({ segments, language }: TranscriptViewerProps) {
  const [copied, setCopied] = useState(false);
  const [query, setQuery] = useState("");

  const fullText = useMemo(
    () => segments.map((seg) => seg.text).join("\n"),
    [segments]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return segments;
    return segments.filter((seg) => seg.text.toLowerCase().includes(q));
  }, [segments, query]);

  function handleCopy() {
    navigator.clipboard.writeText(fullText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="mt-6 w-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold text-gray-200">Transcript</h2>
          {language && (
            <span className="text-xs bg-gray-800 text-gray-400 px-2 py-0.5 rounded-full uppercase">
              {language}
            </span>
          )}
          <span className="text-xs text-gray-500">{segments.length} segments</span>
        </div>

        <div className="flex gap-2 flex-wrap">
          <button
            onClick={handleCopy}
            className="text-sm px-3 py-1.5 rounded-md border border-gray-600 hover:bg-gray-800 text-gray-400 transition-colors"
          >
            {copied ? "Copié !" : "Copier"}
          </button>
          <button
            onClick={() => downloadBlob(fullText, "transcript.txt", "text/plain")}
            className="text-sm px-3 py-1.5 rounded-md bg-gray-800 text-white hover:bg-gray-700 transition-colors"
          >
            Télécharger .txt
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="mb-3">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Rechercher dans le transcript…"
          className="w-full rounded-xl border border-gray-600 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-gray-900"
        />
        {query.trim() && (
          <p className="mt-1 text-xs text-gray-500">
            {filtered.length} résultat{filtered.length !== 1 ? "s" : ""} sur {segments.length}
          </p>
        )}
      </div>

      {/* Segments */}
      <div className="rounded-xl border border-gray-700 bg-gray-900 overflow-hidden divide-y divide-gray-800">
        {filtered.length === 0 ? (
          <p className="px-4 py-6 text-sm text-center text-gray-500">
            Aucun résultat pour « {query} ».
          </p>
        ) : (
          filtered.map((seg, i) => {
            const q = query.trim().toLowerCase();
            const parts = q
              ? seg.text.split(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi"))
              : [seg.text];

            return (
              <div key={i} className="flex gap-4 px-4 py-3 hover:bg-gray-800 transition-colors">
                <span className="shrink-0 text-xs font-mono text-indigo-400 pt-0.5 w-14 text-right">
                  {formatTime(seg.start)}
                </span>
                <p className="text-sm text-gray-300 leading-relaxed">
                  {parts.map((part, j) =>
                    part.toLowerCase() === q ? (
                      <mark key={j} className="bg-yellow-600/60 text-gray-100 rounded-sm px-0.5">
                        {part}
                      </mark>
                    ) : (
                      part
                    )
                  )}
                </p>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
