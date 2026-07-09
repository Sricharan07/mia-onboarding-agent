"use client";

import { useEffect } from "react";

import { AIOnboardingAgent } from "@mia/onboarding-agent";

declare global {
  interface Window {
    __miaOnboardingAgentInitialized?: boolean;
  }
}

export function MiaOnboardingAgent() {
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
        voiceName: "Kore",
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

  return null;
}
