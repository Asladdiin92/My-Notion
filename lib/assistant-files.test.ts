import assert from "node:assert/strict";
import test from "node:test";
import { Buffer } from "node:buffer";

let extractAssistantFile: typeof import("./assistant-files").extractAssistantFile;
test.before(async () => {
  ({ extractAssistantFile } = await import("./assistant-files"));
});

function mockFile(name: string, contents: string | Uint8Array) {
  const bytes = typeof contents === "string" ? new TextEncoder().encode(contents) : contents;
  return {
    name,
    size: bytes.byteLength,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  };
}

test("extracts UTF-8 text and CSV while sanitizing uploaded filenames", async () => {
  const text = await extractAssistantFile(mockFile("../notes<script>.txt", "Read chapter 4."));
  assert.equal(text.text, "Read chapter 4.");
  assert.equal(text.mimeType, "text/plain");
  assert.equal(text.name, ".._notes_script_.txt");

  const csv = await extractAssistantFile(mockFile("tasks.csv", "Item,Course\nLab 1,ITeC4103"));
  assert.match(csv.text ?? "", /Lab 1,ITeC4103/);
});

test("encodes a valid PDF as Gemini inline data without persisting it", async () => {
  const bytes = new TextEncoder().encode("%PDF-1.7 test bytes");
  const file = await extractAssistantFile(mockFile("lecture.pdf", bytes));
  assert.equal(file.mimeType, "application/pdf");
  assert.equal(Buffer.from(file.base64 ?? "", "base64").toString("utf8"), "%PDF-1.7 test bytes");
  assert.equal(file.text, undefined);
});

test("extracts a bounded XLSX worksheet as readable rows", async () => {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Assignments");
  sheet.addRows([["Item", "Course"], ["Security lab", "ITeC4133"]]);
  const buffer = await workbook.xlsx.writeBuffer();
  const file = await extractAssistantFile(mockFile("assignments.xlsx", new Uint8Array(buffer)));

  assert.match(file.text ?? "", /Sheet: Assignments/);
  assert.match(file.text ?? "", /Security lab\tITeC4133/);
});

test("rejects unsupported, oversized, malformed, and non-UTF-8 files", async () => {
  await assert.rejects(extractAssistantFile(mockFile("secret.exe", "binary")), /Supported files/);
  await assert.rejects(
    extractAssistantFile({ ...mockFile("large.txt", "x"), size: 3 * 1024 * 1024 + 1 }),
    /between 1 byte and 3 MB/,
  );
  await assert.rejects(extractAssistantFile(mockFile("image.png", "not a png")), /valid PNG/);
  await assert.rejects(extractAssistantFile(mockFile("notes.txt", Uint8Array.from([0xff, 0xfe]))), /UTF-8/);

  const archiveBomb = Buffer.alloc(4 + 3 * 46 + 22);
  archiveBomb.writeUInt32LE(0x04034b50, 0);
  for (let index = 0; index < 3; index += 1) {
    const entryOffset = 4 + index * 46;
    archiveBomb.writeUInt32LE(0x02014b50, entryOffset);
    archiveBomb.writeUInt32LE(1, entryOffset + 20);
    archiveBomb.writeUInt32LE(7 * 1024 * 1024, entryOffset + 24);
  }
  const endOffset = archiveBomb.length - 22;
  archiveBomb.writeUInt32LE(0x06054b50, endOffset);
  archiveBomb.writeUInt16LE(3, endOffset + 8);
  archiveBomb.writeUInt16LE(3, endOffset + 10);
  archiveBomb.writeUInt32LE(3 * 46, endOffset + 12);
  archiveBomb.writeUInt32LE(4, endOffset + 16);
  await assert.rejects(
    extractAssistantFile(mockFile("oversized.xlsx", archiveBomb)),
    /expanded Office document exceeds the 20 MB safety limit/,
  );
});
