"use client";

import { useEffect } from "react";

import { AIOnboardingAgent } from "@mia/onboarding-agent";

declare global {
  interface Window {
    __miaOnboardingAgentInitialized?: boolean;
  }
}

const requiredScopes = "runtime:write and logs:write";

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
    const apiKey = process.env.NEXT_PUBLIC_MIA_API_KEY;

    if (!appId || !backendUrl || !apiKey) {
      console.warn(
        `Mia SDK is not initialized. Configure NEXT_PUBLIC_MIA_APP_ID, NEXT_PUBLIC_MIA_BACKEND_URL, and NEXT_PUBLIC_MIA_API_KEY with ${requiredScopes}.`,
      );
      return;
    }

    AIOnboardingAgent.init({
      appId,
      backendUrl,
      apiKey,
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
    <aside className="fixed right-4 bottom-24 z-40 hidden w-72 rounded-lg border bg-background/95 p-3 shadow-sm backdrop-blur md:block" data-mia-demo-proof data-mia-ignore>
      <div className="mb-2 flex items-center justify-between gap-2">
        <strong className="text-sm font-semibold">Try Mia</strong>
        <span className="rounded-md border px-2 py-1 text-xs text-muted-foreground">Live SDK</span>
      </div>
      <div className="grid gap-2">
        {[
          "Where is the Recent Opportunities table?",
          "Click the Stage filter",
          "What does lead-to-deal rate mean?",
        ].map((prompt) => (
          <button
            className="rounded-md border px-2.5 py-2 text-left text-xs font-medium transition-colors hover:bg-muted"
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
