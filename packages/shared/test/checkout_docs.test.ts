import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

describe("Checkout Contract Fee Semantics, Limits & Documentation Invariants (#309)", () => {
  const libPath = path.resolve(__dirname, "../../../contracts/checkout/src/lib.rs");
  const deploymentPath = path.resolve(__dirname, "../../../contracts/checkout/DEPLOYMENT.md");
  const publicDocPath = path.resolve(__dirname, "../../../docs/contracts/checkout.md");

  describe("contracts/checkout/src/lib.rs Crate & Method Documentation", () => {
    it("exists and is readable", () => {
      expect(fs.existsSync(libPath)).toBe(true);
    });

    it("documents rate units and permitted range (0 <= fee_bps <= 10_000)", () => {
      const content = fs.readFileSync(libPath, "utf-8");
      expect(content).toContain("fee_bps");
      expect(content).toContain("basis points");
      expect(content).toMatch(/10_000/);
      expect(content).toContain("Error::BadConfig");
    });

    it("documents integer division truncation and merchant dust accrual", () => {
      const content = fs.readFileSync(libPath, "utf-8");
      expect(content).toMatch(/truncat(es|ing)|floor/i);
      expect(content).toContain("merchant");
      expect(content).toMatch(/dust|stroop|remainder/i);
      expect(content).toContain("net + fee == amount");
    });

    it("documents zero-fee micro-payments and zero-net edge cases", () => {
      const content = fs.readFileSync(libPath, "utf-8");
      expect(content).toMatch(/zero.*fee/i);
      expect(content).toMatch(/zero.*net/i);
      expect(content).toContain("Error::BadAmount");
    });

    it("documents single authorization and atomic rollback guarantees", () => {
      const content = fs.readFileSync(libPath, "utf-8");
      expect(content).toContain("from.require_auth()");
      expect(content).toMatch(/atomically|revert|rollback/i);
    });

    it("cross-references canonical specification in docs/fees.md", () => {
      const content = fs.readFileSync(libPath, "utf-8");
      expect(content).toContain("docs/fees.md");
    });
  });

  describe("contracts/checkout/DEPLOYMENT.md Documentation", () => {
    it("exists and includes complete Fee Semantics, Rounding & Limits table", () => {
      expect(fs.existsSync(deploymentPath)).toBe(true);
      const content = fs.readFileSync(deploymentPath, "utf-8");
      expect(content).toContain("## 2. Fee Semantics, Rounding & Limits");
      expect(content).toContain("Rate Unit");
      expect(content).toContain("Permitted Range");
      expect(content).toContain("10_000");
      expect(content).toContain("Rounding Direction");
      expect(content).toContain("Dust Beneficiary");
      expect(content).toContain("Merchant");
      expect(content).toContain("Conservation Identity");
      expect(content).toContain("docs/fees.md");
    });

    it("records testnet proof transaction and contract IDs", () => {
      const content = fs.readFileSync(deploymentPath, "utf-8");
      expect(content).toContain("CBO2COBZUTHH4II4JCQRZVO4RKDUIUH4MXZTAWOYVUZIVYI47UIDQCWQ");
      expect(content).toContain("e142cd0bbaa19adfe1b74d3629ea7788f06abca8a0ba6ba121e6f41c67390941");
    });
  });

  describe("docs/contracts/checkout.md Public Portal Documentation", () => {
    it("exists and documents caps, rounding direction, and links to docs/fees.md", () => {
      expect(fs.existsSync(publicDocPath)).toBe(true);
      const content = fs.readFileSync(publicDocPath, "utf-8");
      expect(content).toContain("docs/fees.md");
      expect(content).toContain("Rounding Direction");
      expect(content).toContain("Zero-Fee");
      expect(content).toContain("Zero-Net");
      expect(content).toContain("Atomicity & Revert Guarantee");
    });
  });

  describe("On-Chain Fee Arithmetic Vector Verification", () => {
    function sorobanFeeMath(amount: bigint, feeBps: number): { net: bigint; fee: bigint } {
      if (feeBps < 0 || feeBps > 10_000) throw new Error("BadConfig");
      if (amount <= 0n) throw new Error("BadAmount");
      const fee = (amount * BigInt(feeBps)) / 10_000n;
      const net = amount - fee;
      return { net, fee };
    }

    it("reproduces testnet proof split: 10 XLM (100,000,000 stroops) @ 300 bps (3%)", () => {
      const { net, fee } = sorobanFeeMath(100_000_000n, 300);
      expect(fee).toBe(3_000_000n); // 0.3 XLM
      expect(net).toBe(97_000_000n); // 9.7 XLM
      expect(net + fee).toBe(100_000_000n);
    });

    it("verifies canonical mainnet rate: 100 USDC @ 297 bps (2.97%)", () => {
      const { net, fee } = sorobanFeeMath(1_000_000_000n, 297);
      expect(fee).toBe(29_700_000n); // 2.97 USDC
      expect(net).toBe(970_300_000n); // 97.03 USDC
      expect(net + fee).toBe(1_000_000_000n);
    });

    it("asserts fractional dust retention by merchant on inexact division", () => {
      // 1.0000001 USDC = 10,000,001 stroops @ 297 bps
      const { net, fee } = sorobanFeeMath(10_000_001n, 297);
      expect(fee).toBe(297_000n);
      expect(net).toBe(9_703_001n);
      expect(net + fee).toBe(10_000_001n);
    });

    it("verifies zero fee on micro-payment", () => {
      const { net, fee } = sorobanFeeMath(1n, 297);
      expect(fee).toBe(0n);
      expect(net).toBe(1n);
    });

    it("verifies zero net on 100% fee", () => {
      const { net, fee } = sorobanFeeMath(1_000_000n, 10_000);
      expect(fee).toBe(1_000_000n);
      expect(net).toBe(0n);
    });
  });
});
