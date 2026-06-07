import { NextResponse } from "next/server";

import { completeMeeting } from "@/server/crm-store";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return NextResponse.json({ state: await completeMeeting(id) });
}
