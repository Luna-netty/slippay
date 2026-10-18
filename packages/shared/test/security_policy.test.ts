import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

describe("Security Policy Invariants & Cross-Reference Integrity (#179)", () => {
  const rootDir = path.resolve(__dirname, "../../..");
  const securityPath = path.resolve(rootDir, "SECURITY.md");
  const readmePath = path.resolve(rootDir, "README.md");
  const contributingPath = path.resolve(rootDir, "CONTRIBUTING.md");

  it("SECURITY.md exists at repository root and defines coordinated disclosure channels", () => {
    expect(fs.existsSync(securityPath)).toBe(true);
    const content = fs.readFileSync(securityPath, "utf-8");

    // Must define reporting channels and supported versions
    expect(content).toMatch(/# Security Policy/i);
    expect(content).toMatch(/Reporting a Vulnerability/i);
    expect(content).toMatch(/security@slippay\.org|security advisory/i);

    // SLAs for disclosure response
    expect(content).toMatch(/acknowledgment|triage|response/i);
    expect(content).toMatch(/24|48|72/);
  });

  it("README.md contains explicit link to SECURITY.md", () => {
    expect(fs.existsSync(readmePath)).toBe(true);
    const content = fs.readFileSync(readmePath, "utf-8");
    expect(content).toMatch(/SECURITY\.md/);
  });

  it("CONTRIBUTING.md contains explicit link to SECURITY.md for vulnerability reporting", () => {
    expect(fs.existsSync(contributingPath)).toBe(true);
    const content = fs.readFileSync(contributingPath, "utf-8");
    expect(content).toMatch(/SECURITY\.md/);
  });

  it("ensures no private keys or secrets are leaked inside policy documentation", () => {
    const content = fs.readFileSync(securityPath, "utf-8");
    expect(content).not.toMatch(/BEGIN (RSA|EC|OPENSSH|DSA|PGP) PRIVATE KEY/);
    expect(content).not.toMatch(/ghp_[A-Za-z0-9]{36}/);
  });
});
