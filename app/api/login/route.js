import { NextResponse } from "next/server";
import {
  clearFailedLoginAttempts,
  createSession,
  getClientIpAddress,
  getLoginLockState,
  registerFailedLoginAttempt,
  validateLoginCredentials
} from "@/lib/auth";

function buildRedirectResponse(path, request) {
  const response = NextResponse.redirect(new URL(path, request.url));
  response.headers.set("Cache-Control", "no-store, max-age=0");
  return response;
}

export async function POST(request) {
  const ipAddress = getClientIpAddress(request);
  const lockState = await getLoginLockState(ipAddress);

  if (lockState.locked) {
    return buildRedirectResponse("/login?error=locked", request);
  }

  const formData = await request.formData();
  const userCode = String(formData.get("userCode") || "").trim();
  const password = String(formData.get("password") || "");

  if (!userCode || !password) {
    return buildRedirectResponse("/login?error=missing", request);
  }

  const user = await validateLoginCredentials(userCode, password);

  if (!user) {
    const attempt = await registerFailedLoginAttempt(ipAddress);
    const errorCode = attempt.locked ? "locked" : "invalid";
    return buildRedirectResponse(`/login?error=${errorCode}`, request);
  }

  await clearFailedLoginAttempts(ipAddress);
  await createSession(user.user_code);

  return buildRedirectResponse("/", request);
}
