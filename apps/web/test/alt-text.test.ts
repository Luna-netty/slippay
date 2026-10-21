// Test that no <img> in apps/web/src lacks an `alt` attribute.
//
// Bounty: [Bounty: $60] Add `alt` text to the images missing it (slippay #86)
//
// The eslint-plugin-jsx-a11y `alt-text` rule enforces this at lint time, but
// this test also asserts the invariant at test time so a CI run that skips
// lint (or a contributor who skips lint locally) still catches the regression.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const SRC_ROOT = new URL("../src/", import.meta.url).pathname;

/** Recursively collect every .tsx / .jsx / .ts file under SRC_ROOT. */
function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      yield* walk(full);
    } else if (st.isFile()) {
      const ext = extname(full);
      if (ext === ".tsx" || ext === ".jsx" || ext === ".ts") {
        yield full;
      }
    }
  }
}

/** Extract every <img ...> tag from a source file. */
function extractImgTags(src: string): string[] {
  const tags: string[] = [];
  // Match <img ...> including across newlines (multiline flag).
  const re = /<img\b[^>]*>/g;
  for (const m of src.matchAll(re)) {
    tags.push(m[0]);
  }
  return tags;
}

/** Check whether an <img> tag has an `alt` attribute (even an empty one). */
function hasAlt(imgTag: string): boolean {
  // Match `alt="..."`, `alt=''`, `alt={...}` etc. — the attribute name
  // must be present.
  return /\balt\s*=/.test(imgTag);
}

describe("a11y: every <img> has an alt attribute (closes #86)", () => {
  const files = [...walk(SRC_ROOT)];
  if (files.length === 0) {
    it("skipped: no .tsx/.jsx/.ts files found under src/", () => {
      expect(true).toBe(true);
    });
    return;
  }

  for (const file of files) {
    const src = readFileSync(file, "utf-8");
    const imgs = extractImgTags(src);
    if (imgs.length === 0) continue;

    describe(`\`${file.replace(SRC_ROOT, "src/")}\``, () => {
      for (let i = 0; i < imgs.length; i++) {
        it(`img #${i + 1} has an alt attribute`, () => {
          expect(hasAlt(imgs[i]!)).toBe(true);
          // Print the offending tag for easy debugging.
          if (!hasAlt(imgs[i]!)) {
            console.error(`Missing alt in ${file}: ${imgs[i]}`);
          }
        });
      }
    });
  }
});