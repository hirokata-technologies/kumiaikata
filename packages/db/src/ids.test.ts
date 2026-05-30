import { describe, it, expect } from "vitest";
import { newId } from "./ids.js";

describe("newId", () => {
  it("returns a string", () => {
    expect(typeof newId()).toBe("string");
  });

  it("returns a string of length 21", () => {
    expect(newId()).toHaveLength(21);
  });

  it("uses only URL-safe characters (no +, /, or =)", () => {
    // Run 200 iterations to make the check statistically robust
    for (let i = 0; i < 200; i++) {
      const id = newId();
      expect(id).not.toMatch(/[+/=]/);
    }
  });

  it("contains only alphanumeric and URL-safe symbol characters", () => {
    // nanoid default alphabet: A-Za-z0-9_-
    const urlSafe = /^[A-Za-z0-9_-]+$/;
    for (let i = 0; i < 200; i++) {
      expect(newId()).toMatch(urlSafe);
    }
  });

  it("two consecutive calls return different values", () => {
    const first = newId();
    const second = newId();
    expect(first).not.toBe(second);
  });

  it("generates 100 unique ids without collision", () => {
    const ids = Array.from({ length: 100 }, () => newId());
    const unique = new Set(ids);
    expect(unique.size).toBe(100);
  });

  it("every generated id has length 21", () => {
    const ids = Array.from({ length: 50 }, () => newId());
    for (const id of ids) {
      expect(id).toHaveLength(21);
    }
  });
});
