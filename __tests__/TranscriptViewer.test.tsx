import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import TranscriptViewer from "@/components/TranscriptViewer";

const SEGMENTS = [
    { start: 0, end: 4.5, text: "Bonjour tout le monde" },
    { start: 4.5, end: 9, text: "Bienvenue dans cette vidéo" },
    { start: 9, end: 14, text: "Nous allons parler de Whisper" },
];

describe("TranscriptViewer", () => {
    it("renders all segments by default", () => {
        render(<TranscriptViewer segments={SEGMENTS} language="fr" />);
        SEGMENTS.forEach((seg) => {
            expect(screen.getByText(seg.text)).toBeTruthy();
        });
    });

    it("displays language badge", () => {
        render(<TranscriptViewer segments={SEGMENTS} language="fr" />);
        expect(screen.getByText("fr")).toBeTruthy();
    });

    it("filters segments on search", () => {
        render(<TranscriptViewer segments={SEGMENTS} language="fr" />);
        const input = screen.getByPlaceholderText("Rechercher dans le transcript…");
        fireEvent.change(input, { target: { value: "Whisper" } });
        expect(screen.getByText(/Whisper/)).toBeTruthy();
        expect(screen.queryByText("Bonjour tout le monde")).toBeNull();
    });

    it("shows empty state when search matches nothing", () => {
        render(<TranscriptViewer segments={SEGMENTS} language="fr" />);
        const input = screen.getByPlaceholderText("Rechercher dans le transcript…");
        fireEvent.change(input, { target: { value: "zzznotfound" } });
        expect(screen.getByText(/Aucun résultat/)).toBeTruthy();
    });

    it("shows correct segment count", () => {
        render(<TranscriptViewer segments={SEGMENTS} language="fr" />);
        expect(screen.getByText(`${SEGMENTS.length} segments`)).toBeTruthy();
    });

    it("renders export buttons", () => {
        render(<TranscriptViewer segments={SEGMENTS} language="fr" />);
        expect(screen.getByText(".txt")).toBeTruthy();
        expect(screen.getByText(".srt")).toBeTruthy();
        expect(screen.getByText(".vtt")).toBeTruthy();
    });
});
