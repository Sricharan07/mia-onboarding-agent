import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const appId = process.env.NEXT_PUBLIC_MIA_APP_ID;
  const backendUrl = process.env.MIA_BACKEND_URL ?? process.env.NEXT_PUBLIC_MIA_BACKEND_URL;
  const integrationKey = process.env.MIA_INTEGRATION_API_KEY;
  const configuredOrigin = process.env.MIA_DEMO_ORIGIN;
  const userId = process.env.MIA_DEMO_USER_ID ?? "demo-crm-user";
  const origin = request.headers.get("origin");

  if (!appId || !backendUrl || !integrationKey || !configuredOrigin) {
    return NextResponse.json({ error: { message: "Mia server integration is not configured." } }, { status: 503 });
  }
  if (!origin || origin !== new URL(configuredOrigin).origin) {
    return NextResponse.json(
      { error: { message: "Runtime tokens can only be requested from this application origin." } },
      { status: 403 },
    );
  }

  const response = await fetch(`${backendUrl.replace(/\/+$/, "")}/api/v1/runtime/tokens`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${integrationKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ appId, userId, origin }),
    cache: "no-store",
  });
  const payload = await response.json();
  return NextResponse.json(payload, { status: response.status });
}
