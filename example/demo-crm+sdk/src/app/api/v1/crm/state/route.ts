import { NextResponse } from "next/server";

import { getCrmSnapshot } from "@/server/crm-store";

export async function GET() {
  return NextResponse.json({ state: await getCrmSnapshot() });
}
