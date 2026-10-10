import { beforeEach } from "vitest";
import { markReady } from "../src/readiness.js";

// Tests import `app` directly and never run migrate(), so mark the app ready
// before every test. The readiness suite flips it off itself.
beforeEach(() => {
	markReady();
});
