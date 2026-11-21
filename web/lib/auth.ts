"use client";
import { createAuthClient } from "better-auth/react";

const AUTH_URL =
  process.env["NEXT_PUBLIC_AUTH_URL"] ?? "http://localhost:7052";

export const authClient = createAuthClient({ baseURL: AUTH_URL });

export async function signInWithGoogle(): Promise<void> {
  await authClient.signIn.social({
    provider: "google",
    callbackURL: "http://localhost:7060/",
  });
}

export async function signUpEmail(
  email: string,
  password: string,
  name: string,
): Promise<void> {
  const res = await authClient.signUp.email({ email, password, name });
  if (res.error) throw new Error(res.error.message ?? "Sign-up failed");
}

export async function signInEmail(
  email: string,
  password: string,
): Promise<void> {
  const res = await authClient.signIn.email({ email, password });
  if (res.error) throw new Error(res.error.message ?? "Sign-in failed");
}

export async function signOut(): Promise<void> {
  await authClient.signOut();
}

export async function getJwt(): Promise<string> {
  const AUTH_BASE = process.env["NEXT_PUBLIC_AUTH_URL"] ?? "http://localhost:7052";
  const res = await fetch(`${AUTH_BASE}/api/auth/token`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error(`JWT fetch failed: ${res.status}`);
  const data = (await res.json()) as { token: string };
  return data.token;
}
