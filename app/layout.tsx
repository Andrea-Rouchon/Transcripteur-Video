import type { Metadata } from "next";
import "./globals.css";


export const metadata: Metadata = {
  title: "Transcription vidéo",
  description: "Transcription automatique de vidéos YouTube et Vimeo avec Whisper",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="fr"
      className="h-full antialiased"
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
