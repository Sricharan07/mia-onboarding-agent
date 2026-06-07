import { NextResponse } from "next/server";

import { crmSnapshotSchema } from "@/lib/crm-types";
import { completeMeeting } from "@/server/crm-store";

type RouteParams = {
  params: Promise<{
    id: string;
  }>;
};

export async function POST(_: Request, { params }: RouteParams) {
  const { id } = await params;
  const state = await completeMeeting(id);
  return NextResponse.json({ state: crmSnapshotSchema.parse(state) });
}
