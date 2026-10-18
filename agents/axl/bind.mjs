// Axl `bind` primitive — the first MECHANICAL Axl construct (not prose).
//
// Compiles a declarative capability binding into the exact `tools=[...]` array
// passed to the model. The model's action space IS this array: a capability not
// bound has no schema, so no valid tool_use for it can be emitted — prompt
// injection cannot conjure a tool that does not exist in the request.
//
// Enforcement boundary: this compiler runs in the orchestrator that BUILDS the
// API request, outside the agent's reach. The agent never sees or edits its own
// binding. That placement is the whole guarantee — keep it there.
//
// Maps to: Anthropic/OpenAI `tools` parameter. Defends OWASP LLM06 (Excessive
// Agency) by construction.

// Parse `bind <Agent> -> [cap_a, cap_b, ...]` into { agent, capabilities }.
export function parseBind(line) {
  const m = /^\s*bind\s+(\w+)\s*->\s*\[([^\]]*)\]\s*$/.exec(line);
  if (!m) throw new Error(`malformed bind declaration: ${line}`);
  const agent = m[1];
  const capabilities = m[2]
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return { agent, capabilities };
}

// Compile a capability list against the full tool registry into the toolset the
// model is actually given. Default-deny (only listed caps pass) and fail-closed
// (an unknown capability is a config error, never a silent drop).
export function compileToolset(capabilities, registry) {
  const tools = [];
  for (const cap of capabilities) {
    const def = registry[cap];
    if (!def) throw new Error(`unknown capability: ${cap}`);
    tools.push(def);
  }
  return tools;
}
