import { NextResponse } from "next/server";
import { searchPlaces } from "../../../lib/geocode";

export async function GET(request) {
  const q = new URL(request.url).searchParams.get("q")?.trim();
  if (!q || q.length < 2) return NextResponse.json([]);

  try {
    return NextResponse.json(await searchPlaces(q));
  } catch {
    return NextResponse.json([]);
  }
}
