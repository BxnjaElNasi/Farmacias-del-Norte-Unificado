import { NextResponse } from "next/server";
import { getCurrentUser, LEGACY_SESSION_COOKIE } from "@/lib/auth";
import { apiError } from "@/lib/api";
import { isDatabaseConfigured } from "@/lib/db";

export async function GET() {
  try {
    const response = NextResponse.json({
      configured: isDatabaseConfigured(),
      user: await getCurrentUser(),
    });
    response.cookies.set(LEGACY_SESSION_COOKIE, "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });
    return response;
  } catch (error) {
    return apiError(error);
  }
}
