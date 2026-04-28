import { NextResponse } from "next/server";
import { spawn } from "child_process";

function checkCommand(command: string, args: string[]): Promise<boolean> {
    return new Promise((resolve) => {
        const proc = spawn(command, args);
        const timer = setTimeout(() => {
            proc.kill("SIGTERM");
            resolve(false);
        }, 5_000);
        proc.on("close", (code) => {
            clearTimeout(timer);
            resolve(code === 0);
        });
        proc.on("error", () => {
            clearTimeout(timer);
            resolve(false);
        });
    });
}

export async function GET() {
    const pythonBin = process.env.PYTHON_BIN ?? "python3";

    const [hasPython, hasYtDlp, hasWhisper] = await Promise.all([
        checkCommand(pythonBin, ["--version"]),
        checkCommand("yt-dlp", ["--version"]),
        checkCommand(pythonBin, ["-c", "import whisper"]),
    ]);

    const status = {
        python: hasPython,
        ytDlp: hasYtDlp,
        whisper: hasWhisper,
        ok: hasPython && hasYtDlp && hasWhisper,
    };

    return NextResponse.json(status, { status: status.ok ? 200 : 503 });
}
