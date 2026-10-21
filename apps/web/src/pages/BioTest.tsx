// /bio — real on-device biometric test. Proves the user-facing passkey layer
// works on YOUR phone: mint a passkey (Face ID / fingerprint), sign a challenge,
// and cryptographically verify the assertion against the minted secp256r1 key.
//
// This is the device half of "biometria paga". The on-chain payment leg
// (relayer-deployed wallet + submit) is wired separately; here we prove the tap
// and the signature are real and valid on this exact device.

import { useState } from "react";
import { Link } from "react-router-dom";
import { Logo } from "../components/Logo";
import { createPasskey, getAssertion, type PasskeyHandle } from "../lib/passkey";

function hex(b: Uint8Array, head = 10, tail = 8): string {
  const s = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return s.length <= head + tail + 1 ? s : `${s.slice(0, head)}…${s.slice(-tail)}`;
}

async function sha256(buf: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", buf as BufferSource));
}

export default function BioTest() {
  const [handle, setHandle] = useState<PasskeyHandle | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [verdict, setVerdict] = useState<"ok" | "fail" | null>(null);

  const add = (s: string) => setLog((l) => [...l, s]);

  async function onCreate() {
    setBusy(true); setVerdict(null); setLog([]);
    try {
      add("pedindo Face ID / digital pra criar a passkey…");
      const h = await createPasskey("slippay-bio-test");
      setHandle(h);
      add(`✅ passkey criada · pubkey secp256r1 ${hex(h.pubKey)} (65B)`);
      add("agora toca em ASSINAR pra autorizar com biometria.");
    } catch (e) { add(`✗ ${(e as Error).message}`); } finally { setBusy(false); }
  }

  async function onSign() {
    if (!handle) return;
    setBusy(true); setVerdict(null);
    try {
      const challenge = crypto.getRandomValues(new Uint8Array(32));
      add(`desafio aleatório: ${hex(challenge)}`);
      add("pedindo Face ID / digital pra assinar…");
      const a = await getAssertion(challenge, handle.credId);
      add("✅ asserção capturada (Face ID respondeu)");

      // Verify the assertion is cryptographically valid against the minted key:
      // WebAuthn signs SHA256(authenticatorData || SHA256(clientDataJSON)).
      const cdHash = await sha256(a.clientDataJSON);
      const base = new Uint8Array(a.authenticatorData.length + cdHash.length);
      base.set(a.authenticatorData, 0);
      base.set(cdHash, a.authenticatorData.length);
      const key = await crypto.subtle.importKey(
        "raw", handle.pubKey as BufferSource,
        { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"],
      );
      const valid = await crypto.subtle.verify(
        { name: "ECDSA", hash: "SHA-256" }, key, a.signature as BufferSource, base as BufferSource,
      );
      // Also confirm the browser embedded our challenge in clientDataJSON.
      const cdj = new TextDecoder().decode(a.clientDataJSON);
      const b64 = btoa(String.fromCharCode(...challenge)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      const bound = cdj.includes(b64);
      add(`assinatura secp256r1 válida? ${valid ? "SIM ✅" : "NÃO ✗"}`);
      add(`desafio vinculado ao clientDataJSON? ${bound ? "SIM ✅" : "NÃO ✗"}`);
      setVerdict(valid && bound ? "ok" : "fail");
    } catch (e) { add(`✗ ${(e as Error).message}`); setVerdict("fail"); } finally { setBusy(false); }
  }

  return (
    <div className="min-h-screen bg-[#f1eee7] text-[#0a0a0a] grain overflow-x-hidden">
      <header className="px-5 md:px-10 py-5 flex items-center justify-between border-b border-[#0a0a0a]/8">
        <Logo />
        <Link to="/" className="text-[10px] uppercase tracking-[0.22em] hover:opacity-60">Home</Link>
      </header>
      <main className="max-w-[680px] mx-auto px-5 md:px-10 pt-12 pb-24">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#0a0a0a]/55 mb-5">
          ┃ teste de biometria · no seu aparelho
        </div>
        <h1 className="text-4xl md:text-6xl font-medium tracking-[-0.04em] leading-[0.98]">
          Paga com o rosto.<span className="inline-block w-2.5 h-2.5 bg-[#FDDA24] ml-2 align-baseline" />
        </h1>
        <p className="mt-6 text-base text-[#0a0a0a]/75 leading-relaxed max-w-[52ch]">
          Toca pra criar uma passkey com Face ID / digital, depois assina. A
          página verifica a assinatura secp256r1 no próprio aparelho — provando
          que a biometria que autoriza pagamento é real e válida aqui.
        </p>

        <div className="mt-10 flex flex-wrap gap-3">
          <button onClick={onCreate} disabled={busy}
            className="lift px-6 py-4 bg-[#0a0a0a] text-[#f1eee7] text-[11px] uppercase tracking-[0.22em] disabled:opacity-40">
            1 · Criar passkey (Face ID)
          </button>
          <button onClick={onSign} disabled={busy || !handle}
            className="lift px-6 py-4 bg-[#FDDA24] text-[#0a0a0a] text-[11px] uppercase tracking-[0.22em] font-medium disabled:opacity-40">
            2 · Assinar com biometria
          </button>
        </div>

        {verdict && (
          <div className="mt-8 p-5 border" style={{ borderColor: verdict === "ok" ? "#3f7d20" : "#b91c1c" }}>
            <div className="text-lg font-medium" style={{ color: verdict === "ok" ? "#3f7d20" : "#b91c1c" }}>
              {verdict === "ok" ? "✅ Biometria real, assinatura válida, desafio vinculado." : "✗ Falhou — veja o log."}
            </div>
            {verdict === "ok" && (
              <p className="text-sm text-[#0a0a0a]/70 mt-2">
                É exatamente essa asserção que o contrato Slippay verifica on-chain pra liberar um pagamento.
              </p>
            )}
          </div>
        )}

        <div className="mt-8">
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#0a0a0a]/55 mb-3">┃ log</div>
          <div className="bg-[#0a0a0a] text-[#FDDA24] font-mono text-xs p-4 min-h-[160px] whitespace-pre-wrap break-all">
            {log.length === 0 ? "// toca em 1 · Criar passkey\n" : log.join("\n")}
          </div>
        </div>

        <p className="mt-6 text-xs text-[#0a0a0a]/45 leading-relaxed">
          Precisa de um aparelho com Face ID / Touch ID / impressão digital e um
          navegador moderno (Safari iOS, Chrome Android). O pagamento on-chain
          completo (carteira + transfer) é a próxima etapa.
        </p>
      </main>
    </div>
  );
}
