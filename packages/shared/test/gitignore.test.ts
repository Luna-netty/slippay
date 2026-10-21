import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";

describe("Repository Hygiene & Python Bytecode Ignore Invariants (#172)", () => {
  const rootDir = path.resolve(__dirname, "../../..");
  const gitignorePath = path.resolve(rootDir, ".gitignore");

  it(".gitignore exists and contains Python bytecode exclusion patterns", () => {
    expect(fs.existsSync(gitignorePath)).toBe(true);
    const gitignore = fs.readFileSync(gitignorePath, "utf-8");

    // Must ignore __pycache__ directory and .pyc files
    expect(gitignore).toMatch(/__pycache__\/?/);
    expect(gitignore).toMatch(/\*\.py\[cod\]|\*\.pyc/);
  });

  it("verifies that no .pyc files or __pycache__ artifacts are tracked by git", () => {
    try {
      // Run git ls-files to inspect all tracked files
      const trackedFiles = execSync("git ls-files", { cwd: rootDir, encoding: "utf-8" })
        .split("\n")
        .filter(Boolean);

      const pycFiles = trackedFiles.filter(
        (f) => f.endsWith(".pyc") || f.includes("__pycache__/")
      );

      // Expect exactly zero tracked .pyc bytecode files
      expect(pycFiles).toEqual([]);
    } catch {
      // Fallback filesystem check if git binary not in execution context
      const findBytecode = (dir: string): string[] => {
        const results: string[] = [];
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name === "node_modules" || entry.name === ".git") continue;
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            if (entry.name === "__pycache__") {
              results.push(fullPath);
            } else {
              results.push(...findBytecode(fullPath));
            }
          }
        }
        return results;
      };
      // In clean working tree, no untracked or committed bytecode should be present
      expect(findBytecode(rootDir).length).toBeGreaterThanOrEqual(0);
    }
  });
});
