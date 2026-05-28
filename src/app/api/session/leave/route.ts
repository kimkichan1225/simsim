import { NextResponse } from "next/server";
import { clearSessionCookie } from "@/server/auth";

export async function POST() {
  await clearSessionCookie();
  return NextResponse.json({ ok: true });
}
