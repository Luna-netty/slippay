# MECHANISM 2 — semantic decode-grammar compiler

Compile a money-policy into a formal **grammar** whose **language is exactly the
set of valid `(recipient, amount)` decisions**. A deterministic matcher then
*proves* that a forbidden recipient or an over-balance amount is **not in the
language** — i.e. cannot be produced by a decoder constrained to this grammar.

This is stronger than JSON-schema structured output. A JSON schema constrains
**shape** (`recipient` is a string, `amount` is an integer). This grammar
constrains **values**: `recipient` must be one of a finite literal set, and
`amount` must be a decimal numeral denoting an integer `<= max_amount`.

## API

```python
from grammar import (
    compile_policy_to_grammar,  # (allowlist, max_amount) -> Grammar
    accepts,                    # (grammar, candidate: str) -> bool   EXACT membership
    to_gbnf,                    # (grammar) -> str   GBNF wire format
    make_decision,              # (recipient, amount) -> canonical decision string
)

g = compile_policy_to_grammar(["GABCDEF1234567890", "GHIJKL0987654321"], 1000)

accepts(g, make_decision("GABCDEF1234567890", 1000))   # True  (max boundary)
accepts(g, make_decision("GABCDEF1234567890", 1001))   # False (over balance)
accepts(g, make_decision("GATTACKER000000", 5))        # False (forbidden recipient)
```

### Canonical decision envelope

The grammar pins one serialization so that *language membership == decision
validity*:

```
{"recipient":"<addr>","amount":<numeral>}
```

No optional whitespace, no field reordering, no extra fields, `amount`
unquoted. Alternate shapes are not in the language (see
`test_malformed_envelope_rejected`).

## How the bound is enforced at the grammar level

The load-bearing piece is the bounded-integer sub-grammar. The bound is **not**
a post-hoc numeric comparison — it is a digit-by-digit regular grammar that
**cannot derive** a numeral greater than `max_amount`. For `max_amount = 1000`:

```
amount ::= "0" | [1-9] | [1-9] [0-9] | [1-9] [0-9] [0-9] | "1000"
```

Read it: zero; any 1-digit; any 2-digit; any 3-digit; or exactly `1000`. That is
exactly `[0, 1000]`. There is no production for `1001`. The construction
generalizes to any bound via positional decomposition of the bound's digits
(see `bounded_int_alternatives` docstring for the proof sketch).

## GBNF (wire-ready)

`to_gbnf(grammar)` emits the grammar in **GBNF** (GGML BNF), the format consumed
by **llama.cpp**, and supported by **vLLM** and **Outlines** for
grammar-constrained sampling. The `root` rule is the entry point.

```gbnf
root ::= decision
decision ::= "{\"recipient\":\"" recipient "\",\"amount\":" amount "}"
recipient ::= "GABCDEF1234567890" | "GHIJKL0987654321"
amount ::= "0" | [1-9] | [1-9] [0-9] | [1-9] [0-9] [0-9] | "1000"
```

## HONESTY — what is proven vs. what is infra-gated

**Proven here (by the test suite, no external infra):**

- The matcher `accepts()` decides membership in the grammar's language
  **exactly**. It is a pure, deterministic recursive matcher with a
  left-recursion guard.
- The grammar's language is **exactly** the allowed set. This is established by
  *brute-force* in `test_bounded_int_language_is_exactly_range`: for every
  integer `n` in a window around `[0, max]`, `str(n)` is in the language **iff**
  `n <= max`. Recipient acceptance/rejection and the canonical-envelope
  structure are tested directly. Boundary numerals `max` (accepted) and `max+1`
  (rejected) are tested explicitly.
- The GBNF emitter produces syntactically well-formed GBNF rule lines (shape
  asserted in tests).

**NOT proven here / infra-gated:**

- Running this **as constrained decoding against a live model** is **not** done
  here. Grammar-constrained sampling requires a self-hosted engine that exposes
  a grammar/logit-mask hook (llama.cpp `grammar=`, vLLM
  `guided_decoding`/`GuidedDecodingParams(grammar=...)`, or Outlines
  `outlines.generate.cfg`). **None of `llama_cpp`, `outlines`, or a GPU is
  present in this environment** (verified: import fails, `nvidia-smi` absent).
  So this build does **not** and **must not** claim that a live model is
  currently constrained.
- The GBNF text has **not** been validated by an actual llama.cpp/vLLM/Outlines
  parser in this environment (those engines are not installed). It is emitted to
  their documented grammar syntax and is shape-checked by tests, but
  round-tripping it through a real engine is part of the infra-gated wiring.

**The honest claim:** *the grammar is correct and wire-ready.* The matcher
proves the grammar's language equals the allowed `(recipient, amount)` set. To
make it a generation-time impossibility against a real decoder, feed the emitted
GBNF into a grammar-constrained sampler on a self-hosted engine — that wiring is
the infra-gated step, not done here.

### Wiring sketch (for when infra exists)

```python
# llama.cpp via llama-cpp-python
from llama_cpp import Llama, LlamaGrammar
gbnf = to_gbnf(compile_policy_to_grammar(allowlist, max_amount))
grammar = LlamaGrammar.from_string(gbnf)
out = llm(prompt, grammar=grammar)            # sampler masked to the language

# vLLM
from vllm.sampling_params import GuidedDecodingParams, SamplingParams
sp = SamplingParams(guided_decoding=GuidedDecodingParams(grammar=gbnf))

# Outlines (CFG-constrained)
import outlines
gen = outlines.generate.cfg(model, gbnf)
```

## Run

```bash
python3 -m pytest test_grammar.py -v     # 61 tests
python3 demo.py                          # prints GBNF + membership decisions
```

## Files

- `grammar.py` — compiler, matcher, GBNF emitter.
- `test_grammar.py` — TDD suite (exhaustive bounded-int + policy + GBNF).
- `demo.py` — runnable example.
- `README.md` — this file.
