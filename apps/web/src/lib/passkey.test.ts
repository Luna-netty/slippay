import { describe, it, expect, vi, afterEach } from "vitest";
import { derToRaw64, getAssertion, createPasskey } from "./passkey.ts";

const subtle = globalThis.crypto.subtle;

// DER INTEGER TLV: strip superfluous leading zeros, prepend 0x00 if the high
// bit would otherwise read as a sign bit.
function derInt(bytes: Uint8Array): Uint8Array {
  let b = bytes;
  let i = 0;
  while (i < b.length - 1 && b[i] === 0) i++;
  b = b.slice(i);
  const body = b[0]! & 0x80 ? Uint8Array.from([0, ...b]) : b;
  return Uint8Array.from([0x02, body.length, ...body]);
}

function derSignature(r: Uint8Array, s: Uint8Array): Uint8Array {
  const body = [...derInt(r), ...derInt(s)];
  return Uint8Array.from([0x30, body.length, ...body]);
}

// WebCrypto ECDSA returns raw r||s (P1363); wrap it in DER to mimic what a
// platform authenticator hands back to a WebAuthn relying party.
function rawToDer(raw: Uint8Array): Uint8Array {
  return derSignature(raw.slice(0, 32), raw.slice(32, 64));
}

const toHex = (b: Uint8Array): string =>
  Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

/**
 * crypto.subtle takes a BufferSource, i.e. a view over a plain ArrayBuffer.
 * A Uint8Array is Uint8Array<ArrayBufferLike>, which may sit on a
 * SharedArrayBuffer, so narrow it by copying before handing it over.
 */
const buf = (b: Uint8Array): Uint8Array<ArrayBuffer> => new Uint8Array(b);

const P256_N = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;

async function p256Pair() {
  return subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
}

async function signDer(privateKey: CryptoKey, msg: Uint8Array): Promise<Uint8Array> {
  return rawToDer(new Uint8Array(await subtle.sign({ name: "ECDSA", hash: "SHA-256" }, privateKey, buf(msg))));
}

function verifyP256(pub: CryptoKey, raw64: Uint8Array, msg: Uint8Array): Promise<boolean> {
  return subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pub, buf(raw64), buf(msg));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("derToRaw64 — DER (WebAuthn) → raw 64-byte secp256r1 r||s", () => {
  it("accepts a real P-256 assertion built from a known key pair", async () => {
    const { publicKey, privateKey } = await p256Pair();
    const msg = new Uint8Array([1, 2, 3, 4, 5]);

    const raw = derToRaw64(await signDer(privateKey, msg));

    expect(raw.length).toBe(64);
    // The converted r||s must still verify against the known public key.
    await expect(verifyP256(publicKey, raw, msg)).resolves.toBe(true);
  });

  it("rejects a tampered signature (verification fails for the same key/message)", async () => {
    const { publicKey, privateKey } = await p256Pair();
    const msg = new Uint8Array([9, 8, 7]);

    const raw = derToRaw64(await signDer(privateKey, msg));
    const tampered = Uint8Array.from(raw);
    tampered[0] = tampered[0]! ^ 0xff;

    await expect(verifyP256(publicKey, tampered, msg)).resolves.toBe(false);
  });

  it("rejects an assertion whose challenge does not match the pending payload", async () => {
    const { publicKey, privateKey } = await p256Pair();
    const challengeA = new Uint8Array([10, 20, 30]);
    const challengeB = new Uint8Array([10, 20, 31]);

    const raw = derToRaw64(await signDer(privateKey, challengeA));

    await expect(verifyP256(publicKey, raw, challengeA)).resolves.toBe(true);
    await expect(verifyP256(publicKey, raw, challengeB)).resolves.toBe(false);
  });

  it("low-S normalizes an otherwise-valid high-S signature", () => {
    const r = Uint8Array.from([...new Uint8Array(31), 0x01]);
    // s = P256_N - 1 is above N/2 → malleable, must fold to N - s = 1.
    const sHigh = Uint8Array.from(Buffer.from((P256_N - 1n).toString(16).padStart(64, "0"), "hex"));

    const raw = derToRaw64(derSignature(r, sHigh));

    expect(toHex(raw.slice(0, 32))).toBe(toHex(r));
    expect(toHex(raw.slice(32, 64))).toBe("0".repeat(63) + "1");
  });

  it("left-pads short r/s integers to 32 bytes each", () => {
    const raw = derToRaw64(derSignature(Uint8Array.from([0x01]), Uint8Array.from([0x02])));

    expect(raw.length).toBe(64);
    expect(toHex(raw.slice(0, 32))).toBe("0".repeat(63) + "1");
    expect(toHex(raw.slice(32, 64))).toBe("0".repeat(63) + "2");
  });

  it("throws on a malformed/mutilated DER payload (no silent fallback)", () => {
    // SEQUENCE with no INTEGER anywhere.
    expect(() => derToRaw64(Uint8Array.from([0x30, 0x00]))).toThrow(/bad DER signature \(r\)/);
    // r present, s tag replaced by a bogus 0x03.
    expect(() =>
      derToRaw64(Uint8Array.from([0x30, 0x06, 0x02, 0x01, 0x01, 0x03, 0x01, 0x01])),
    ).toThrow(/bad DER signature \(s\)/);
    // Empty payload.
    expect(() => derToRaw64(new Uint8Array(0))).toThrow(/bad DER signature \(r\)/);
  });
});

describe("getAssertion — WebAuthn assertion plumbing", () => {
  it("forwards the pending challenge and DER→raw normalizes the signature", async () => {
    const { privateKey } = await p256Pair();
    const challenge = Uint8Array.from([9, 9, 9, 9]);
    const der = await signDer(privateKey, challenge);

    const get = vi.fn().mockResolvedValue({
      response: {
        authenticatorData: new Uint8Array([1, 2, 3]).buffer,
        clientDataJSON: new Uint8Array([4, 5]).buffer,
        signature: der.buffer,
      },
    });
    vi.stubGlobal("navigator", { credentials: { get } });

    const assertion = await getAssertion(challenge);

    expect(assertion.signature.length).toBe(64);
    expect(Array.from(assertion.authenticatorData)).toEqual([1, 2, 3]);
    expect(Array.from(assertion.clientDataJSON)).toEqual([4, 5]);
    expect(get).toHaveBeenCalledOnce();
    // The exact challenge bytes must be what the authenticator is asked to sign.
    const arg = get.mock.calls[0]![0] as { publicKey: { challenge: Uint8Array } };
    expect(Array.from(arg.publicKey.challenge)).toEqual([9, 9, 9, 9]);
  });

  it("throws when the user cancels biometrics", async () => {
    vi.stubGlobal("navigator", { credentials: { get: vi.fn().mockResolvedValue(null) } });

    await expect(getAssertion(new Uint8Array([1]))).rejects.toThrow("Biometria cancelada.");
  });
});

describe("createPasskey — platform support gate", () => {
  it("throws a clear error when the device has no WebAuthn support", async () => {
    vi.stubGlobal("window", {});

    await expect(createPasskey("alice")).rejects.toThrow(/não suporta passkey/);
  });
});