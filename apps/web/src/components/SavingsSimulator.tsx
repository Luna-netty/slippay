// Interactive "volume that never sleeps" calculator — the 2.97% flat model.
// Agents pay 24/7; the merchant absorbs a flat 2.97% and collects the rest in
// dollars, final, with zero chargebacks. Honest: this is roughly at parity with
// a card rate (2.97% vs ~2.9%). It sells what cards can't do: certainty,
// finality, dollars, and agents that can pay at all.
import { useMemo, useState } from "react";

const FEE = 0.0297;
const fmt = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

function Slider({
  label, value, min, max, step, onChange, display,
}: {
  label: string; value: number; min: number; max: number; step: number;
  onChange: (v: number) => void; display: string;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#0a0a0a]/55">{label}</span>
        <span className="font-semibold tabular-nums text-lg">{display}</span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-[#0a0a0a] cursor-pointer"
      />
    </div>
  );
}

export function SavingsSimulator() {
  const [perDay, setPerDay] = useState(200);  // payments per day
  const [avg, setAvg] = useState(8);          // avg payment $

  const { volume, keep, fee } = useMemo(() => {
    const volume = perDay * 30 * avg;
    return { volume, keep: volume * (1 - FEE), fee: volume * FEE };
  }, [perDay, avg]);

  return (
    <section className="border-t border-[#0a0a0a]/10">
      <div data-reveal className="max-w-[1180px] mx-auto px-5 md:px-10 py-20 md:py-28">
        <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-[#0a0a0a]/45 mb-4">agents pay 24/7 · do the math</div>
        <h2 className="text-3xl md:text-5xl font-semibold tracking-[-0.03em] max-w-[22ch]">2.97% flat. In dollars. Final. Zero chargebacks.</h2>

        <div className="mt-12 grid lg:grid-cols-[1fr_1.1fr] gap-10 lg:gap-16 items-center">
          {/* controls */}
          <div className="space-y-9">
            <Slider
              label="payments / day" value={perDay} min={10} max={5000} step={10}
              onChange={setPerDay} display={perDay.toLocaleString("en-US")}
            />
            <Slider
              label="average payment" value={avg} min={1} max={400} step={1}
              onChange={setAvg} display={fmt(avg)}
            />
            <div className="font-mono text-[11px] text-[#0a0a0a]/45 leading-relaxed max-w-[40ch]">
              ≈ {fmt(volume)} / month. Cards charge less up front — then claw back chargebacks for
              months, hold your money, and can&rsquo;t let an agent pay at all. This is flat, final, today.
            </div>
          </div>

          {/* live result */}
          <div className="bg-[#0a0a0a] text-[#f1eee7] rounded-2xl p-8 md:p-10">
            <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#f1eee7]/45 mb-1">you collect, every month</div>
            <div className="text-5xl md:text-6xl font-semibold tabular-nums tracking-[-0.03em] text-[#FDDA24] leading-none">{fmt(keep)}</div>
            <div className="font-mono text-[11px] text-[#f1eee7]/50 mt-3">in dollars · final in ~5s · no chargebacks</div>

            <div className="mt-8 pt-6 border-t border-[#f1eee7]/12 flex items-baseline justify-between">
              <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#f1eee7]/45">SlipPay fee · 2.97% flat</span>
              <span className="text-2xl md:text-3xl font-semibold tabular-nums">{fmt(fee)}</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
