// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "events";

// ── Mocks (hoisted before imports) ────────────────────────────────────────────

vi.mock("child_process", () => ({ spawn: vi.fn() }));

vi.mock("fs", async (importOriginal) => {
    const actual = await importOriginal<typeof import("fs")>();
    return {
        ...actual,
        existsSync: vi.fn(() => false),
        unlinkSync: vi.fn(),
        readdirSync: vi.fn(() => []),
        statSync: vi.fn(() => ({ mtimeMs: Date.now() })),
    };
});

import { spawn } from "child_process";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/transcribe/route";

// ── Helpers ───────────────────────────────────────────────────────────────────

type MockedSpawn = ReturnType<typeof vi.fn>;

/** Simulates a subprocess that emits stdout/stderr then closes. */
function createMockProc(stdout: string, stderr: string, exitCode: number) {
    const proc = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter;
        stderr: EventEmitter;
        kill: ReturnType<typeof vi.fn>;
    };
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.kill = vi.fn();
    setImmediate(() => {
        if (stdout) proc.stdout.emit("data", Buffer.from(stdout));
        if (stderr) proc.stderr.emit("data", Buffer.from(stderr));
        proc.emit("close", exitCode);
    });
    return proc;
}

/** Builds a NextRequest with a JSON body and optional IP header. */
function makeRequest(body: unknown, ip = "1.2.3.4") {
    return new NextRequest(
        new Request("http://localhost/api/transcribe", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-forwarded-for": ip,
            },
            body: JSON.stringify(body),
        })
    );
}

/** Reads a streaming Response body and parses SSE events. */
async function readSSE(
    res: Response
): Promise<Array<{ event: string; data: unknown }>> {
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let text = "";
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
    }

    const events: Array<{ event: string; data: unknown }> = [];
    for (const block of text.split("\n\n")) {
        if (!block.trim()) continue;
        let event = "message";
        let data = "";
        for (const line of block.split("\n")) {
            if (line.startsWith("event: ")) event = line.slice(7).trim();
            else if (line.startsWith("data: ")) data = line.slice(6).trim();
        }
        if (data) {
            try {
                events.push({ event, data: JSON.parse(data) });
            } catch {
                // ignore malformed
            }
        }
    }
    return events;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

// Use a unique IP counter per test group to avoid rate-limit cross-contamination
let ipCounter = 100;
function nextIp() {
    return `10.0.${Math.floor(ipCounter / 255)}.${ipCounter++ % 255}`;
}

beforeEach(() => {
    (spawn as unknown as MockedSpawn).mockReset();
});

describe("POST /api/transcribe — input validation", () => {
    it("returns 400 for missing url field", async () => {
        const res = await POST(makeRequest({}, nextIp()));
        expect(res.status).toBe(400);
        const events = await readSSE(res);
        expect(events[0].event).toBe("error");
        expect((events[0].data as { message: string }).message).toMatch(/url/i);
    });

    it("returns 400 for invalid JSON body", async () => {
        const req = new NextRequest(
            new Request("http://localhost/api/transcribe", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "x-forwarded-for": nextIp(),
                },
                body: "not json",
            })
        );
        const res = await POST(req);
        expect(res.status).toBe(400);
    });

    it("returns 400 for a non-whitelisted domain", async () => {
        const res = await POST(
            makeRequest({ url: "https://evil.com/video" }, nextIp())
        );
        expect(res.status).toBe(400);
        const events = await readSSE(res);
        expect(events[0].event).toBe("error");
    });

    it("returns 400 for a subdomain injection attempt", async () => {
        const res = await POST(
            makeRequest(
                { url: "https://youtube.com.evil.com/watch?v=abc" },
                nextIp()
            )
        );
        expect(res.status).toBe(400);
    });
});

describe("POST /api/transcribe — rate limiting", () => {
    it("returns 429 after exceeding the request limit", async () => {
        const ip = nextIp();

        // Make RATE_LIMIT_MAX (5) requests. We use an invalid URL so the handler
        // returns early before touching spawn — no mock setup needed.
        for (let i = 0; i < 5; i++) {
            await POST(makeRequest({ url: "https://www.youtube.com/watch?v=rl" + i }, ip));
        }

        // 6th request should be rate-limited
        const res = await POST(
            makeRequest({ url: "https://www.youtube.com/watch?v=rl99" }, ip)
        );
        expect(res.status).toBe(429);
        const events = await readSSE(res);
        expect(events[0].event).toBe("error");
    });
});

describe("POST /api/transcribe — subprocess handling", () => {
    it("streams a result event on successful transcription", async () => {
        const spawnMock = spawn as unknown as MockedSpawn;
        const transcriptData = JSON.stringify({
            language: "fr",
            segments: [{ start: 0, end: 4, text: "Bonjour" }],
        });

        spawnMock
            .mockReturnValueOnce(createMockProc("", "", 0) as never) // download OK
            .mockReturnValueOnce(createMockProc(transcriptData, "", 0) as never); // transcribe OK

        const res = await POST(
            makeRequest(
                { url: "https://www.youtube.com/watch?v=success1" },
                nextIp()
            )
        );
        const events = await readSSE(res);

        const result = events.find((e) => e.event === "result");
        expect(result).toBeDefined();
        expect((result!.data as { language: string }).language).toBe("fr");
        expect(
            (result!.data as { segments: unknown[] }).segments
        ).toHaveLength(1);
    });

    it("streams an error event when download fails", async () => {
        const spawnMock = spawn as unknown as MockedSpawn;
        spawnMock.mockReturnValueOnce(
            createMockProc("", "ERROR: Video unavailable", 1) as never
        );

        const res = await POST(
            makeRequest(
                { url: "https://www.youtube.com/watch?v=dlfail1" },
                nextIp()
            )
        );
        const events = await readSSE(res);

        const error = events.find((e) => e.event === "error");
        expect(error).toBeDefined();
        expect((error!.data as { message: string }).message).toMatch(
            /Video unavailable/i
        );
    });

    it("streams an error event when transcription fails", async () => {
        const spawnMock = spawn as unknown as MockedSpawn;
        spawnMock
            .mockReturnValueOnce(createMockProc("", "", 0) as never) // download OK
            .mockReturnValueOnce(
                createMockProc("", "ERROR: out of memory", 1) as never
            ); // transcribe fails

        const res = await POST(
            makeRequest(
                { url: "https://www.youtube.com/watch?v=trfail1" },
                nextIp()
            )
        );
        const events = await readSSE(res);

        const error = events.find((e) => e.event === "error");
        expect(error).toBeDefined();
        expect((error!.data as { message: string }).message).toMatch(
            /out of memory/i
        );
    });

    it("streams an error event when transcription output is not valid JSON", async () => {
        const spawnMock = spawn as unknown as MockedSpawn;
        spawnMock
            .mockReturnValueOnce(createMockProc("", "", 0) as never) // download OK
            .mockReturnValueOnce(
                createMockProc("not valid json", "", 0) as never
            ); // bad output

        const res = await POST(
            makeRequest(
                { url: "https://www.youtube.com/watch?v=badjson1" },
                nextIp()
            )
        );
        const events = await readSSE(res);

        const error = events.find((e) => e.event === "error");
        expect(error).toBeDefined();
        expect((error!.data as { message: string }).message).toMatch(/analyser/i);
    });

    it("uses cached result on second request with same url+model", async () => {
        const spawnMock = spawn as unknown as MockedSpawn;
        const transcriptData = JSON.stringify({
            language: "en",
            segments: [{ start: 0, end: 2, text: "Hello" }],
        });

        // First request: populate the cache
        spawnMock
            .mockReturnValueOnce(createMockProc("", "", 0) as never)
            .mockReturnValueOnce(createMockProc(transcriptData, "", 0) as never);

        const url = "https://www.youtube.com/watch?v=cachetest99";
        const ip1 = nextIp();
        const res1 = await POST(makeRequest({ url, model: "base" }, ip1));
        await readSSE(res1); // consume stream

        // Second request: should use cache — spawn must NOT be called again
        spawnMock.mockClear();
        const ip2 = nextIp();
        const res2 = await POST(makeRequest({ url, model: "base" }, ip2));
        const events2 = await readSSE(res2);

        expect(spawnMock).not.toHaveBeenCalled();
        const cached = events2.find(
            (e) =>
                e.event === "progress" &&
                (e.data as { step: string }).step === "cached"
        );
        expect(cached).toBeDefined();
        expect(events2.find((e) => e.event === "result")).toBeDefined();
    });
});
