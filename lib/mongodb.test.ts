import assert from "node:assert/strict";
import test from "node:test";
import { aiMongoDatabaseName, validateMongoEnvironment } from "./mongo-config";
import { getMongoHealthStatus } from "./mongodb";

const originalUri = process.env.MONGO_URI;
const originalDbName = process.env.MONGO_DB_NAME;
const originalLegacyDbName = process.env.MONGO_DATABASE_NAME;
const originalAIDbName = process.env.AI_MONGO_DB_NAME;

test.afterEach(() => {
  if (originalUri === undefined) delete process.env.MONGO_URI;
  else process.env.MONGO_URI = originalUri;
  if (originalDbName === undefined) delete process.env.MONGO_DB_NAME;
  else process.env.MONGO_DB_NAME = originalDbName;
  if (originalLegacyDbName === undefined) delete process.env.MONGO_DATABASE_NAME;
  else process.env.MONGO_DATABASE_NAME = originalLegacyDbName;
  if (originalAIDbName === undefined) delete process.env.AI_MONGO_DB_NAME;
  else process.env.AI_MONGO_DB_NAME = originalAIDbName;
});

test("allows MongoDB to remain optional when no connection is configured", async () => {
  delete process.env.MONGO_URI;
  delete process.env.MONGO_DB_NAME;
  delete process.env.MONGO_DATABASE_NAME;
  delete process.env.AI_MONGO_DB_NAME;

  assert.doesNotThrow(validateMongoEnvironment);
  assert.equal(aiMongoDatabaseName(), "asladin-future-os");
  assert.equal(await getMongoHealthStatus(), "disconnected");
});

test("uses MONGO_DB_NAME for AI storage unless AI_MONGO_DB_NAME is set", () => {
  process.env.MONGO_DB_NAME = "asladin-future-os";
  delete process.env.MONGO_DATABASE_NAME;
  delete process.env.AI_MONGO_DB_NAME;
  assert.equal(aiMongoDatabaseName(), "asladin-future-os");

  process.env.AI_MONGO_DB_NAME = "ai-database-override";
  assert.equal(aiMongoDatabaseName(), "ai-database-override");
});

test("requires a connection URI when a legacy integration database is configured", () => {
  delete process.env.MONGO_URI;
  process.env.MONGO_DB_NAME = "asladin_command_center";
  delete process.env.MONGO_DATABASE_NAME;

  assert.throws(validateMongoEnvironment, /Set MONGO_URI/);
});

test("validates configured MongoDB database names and URI protocols", () => {
  process.env.MONGO_URI = "mongodb+srv://example.mongodb.net";
  process.env.MONGO_DB_NAME = "asladin_command_center";
  delete process.env.MONGO_DATABASE_NAME;
  assert.doesNotThrow(validateMongoEnvironment);

  delete process.env.MONGO_DB_NAME;
  assert.doesNotThrow(validateMongoEnvironment);

  process.env.AI_MONGO_DB_NAME = "invalid/name";
  assert.throws(validateMongoEnvironment, /AI_MONGO_DB_NAME must be a valid MongoDB database name/);
  delete process.env.AI_MONGO_DB_NAME;

  process.env.MONGO_URI = "https://example.mongodb.net";
  assert.throws(validateMongoEnvironment, /valid mongodb:\/\/ or mongodb\+srv:\/\//);

  process.env.MONGO_URI = "mongodb://localhost:27017";
  process.env.MONGO_DB_NAME = "invalid/name";
  assert.throws(validateMongoEnvironment, /MONGO_DB_NAME must be a valid MongoDB database name/);
});
