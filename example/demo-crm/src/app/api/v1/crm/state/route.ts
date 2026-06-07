import { NextResponse } from "next/server";

import { getCrmSnapshot } from "@/server/crm-store";

export async function GET() {
  const state = await getCrmSnapshot();
  return NextResponse.json({ state });
}
