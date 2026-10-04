import assert from "node:assert/strict";
import test from "node:test";
import { validateMongoEnvironment } from "./mongo-config";
import { getMongoHealthStatus } from "./mongodb";

const originalUri = process.env.MONGO_URI;
const originalDbName = process.env.MONGO_DB_NAME;
const originalLegacyDbName = process.env.MONGO_DATABASE_NAME;

test.afterEach(() => {
  if (originalUri === undefined) delete process.env.MONGO_URI;
  else process.env.MONGO_URI = originalUri;
  if (originalDbName === undefined) delete process.env.MONGO_DB_NAME;
  else process.env.MONGO_DB_NAME = originalDbName;
  if (originalLegacyDbName === undefined) delete process.env.MONGO_DATABASE_NAME;
  else process.env.MONGO_DATABASE_NAME = originalLegacyDbName;
});

test("allows MongoDB to remain optional when both environment variables are unset", async () => {
  delete process.env.MONGO_URI;
  delete process.env.MONGO_DB_NAME;
  delete process.env.MONGO_DATABASE_NAME;

  assert.doesNotThrow(validateMongoEnvironment);
  assert.equal(await getMongoHealthStatus(), "disconnected");
});

test("rejects incomplete MongoDB environment without including secret values", () => {
  const privateUri = "mongodb+srv://private-user:private-password@example.mongodb.net";
  process.env.MONGO_URI = privateUri;
  delete process.env.MONGO_DB_NAME;
  delete process.env.MONGO_DATABASE_NAME;

  assert.throws(validateMongoEnvironment, (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /Set both MONGO_URI and MONGO_DB_NAME/);
    assert.equal(error.message.includes(privateUri), false);
    assert.equal(error.message.includes("private-password"), false);
    return true;
  });
});

test("validates supported MongoDB URI protocols and database names", () => {
  process.env.MONGO_URI = "mongodb+srv://user:password@example.mongodb.net";
  process.env.MONGO_DB_NAME = "asladin_command_center";
  delete process.env.MONGO_DATABASE_NAME;
  assert.doesNotThrow(validateMongoEnvironment);

  process.env.MONGO_URI = "https://example.mongodb.net";
  assert.throws(validateMongoEnvironment, /valid mongodb:\/\/ or mongodb\+srv:\/\//);

  process.env.MONGO_URI = "mongodb://localhost:27017";
  process.env.MONGO_DB_NAME = "invalid/name";
  assert.throws(validateMongoEnvironment, /valid MongoDB database name/);
});
