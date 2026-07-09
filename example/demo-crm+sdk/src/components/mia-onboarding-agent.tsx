"use client";

import { useEffect } from "react";

import { AIOnboardingAgent } from "@mia/onboarding-agent";

declare global {
  interface Window {
    __miaOnboardingAgentInitialized?: boolean;
  }
}

export function MiaOnboardingAgent() {
  const askMia = (text: string) => {
    void AIOnboardingAgent.ask(text).catch((error) => {
      console.error("Mia demo prompt failed", error);
    });
  };

  useEffect(() => {
    if (window.__miaOnboardingAgentInitialized) return;

    const appId = process.env.NEXT_PUBLIC_MIA_APP_ID;
    const backendUrl = process.env.NEXT_PUBLIC_MIA_BACKEND_URL;

    if (!appId || !backendUrl) {
      console.warn("Mia SDK is not initialized. Configure NEXT_PUBLIC_MIA_APP_ID and NEXT_PUBLIC_MIA_BACKEND_URL.");
      return;
    }

    AIOnboardingAgent.init({
      appId,
      backendUrl,
      tokenProvider: async () => {
        const response = await fetch("/api/mia/runtime-token", { method: "POST" });
        const result = await response.json();
        if (!response.ok || !result?.token) {
          throw new Error(result?.error?.message ?? "Unable to create a Mia runtime token.");
        }
        return { token: result.token, expiresAt: result.expiresAt };
      },
      enableVoice: process.env.NEXT_PUBLIC_MIA_ENABLE_VOICE === "true",
      enableScreenShare: process.env.NEXT_PUBLIC_MIA_ENABLE_SCREEN === "true",
      user: {
        id: process.env.NEXT_PUBLIC_MIA_DEMO_USER_ID ?? "demo-crm-user",
        role: "demo-user",
        metadata: {
          source: "demo-crm-sdk",
        },
      },
      privacy: {
        redactText: false,
        allowUnredactedScreenShare: process.env.NEXT_PUBLIC_MIA_ALLOW_UNREDACTED_SCREEN === "true",
      },
      voice: {
        voiceName: "Aoede",
      },
      ui: {
        theme: "auto",
        cursorOffset: { x: 20, y: 20 },
        bubbleMaxWidth: 320,
      },
    });

    window.__miaOnboardingAgentInitialized = true;
    return () => {
      AIOnboardingAgent.destroy();
      window.__miaOnboardingAgentInitialized = false;
    };
  }, []);

  return (
    <aside
      className="fixed right-4 bottom-24 z-40 hidden w-72 rounded-lg border bg-background/95 p-3 shadow-sm backdrop-blur md:block"
      data-mia-demo-proof
      data-mia-ignore
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <strong className="font-semibold text-sm">Try Mia</strong>
        <span className="rounded-md border px-2 py-1 text-muted-foreground text-xs">Live SDK</span>
      </div>
      <div className="grid gap-2">
        {[
          "Where is the Recent Opportunities table?",
          "Click the Stage filter",
          "What does lead-to-deal rate mean?",
        ].map((prompt) => (
          <button
            className="rounded-md border px-2.5 py-2 text-left font-medium text-xs transition-colors hover:bg-muted"
            type="button"
            key={prompt}
            onClick={() => askMia(prompt)}
          >
            {prompt}
          </button>
        ))}
      </div>
    </aside>
  );
}
