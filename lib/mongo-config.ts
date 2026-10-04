export function mongoDatabaseName(): string | undefined {
  return process.env.MONGO_DB_NAME?.trim() || process.env.MONGO_DATABASE_NAME?.trim() || undefined;
}

export function validateMongoEnvironment(): void {
  const uri = process.env.MONGO_URI?.trim();
  const name = mongoDatabaseName();
  if (!uri && !name) return;
  if (!uri || !name) {
    throw new Error("MongoDB configuration is incomplete. Set both MONGO_URI and MONGO_DB_NAME.");
  }
  if (name.length > 63 || !/^[^/\\. "$*<>:|?]+$/.test(name)) {
    throw new Error("MONGO_DB_NAME must be a valid MongoDB database name.");
  }
  try {
    const parsed = new URL(uri);
    if (!["mongodb:", "mongodb+srv:"].includes(parsed.protocol) || !parsed.hostname) {
      throw new Error("invalid MongoDB URI");
    }
  } catch {
    throw new Error("MONGO_URI must be a valid mongodb:// or mongodb+srv:// connection string.");
  }
}
