import assert from "node:assert/strict";
import test from "node:test";
import { validateNewAISkill } from "./ai-skills";

test("trims and returns supported AI skill fields", () => {
  assert.deepEqual(validateNewAISkill({
    name: "  Study coach  ",
    description: "  Helps plan study sessions.  ",
    instructions: "  Ask for the next concrete step.  ",
  }), {
    name: "Study coach",
    description: "Helps plan study sessions.",
    instructions: "Ask for the next concrete step.",
  });
});

test("rejects unsupported and oversized AI skill input", () => {
  assert.throws(() => validateNewAISkill({
    name: "Study coach",
    description: "Helpful",
    instructions: "Plan a study session",
    userId: "attacker-controlled",
  }), /Send a skill name, description, and instructions/);
  assert.throws(() => validateNewAISkill({
    name: " ",
    description: "Helpful",
    instructions: "Plan a study session",
  }), /Skill name must contain/);
  assert.throws(() => validateNewAISkill({
    name: "Study coach",
    description: "Helpful",
    instructions: "x".repeat(4001),
  }), /Skill instructions must contain/);
});
