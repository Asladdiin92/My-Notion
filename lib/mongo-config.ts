export function mongoDatabaseName(): string | undefined {
  return process.env.MONGO_DB_NAME?.trim() || process.env.MONGO_DATABASE_NAME?.trim() || undefined;
}

export function aiMongoDatabaseName(): string {
  return process.env.AI_MONGO_DB_NAME?.trim() || mongoDatabaseName() || "asladin-future-os";
}

function validateDatabaseName(name: string, variable: string): void {
  if (name.length > 63 || !/^[^/\\. "$*<>:|?]+$/.test(name)) {
    throw new Error(`${variable} must be a valid MongoDB database name.`);
  }
}

export function validateMongoEnvironment(): void {
  const uri = process.env.MONGO_URI?.trim();
  const name = mongoDatabaseName();
  if (!uri && !name) return;
  if (!uri) throw new Error("MongoDB configuration is incomplete. Set MONGO_URI.");
  if (name) validateDatabaseName(name, "MONGO_DB_NAME");
  validateDatabaseName(aiMongoDatabaseName(), "AI_MONGO_DB_NAME");
  try {
    const parsed = new URL(uri);
    if (!["mongodb:", "mongodb+srv:"].includes(parsed.protocol) || !parsed.hostname) {
      throw new Error("invalid MongoDB URI");
    }
  } catch {
    throw new Error("MONGO_URI must be a valid mongodb:// or mongodb+srv:// connection string.");
  }
}
