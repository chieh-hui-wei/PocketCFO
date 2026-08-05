import test from "node:test";
import assert from "node:assert/strict";
import { formatMessageTime } from "./formatTime.ts";

test("formatMessageTime renders a HH:MM style time string", () => {
  const ts = new Date(2026, 0, 1, 9, 5).getTime();
  const result = formatMessageTime(ts);
  assert.match(result, /^\d{1,2}:\d{2}\s?(AM|PM)?$/i);
});

test("formatMessageTime is stable for the same timestamp", () => {
  const ts = Date.now();
  assert.equal(formatMessageTime(ts), formatMessageTime(ts));
});
