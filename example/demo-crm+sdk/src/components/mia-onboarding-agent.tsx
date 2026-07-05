"use client";

import { useEffect } from "react";

import { AIOnboardingAgent } from "sdk";

declare global {
  interface Window {
    __miaOnboardingAgentInitialized?: boolean;
  }
}

const requiredScopes = "runtime:write and logs:write";

export function MiaOnboardingAgent() {
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
      ui: {
        theme: "auto",
        cursorOffset: { x: 20, y: 20 },
        bubbleMaxWidth: 320,
      },
    });

    window.__miaOnboardingAgentInitialized = true;
  }, []);

  return null;
}
