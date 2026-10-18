// Camera QR scanner — opens the rear camera, decodes with jsQR every frame,
// fires onScan with the decoded text. Works on iOS Safari + Android Chrome
// (HTTPS + camera permission required). jsQR is bundled (no BarcodeDetector
// dependency, which Safari lacks).

import { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";

export function QrScanner({ onScan, onClose }: { onScan: (text: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const firedRef = useRef(false);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    let cancelled = false;

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        const video = videoRef.current!;
        video.srcObject = stream;
        video.setAttribute("playsinline", "true");
        await video.play();

        const canvas = canvasRef.current!;
        const ctx = canvas.getContext("2d", { willReadFrequently: true })!;

        const tick = () => {
          if (cancelled || firedRef.current) return;
          if (video.readyState === video.HAVE_ENOUGH_DATA) {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const code = jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" });
            if (code && code.data) {
              firedRef.current = true;
              onScan(code.data);
              return;
            }
          }
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      } catch (e) {
        setErr((e as Error).name === "NotAllowedError"
          ? "Permissão de câmera negada. Libera a câmera e tenta de novo."
          : `Câmera indisponível: ${(e as Error).message}`);
      }
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      if (stream) stream.getTracks().forEach((t) => t.stop());
    };
  }, [onScan]);

  return (
    <div className="fixed inset-0 z-50 bg-[#0a0a0a] flex flex-col items-center justify-center">
      <video ref={videoRef} className="absolute inset-0 w-full h-full object-cover" muted playsInline />
      <canvas ref={canvasRef} className="hidden" />
      {/* framing reticle */}
      <div className="relative z-10 w-[70vw] max-w-[300px] aspect-square border-2 border-[#FDDA24]" />
      <div className="relative z-10 mt-8 text-[#f1eee7] text-sm font-mono uppercase tracking-[0.18em]">
        {err ?? "aponta pro QR de cobrança"}
      </div>
      {err && <div className="relative z-10 mt-3 text-[#f1eee7]/70 text-xs max-w-[80vw] text-center">{err}</div>}
      <button onClick={onClose}
        className="relative z-10 mt-10 px-6 py-3 border border-[#f1eee7]/40 text-[#f1eee7] text-[11px] uppercase tracking-[0.22em]">
        Cancelar
      </button>
    </div>
  );
}
