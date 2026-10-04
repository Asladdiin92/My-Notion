import { auth, clerkClient } from "@clerk/nextjs/server";

export async function hasPlannerAccess(): Promise<boolean> {
  const { userId } = await auth();
  return userId ? hasPlannerUserAccess(userId) : false;
}

export async function hasPlannerUserAccess(userId: string): Promise<boolean> {
  const allowedEmails = (process.env.ALLOWED_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  if (allowedEmails.length === 0) return false;

  const client = await clerkClient();
  const user = await client.users.getUser(userId);
  return user.emailAddresses.some((address) =>
    address.verification?.status === "verified" &&
    allowedEmails.includes(address.emailAddress.toLowerCase())
  );
}
