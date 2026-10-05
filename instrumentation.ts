import { validateMongoEnvironment } from "./lib/mongo-config";

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  validateMongoEnvironment();

  const registration = globalThis as typeof globalThis & { asladinMongoShutdownHandlersRegistered?: boolean };
  if (registration.asladinMongoShutdownHandlersRegistered) return;
  registration.asladinMongoShutdownHandlersRegistered = true;

  const shutdown = (signal: NodeJS.Signals) => {
    const mongoState = globalThis as typeof globalThis & {
      asladinMongoCloseConnection?: () => Promise<void>;
    };
    void (mongoState.asladinMongoCloseConnection?.() ?? Promise.resolve())
      .catch(() => console.error("MongoDB graceful shutdown failed."))
      .finally(() => process.kill(process.pid, signal));
  };
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
}
