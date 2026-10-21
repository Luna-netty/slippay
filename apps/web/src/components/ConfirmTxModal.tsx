import type { TxSummary, OpSummary } from "../lib/txguard.ts";

interface Props {
  summary: TxSummary;
  intent?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmTxModal({ summary, intent, onConfirm, onCancel }: Props) {
  const payments = summary.operations.filter((o) => o.type === "payment");

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-[#0a0a0a]/60"
      role="dialog"
      aria-modal="true"
      aria-label="Confirmar transação"
    >
      <div className="bg-[#f1eee7] text-[#0a0a0a] w-full max-w-md sm:mx-4 p-6 sm:p-8 shadow-2xl max-h-[90dvh] overflow-y-auto">
        {/* Header */}
        <div className="text-[10px] uppercase tracking-[0.18em] text-[#0a0a0a]/55 mb-6">
          <span className="inline-block w-2 h-2 bg-[#0a0a0a]/70 mr-2 align-middle" />
          Confirmar transação
        </div>

        {/* Intent — shown prominently above decoded summary when present */}
        {intent && (
          <div className="mb-6 px-4 py-3 bg-[#0a0a0a]/5 border-l-2 border-[#0a0a0a]">
            <p className="text-sm font-bold text-[#0a0a0a]">{intent}</p>
          </div>
        )}

        {/* Operations */}
        <div className="space-y-6">
          {payments.length === 0 && (
            <div className="text-sm text-[#0a0a0a]/70">
              Nenhum pagamento detectado nesta transação.
            </div>
          )}

          {payments.map((op, i) => (
            <PaymentRow key={i} op={op} />
          ))}
        </div>

        {/* Memo */}
        {summary.memo && (
          <div className="mt-6 border-l-2 border-[#0a0a0a]/20 pl-4">
            <Label>Memo</Label>
            <div className="font-mono text-sm break-all">{summary.memo}</div>
          </div>
        )}

        {/* Source */}
        <div className="mt-4 border-l-2 border-[#0a0a0a]/10 pl-4">
          <Label>Conta origem</Label>
          <div className="font-mono text-xs break-all text-[#0a0a0a]/70">{summary.source}</div>
        </div>

        {/* Reassurance (control) + warning (consequence) */}
        <div className="mt-6 space-y-2">
          <div className="text-[10px] uppercase tracking-[0.14em] text-[#0a0a0a]/50">
            Assinado pela carteira da sua empresa · a Slippay não pode mover seus fundos.
          </div>
          <div className="text-[10px] uppercase tracking-[0.14em] text-[#0a0a0a]/70 border-l-2 border-[#0a0a0a] pl-3">
            Confira o destino e o valor. Esta ação não pode ser desfeita.
          </div>
        </div>

        {/* Actions */}
        <div className="mt-8 flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 border border-[#0a0a0a] py-4 text-sm uppercase tracking-[0.18em] hover:bg-[#0a0a0a]/5"
          >
            Cancelar
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 bg-[#0a0a0a] text-[#f1eee7] py-4 text-sm uppercase tracking-[0.18em] hover:bg-[#1a1a1a]"
          >
            Confirmar
          </button>
        </div>
      </div>
    </div>
  );
}

function ChunkedAddress({ value }: { value?: string }) {
  if (!value) return <div className="font-mono text-sm">—</div>;
  const groups = value.match(/.{1,4}/g) ?? [value];
  const head = value.slice(0, 6);
  const tail = value.slice(-6);
  return (
    <div className="space-y-1.5">
      <div className="font-mono text-xs break-all leading-relaxed text-[#0a0a0a]/70 tracking-wide">
        {groups.join(" ")}
      </div>
      <div className="font-mono text-base">
        <span className="font-bold">{head}</span>
        <span className="text-[#0a0a0a]/35">…</span>
        <span className="font-bold">{tail}</span>
        <span className="ml-2 text-[10px] uppercase tracking-[0.14em] text-[#0a0a0a]/40">confira início e fim</span>
      </div>
    </div>
  );
}

function PaymentRow({ op }: { op: OpSummary }) {
  return (
    <div className="space-y-2">
      <div>
        <Label>Destino</Label>
        <ChunkedAddress value={op.destination} />
      </div>
      <div className="flex gap-8">
        <div>
          <Label>Valor</Label>
          <div className="text-2xl font-medium tabular-nums">
            {op.amount ?? "—"}
          </div>
        </div>
        <div>
          <Label>Ativo</Label>
          <div className="text-2xl font-medium">{op.assetCode ?? "—"}</div>
        </div>
      </div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] uppercase tracking-[0.18em] text-[#0a0a0a]/55 mb-1">
      {children}
    </div>
  );
}
