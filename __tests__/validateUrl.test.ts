import { describe, it, expect } from "vitest";
import { validateUrl } from "@/app/lib/validateUrl";

describe("validateUrl", () => {
    it("accepts standard YouTube URLs", () => {
        expect(validateUrl("https://www.youtube.com/watch?v=abc123")).toBe(true);
        expect(validateUrl("https://youtube.com/watch?v=abc123")).toBe(true);
        expect(validateUrl("https://youtu.be/abc123")).toBe(true);
    });

    it("accepts Vimeo URLs", () => {
        expect(validateUrl("https://vimeo.com/123456789")).toBe(true);
        expect(validateUrl("https://www.vimeo.com/123456789")).toBe(true);
    });

    it("rejects URLs from other domains", () => {
        expect(validateUrl("https://evil.com/watch?v=abc")).toBe(false);
        expect(validateUrl("https://notyoutube.com/watch?v=abc")).toBe(false);
        expect(validateUrl("https://fakeyoutube.com/abc")).toBe(false);
    });

    it("rejects non-http protocols", () => {
        expect(validateUrl("ftp://youtube.com/watch?v=abc")).toBe(false);
        expect(validateUrl("javascript://youtube.com")).toBe(false);
    });

    it("rejects malformed URLs", () => {
        expect(validateUrl("not-a-url")).toBe(false);
        expect(validateUrl("")).toBe(false);
    });

    it("rejects subdomain injection attempts", () => {
        // e.g. youtube.com.evil.com — host ends with evil.com, not youtube.com
        expect(validateUrl("https://youtube.com.evil.com/watch?v=abc")).toBe(false);
    });
});
