import { test, expect } from "@playwright/test";

// ── SSE helpers ───────────────────────────────────────────────────────────────

function sseEvent(event: string, data: unknown): string {
    return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

const MOCK_TRANSCRIPT = {
    language: "fr",
    segments: [
        { start: 0, end: 4.5, text: "Bonjour tout le monde" },
        { start: 4.5, end: 9, text: "Bienvenue dans cette vidéo" },
    ],
};

const YOUTUBE_URL = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe("Page principale", () => {
    test("affiche le titre et le formulaire", async ({ page }) => {
        await page.goto("/");
        await expect(
            page.getByRole("heading", { name: "Transcription vidéo" })
        ).toBeVisible();
        await expect(
            page.getByPlaceholder("https://www.youtube.com/watch?v=...")
        ).toBeVisible();
        await expect(
            page.getByRole("button", { name: "Transcrire" })
        ).toBeVisible();
    });

    test("le bouton Transcrire est désactivé sans URL", async ({ page }) => {
        await page.goto("/");
        await expect(page.getByRole("button", { name: "Transcrire" })).toBeDisabled();
    });

    test("affiche les boutons de sélection du modèle Whisper", async ({ page }) => {
        await page.goto("/");
        for (const model of ["Tiny", "Base", "Small", "Medium", "Large"]) {
            await expect(page.getByRole("radio", { name: model })).toBeVisible();
        }
    });
});

test.describe("Transcription réussie", () => {
    test.beforeEach(async ({ page }) => {
        await page.route("/api/transcribe", (route) =>
            route.fulfill({
                headers: { "Content-Type": "text/event-stream" },
                body:
                    sseEvent("progress", { step: "downloading", message: "Téléchargement…" }) +
                    sseEvent("progress", { step: "transcribing", message: "Transcription…" }) +
                    sseEvent("result", MOCK_TRANSCRIPT),
            })
        );
    });

    test("affiche les segments après transcription", async ({ page }) => {
        await page.goto("/");
        await page.fill("input[type='url']", YOUTUBE_URL);
        await page.getByRole("button", { name: "Transcrire" }).click();

        await expect(page.getByText("Bonjour tout le monde")).toBeVisible();
        await expect(page.getByText("Bienvenue dans cette vidéo")).toBeVisible();
    });

    test("affiche le badge de langue", async ({ page }) => {
        await page.goto("/");
        await page.fill("input[type='url']", YOUTUBE_URL);
        await page.getByRole("button", { name: "Transcrire" }).click();

        await expect(page.getByText("fr")).toBeVisible();
    });

    test("sauvegarde la transcription dans l'historique", async ({ page }) => {
        await page.goto("/");
        await page.fill("input[type='url']", YOUTUBE_URL);
        await page.getByRole("button", { name: "Transcrire" }).click();

        await expect(page.getByText("Bonjour tout le monde")).toBeVisible();
        await expect(
            page.getByRole("heading", { name: "Historique" })
        ).toBeVisible();
        await expect(page.getByText(YOUTUBE_URL).first()).toBeVisible();
    });

    test("permet de restaurer une transcription depuis l'historique", async ({ page }) => {
        await page.goto("/");
        await page.fill("input[type='url']", YOUTUBE_URL);
        await page.getByRole("button", { name: "Transcrire" }).click();
        await expect(page.getByText("Bonjour tout le monde")).toBeVisible();

        // Navigate away then come back — history should persist
        await page.reload();
        await expect(
            page.getByRole("heading", { name: "Historique" })
        ).toBeVisible();

        // Clicking the history entry restores the transcript
        await page.getByTitle(YOUTUBE_URL).click();
        await expect(page.getByText("Bonjour tout le monde")).toBeVisible();
    });
});

test.describe("Gestion des erreurs", () => {
    test("affiche le message d'erreur retourné par le serveur", async ({ page }) => {
        await page.route("/api/transcribe", (route) =>
            route.fulfill({
                headers: { "Content-Type": "text/event-stream" },
                body: sseEvent("error", { message: "Vidéo introuvable." }),
            })
        );

        await page.goto("/");
        await page.fill("input[type='url']", YOUTUBE_URL);
        await page.getByRole("button", { name: "Transcrire" }).click();

        await expect(page.getByRole("alert")).toBeVisible();
        await expect(page.getByText("Vidéo introuvable.")).toBeVisible();
    });
});

test.describe("Annulation", () => {
    test("affiche le bouton Annuler pendant la transcription", async ({ page }) => {
        // API qui ne répond jamais — simule une longue transcription
        await page.route("/api/transcribe", async () => {
            await new Promise((r) => setTimeout(r, 30_000));
        });

        await page.goto("/");
        await page.fill("input[type='url']", YOUTUBE_URL);
        await page.getByRole("button", { name: "Transcrire" }).click();

        await expect(
            page.getByRole("button", { name: "Annuler" })
        ).toBeVisible({ timeout: 2_000 });
    });

    test("revient à l'état initial après annulation", async ({ page }) => {
        await page.route("/api/transcribe", async () => {
            await new Promise((r) => setTimeout(r, 30_000));
        });

        await page.goto("/");
        await page.fill("input[type='url']", YOUTUBE_URL);
        await page.getByRole("button", { name: "Transcrire" }).click();

        await page.getByRole("button", { name: "Annuler" }).click();

        await expect(
            page.getByRole("button", { name: "Transcrire" })
        ).toBeEnabled({ timeout: 2_000 });
        await expect(
            page.getByRole("button", { name: "Annuler" })
        ).not.toBeVisible();
    });
});

test.describe("Historique", () => {
    test.beforeEach(async ({ page }) => {
        await page.route("/api/transcribe", (route) =>
            route.fulfill({
                headers: { "Content-Type": "text/event-stream" },
                body: sseEvent("result", MOCK_TRANSCRIPT),
            })
        );
    });

    test("permet de supprimer une entrée de l'historique", async ({ page }) => {
        await page.goto("/");
        await page.fill("input[type='url']", YOUTUBE_URL);
        await page.getByRole("button", { name: "Transcrire" }).click();
        await expect(page.getByRole("heading", { name: "Historique" })).toBeVisible();

        await page
            .getByRole("button", { name: "Supprimer cette transcription de l'historique" })
            .click();

        await expect(
            page.getByRole("heading", { name: "Historique" })
        ).not.toBeVisible();
    });

    test("permet d'effacer tout l'historique", async ({ page }) => {
        await page.goto("/");
        await page.fill("input[type='url']", YOUTUBE_URL);
        await page.getByRole("button", { name: "Transcrire" }).click();
        await expect(page.getByRole("heading", { name: "Historique" })).toBeVisible();

        await page.getByRole("button", { name: "Tout effacer" }).click();

        await expect(
            page.getByRole("heading", { name: "Historique" })
        ).not.toBeVisible();
    });
});
