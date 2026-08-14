import { getCurrentUser, setupRequired } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const user = await getCurrentUser(request);
    return Response.json({ authenticated: true, setupRequired: false, user });
  } catch {
    return Response.json({ authenticated: false, setupRequired: await setupRequired() });
  }
}
