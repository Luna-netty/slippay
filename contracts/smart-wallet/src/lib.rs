//! Slippay Smart Wallet — Soroban custom account with on-chain spending policies.
//!
//! **Composition with `slippay-subscription`.** This contract is intended to be
//! the `buyer` (a C-address smart account) in a slippay-subscription. The
//! subscription contract's `charge()` invokes `token.transfer(buyer, merchant,
//! amount)` which triggers Soroban's auth machinery on the buyer. With a
//! classic G-address buyer, that means the buyer must sign every charge. With
//! this smart wallet as buyer, `__check_auth` is consulted instead, and
//! authorization is granted *without a fresh signature* as long as the call
//! matches an active on-chain spending policy that the user pre-installed.
//!
//! **The product property this enables.** The spending limit (per-merchant
//! max amount, period, expiry, revocation) lives in this contract's
//! persistent storage — not in any Slippay backend, not in any custodian.
//! Only the user, via a passkey/WebAuthn signature, can install, modify, or
//! revoke a policy. Slippay's backend, the merchant, and the network
//! validators cannot bypass the policy. This is what Stripe structurally
//! cannot offer: a user-enforced limit that the platform itself cannot
//! override.
//!
//! **v0.1 scope (spike).** Single-signer (one passkey per wallet). Per-merchant
//! policies keyed by the merchant Address. The merchant authorizes via
//! `token.transfer(this_wallet, merchant, amount)`. `__check_auth` decodes
//! the auth context, looks up the per-merchant policy, validates cap +
//! interval + revocation + expiry, and authorizes without consulting the
//! passkey. For any context that does not match a policy (e.g. an
//! `install_policy` or `revoke_policy` invocation), `__check_auth` verifies
//! the passkey's secp256r1 signature over the host-provided payload.
//!
//! **Passkey verification.** Soroban Protocol 21 added native secp256r1
//! verification (CAP-0051) — the curve used by WebAuthn / passkeys. The
//! wallet stores the passkey's secp256r1 public key (65-byte uncompressed
//! X9.62) and credential id at `init` time. `__check_auth` invokes
//! `env.crypto().secp256r1_verify(pubkey, payload, signature)` which panics
//! on failure (translated by the host into an auth rejection).
//!
//! For the v0.1 spike, `signature_payload` is the raw host-provided digest
//! and `signature` is the raw 64-byte (r || s) secp256r1 signature. The
//! frontend is responsible for delivering a signature that satisfies this.
//! Full WebAuthn unwrapping (authenticatorData + clientDataJSON binding)
//! lands in v0.2 — concretely, the wallet will require the frontend to pass
//! both blobs and verify that `sha256(authenticatorData || sha256(clientDataJSON))`
//! equals `signature_payload` before running secp256r1_verify.
//!
//! TTL: every persistent `set` is followed by `extend_ttl`, mirroring the
//! audit-002 F1 pattern from `slippay-subscription`.

#![no_std]
// The contract's public API surface (install_policy / install_agent_session /
// __check_auth) intentionally takes more than clippy's 7-argument threshold —
// each parameter is a distinct on-chain policy field, and bundling them into a
// struct would change the contract ABI the off-chain scripts and frontend call.
// The `#[contractimpl]` macro also generates client methods that inherit these
// arities. Scope the allow at crate level so macro-expanded code is covered too.
#![allow(clippy::too_many_arguments)]
// `env.events().publish(...)` is deprecated in soroban-sdk 26.1.x in favor of
// the `#[contractevent]` macro. Migrating would change the on-chain event
// encoding (topic/data layout) that indexers and the SSL drift detector bind to
// (see install_agent_session). Out of scope for the C2/C3 audit fixes; keep the
// existing event ABI; the only deprecated usage in this crate is these five
// intentional `publish` calls, so allow `deprecated` at crate level.
#![allow(deprecated)]
use soroban_sdk::{
    auth::{Context, ContractContext},
    contract, contracterror, contractimpl, contracttype,
    panic_with_error,
    Address, Bytes, BytesN, Env, Symbol, TryFromVal, Val, Vec,
};

// Mirror of slippay-subscription audit-002 F1 TTL constants. The host clamps
// to its protocol maximum so passing a generous target is safe.
const TTL_THRESHOLD_LEDGERS: u32 = 17_280;   // ~1 day at 5s/ledger
const TTL_TARGET_LEDGERS: u32 = 535_000;     // ~31 days at 5s/ledger (clamped)

/// SECURITY_AUDIT N1 · maximum cap multiplier. `max_per_charge` may be at
/// most `amount_per_charge * MAX_CAP_MULTIPLIER`. Limits blast radius of
/// admin compromise (see DEPLOYED.md gap C3).
const MAX_CAP_MULTIPLIER: i128 = 10;

/// SECURITY_AUDIT A2 · maximum window multiplier. `window_cap` may be at most
/// `per_tx_cap * MAX_WINDOW_MULTIPLIER`. Bounds how much larger an aggregate
/// window can be than a single transfer, limiting blast radius of a stolen hot
/// session key + compromised admin. Mirrors the policy path's N1 guard.
const MAX_WINDOW_MULTIPLIER: i128 = 100;

/// AXL-PROVED real-time-window multiplier. `axlc prove agent_wallet_m2.axl`
/// (Z3, k-induction) certifies that the deployed sliding-window policy's
/// worst-case outflow over ANY real window of length `window_seconds` is bounded
/// by `PROVED_WINDOW_MULTIPLIER * window_cap` — and that this bound is TIGHT and
/// MINIMAL (the 2× is the epoch-straddle worst case, not slack; 1× is unsound).
/// This constant is the SINGLE on-chain source of that bound: it is written into
/// every `AgentSession` at install (`window_cap_multiplier`, pinned alongside
/// `ssl_hash`) and read back by the hot path (`try_authorize_agent_transfer`)
/// to compute the hard ceiling. The `axl-gate` CI workflow asserts this literal
/// equals the certified `window_cap_multiplier` in
/// `axl-compiler/certified/agent_wallet.cert.json`, so the deployed enforcement
/// and its proof cannot silently drift. Must stay within `MAX_CAP_MULTIPLIER`.
const PROVED_WINDOW_MULTIPLIER: u32 = 2;
// Compile-time guard: the proved bound must be within the admin-blast-radius cap.
const _: () = assert!(PROVED_WINDOW_MULTIPLIER as i128 <= MAX_CAP_MULTIPLIER);
const _: () = assert!(PROVED_WINDOW_MULTIPLIER >= 1);

/// On-chain per-merchant spending policy. The wallet authorizes any
/// `token.transfer` whose merchant + amount + interval fall inside these
/// constraints, without consulting the user's passkey again.
#[contracttype]
#[derive(Clone, Debug)]
pub struct Policy {
    /// Exact merchant Address allowed to pull funds under this policy.
    pub merchant: Address,
    /// Token contract (SEP-41) the merchant may transfer from this wallet.
    pub token: Address,
    /// Expected charge amount per cycle (informational).
    pub amount_per_charge: i128,
    /// Hard cap per cycle. Charges above this are rejected by `__check_auth`.
    pub max_per_charge: i128,
    /// Minimum gap between successful charges, in seconds.
    pub interval_seconds: u64,
    /// Unix timestamp after which the policy auto-revokes. 0 = no expiry.
    pub expires_at: u64,
    /// Ledger timestamp of the most recent authorized charge under this
    /// policy. 0 = never charged.
    pub last_charge_at: u64,
    /// User-set kill switch. Once true, all subsequent merchant pulls fail
    /// authorization until the user re-installs the policy.
    pub revoked: bool,
}

/// Delegated agent spending session. Unlike `Policy` (a *pull* grant keyed by
/// a single merchant), this is a *push* grant: a delegated ed25519 session key
/// the user authorizes once (via passkey) so an autonomous agent can initiate
/// transfers within an aggregate budget — without a fresh human signature per
/// transaction.
///
/// **A3 — sliding-window counter.** The budget is enforced with an O(1)
/// sliding-window counter (no per-tx history). We keep the spend of the
/// current epoch (`cur_spent`) and the immediately preceding epoch
/// (`prev_spent`), and estimate the rolling spend as a time-weighted sum of
/// the two for throughput shaping, while staying gas-bounded under
/// high-frequency agent traffic.
///
/// **Worst-case guarantee (N-A3).** The time-weighted estimate counts
/// `cur_spent` at full weight regardless of *when* in the epoch it was spent.
/// A "delayed straddle" — spend late in one epoch, roll, spend early in the
/// next — can therefore place spend that exceeds `window_cap` inside a single
/// real `window_seconds`-length interval (such an interval overlaps at most
/// two adjacent epochs). The guarantee is therefore NOT `<= window_cap`; it is
/// that the worst-case spend over ANY `window_seconds`-length real-time
/// interval is bounded by **2 × window_cap**. This bound is enforced by a hard
/// un-weighted ceiling (`prev_spent + cur_spent + amount <= 2 * window_cap`,
/// see `try_authorize_agent_transfer`) layered over the weighted estimate.
/// Size `window_cap` to **half** of the maximum exposure you are willing to
/// accept per window.
#[contracttype]
#[derive(Clone, Debug)]
pub struct AgentSession {
    /// ed25519 public key the agent signs transfer payloads with.
    pub session_pubkey: BytesN<32>,
    /// Token contract (SEP-41) the agent may transfer from this wallet.
    pub token: Address,
    /// Hard cap per single transfer.
    pub per_tx_cap: i128,
    /// Length of the spending window, in seconds (e.g. 86_400 = 24h).
    pub window_seconds: u64,
    /// Aggregate cap across the rolling window. The time-weighted estimate of
    /// spend across (prev epoch, current epoch) must stay <= this.
    pub window_cap: i128,
    /// Unix timestamp the current epoch opened. Epochs are rolled lazily on
    /// charge: a charge at `now >= epoch_start + window_seconds` opens a new
    /// epoch anchored at `now` (sliding, not grid-aligned).
    pub epoch_start: u64,
    /// Amount spent so far in the current epoch.
    pub cur_spent: i128,
    /// Amount spent in the immediately preceding epoch. Decays linearly across
    /// the current epoch in the rolling estimate. 0 if the gap to the previous
    /// epoch was >= 2 windows (fully decayed).
    pub prev_spent: i128,
    /// Unix timestamp after which the session auto-revokes. 0 = no expiry.
    pub expires_at: u64,
    /// User-set kill switch. Once true, all agent transfers fail until the
    /// session is re-installed.
    pub revoked: bool,
    /// Recipient allowlist. Empty = open (any recipient within budget). When
    /// non-empty, the agent may only pay these addresses — the core of the
    /// agent-to-agent guarantee (pay only approved counterparties).
    pub allow_recipients: Vec<Address>,
    /// SSL/Axl provenance: sha256 of the `.ssl` spec that governed this agent
    /// at install time. The contract does not interpret it (SSL is declarative,
    /// not runtime-enforced here) — it pins it immutably so every spend made
    /// under this session is non-repudiably tied to one governing policy. The
    /// off-chain drift detector diffs observed spend against the spec at this
    /// hash; that diff, not the hash, is the compliance evidence.
    pub ssl_hash: BytesN<32>,
    /// AXL-proved real-time-window multiplier for THIS session, pinned at install
    /// to `PROVED_WINDOW_MULTIPLIER` and bound to `ssl_hash`. The hot path reads
    /// this field (not a source literal) to compute the hard ceiling
    /// `window_cap * window_cap_multiplier`, so every spend made under this
    /// session is tied on-chain to the exact bound an auditor can re-check
    /// against the `axlc` certificate for the policy at `ssl_hash`.
    pub window_cap_multiplier: u32,
}

/// Agent credential carried in the `__check_auth` signature slot: the agent's
/// ed25519 session pubkey plus its signature over the host payload.
#[contracttype]
#[derive(Clone, Debug)]
pub struct AgentAuth {
    pub session_pubkey: BytesN<32>,
    pub signature: BytesN<64>,
}

/// A REAL WebAuthn assertion (what `navigator.credentials.get()` returns on a
/// Face ID / fingerprint tap), carried in the `__check_auth` signature slot.
///
/// The platform authenticator does NOT sign the raw Soroban payload — it signs
/// `SHA256(authenticator_data || SHA256(client_data_json))` with the device's
/// secp256r1 key, and embeds the challenge (= the Soroban signature_payload,
/// base64url-no-pad) inside `client_data_json`. `__check_auth` therefore:
///   1. binds the assertion to THIS transaction — base64url(signature_payload)
///      MUST appear in `client_data_json` (replay/cross-tx defense),
///   2. reconstructs the WebAuthn signing digest and verifies it against the
///      device's stored secp256r1 pubkey.
/// `signature` is the raw 64-byte (r||s) form; the frontend converts the
/// authenticator's DER signature before submitting.
#[contracttype]
#[derive(Clone, Debug)]
pub struct WebAuthnAuth {
    pub authenticator_data: Bytes,
    pub client_data_json: Bytes,
    pub signature: BytesN<64>,
}

/// The wallet's custom-account signature type (CAP-46-11). The caller declares
/// which principal is authorizing: the human passkey (real WebAuthn assertion,
/// secp256r1) or a delegated agent session (ed25519).
#[contracttype]
#[derive(Clone, Debug)]
pub enum WalletAuth {
    Passkey(WebAuthnAuth),
    Agent(AgentAuth),
}

#[contracttype]
pub enum DataKey {
    /// Passkey public key (secp256r1, 65-byte uncompressed X9.62 = 0x04 ||
    /// X || Y). Set once at deploy via `__constructor` (atomic with deploy —
    /// SECURITY_AUDIT C2: no un-inited window an observer can front-run).
    PasskeyPubkey,
    /// Optional passkey credential id (returned by WebAuthn `navigator
    /// .credentials.create`). Stored so the frontend can issue a correct
    /// `allowCredentials` parameter on subsequent `get` calls.
    PasskeyCredId,
    /// v0.1 administrator. Calls to `install_policy` and `revoke_policy`
    /// require this address's `require_auth`. For the spike, admin is a
    /// classic Ed25519 G-account (the trusted-setup oracle that operates
    /// the spike server). v0.2 changes `init` to set admin =
    /// `env.current_contract_address()` so that install/revoke flow back
    /// through `__check_auth` and require the user's passkey.
    Admin,
    /// Per-merchant policy. Address is keyed verbatim — a policy applies to
    /// exactly one merchant address (no wildcards in v0.1).
    Policy(Address),
    /// Delegated agent session, keyed by the agent's ed25519 session pubkey.
    AgentSession(BytesN<32>),
    /// SECURITY_AUDIT C3 · immutable absolute ceiling on any single per-charge
    /// amount/cap, set once at `__constructor` and NEVER settable again. Both
    /// `install_policy` and `install_agent_session` reject any amount/cap above
    /// this value, so a fully compromised admin cannot drain more than this in a
    /// single charge regardless of the ratio guards (N1 / A2.3).
    MaxAbsolutePerCharge,
}

#[contracterror]
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    PolicyNotFound = 3,
    PolicyRevoked = 4,
    PolicyExpired = 5,
    AmountExceedsCap = 6,
    PeriodNotElapsed = 7,
    AuthContextUnsupported = 8,
    SignatureInvalid = 9,
    InvalidConfig = 10,
    SessionNotFound = 11,
    SessionRevoked = 12,
    SessionExpired = 13,
    WindowCapExceeded = 14,
    RecipientNotAllowed = 15,
    EmptyAllowlist = 16,
    SessionExists = 17,
    /// SECURITY_AUDIT C3 · a per-charge amount/cap exceeds the wallet's
    /// immutable absolute ceiling (`max_absolute_per_charge`, set once at
    /// `__constructor`). Caps the per-charge drain independent of the ratio
    /// guards, even with a fully compromised admin.
    ExceedsAbsoluteCeiling = 18,
}

#[contract]
pub struct SmartWallet;

#[contractimpl]
impl SmartWallet {
    /// SECURITY_AUDIT C2 · atomic deploy+init constructor. Soroban runs
    /// `__constructor` exactly once, in the SAME transaction as the deploy that
    /// creates the contract. There is therefore NO un-inited window between
    /// deploy and init for an observer to front-run with their own passkey +
    /// admin (the C2 finding). The wallet is fully owned by the deployer-chosen
    /// principals the instant it exists on-chain.
    ///
    /// Args:
    /// - `passkey_pubkey`: the passkey's secp256r1 public key (65-byte
    ///   uncompressed X9.62 = 0x04 || X || Y).
    /// - `passkey_cred_id`: the WebAuthn credential id.
    /// - `admin`: gates `install_policy` / `revoke_policy` / agent-session
    ///   mutations in v0.1. For the spike, callers pass the deployer's classic
    ///   G-account so the trusted-setup server can sign these. v0.2 migrates the
    ///   admin to the wallet's own contract address so install/revoke flow back
    ///   through `__check_auth` and are gated by the user's passkey.
    /// - `max_absolute_per_charge`: SECURITY_AUDIT C3 · the IMMUTABLE absolute
    ///   ceiling on any single per-charge amount/cap. Set once here and never
    ///   settable again; `install_policy` and `install_agent_session` reject any
    ///   amount/cap above it. Caps the per-charge drain absolutely even with a
    ///   fully compromised admin — independent of the ratio guards (N1 / A2.3).
    ///   Must be > 0.
    pub fn __constructor(
        env: Env,
        passkey_pubkey: BytesN<65>,
        passkey_cred_id: BytesN<32>,
        admin: Address,
        max_absolute_per_charge: i128,
    ) {
        // The host guarantees `__constructor` runs exactly once at deploy, so a
        // double-init guard is unnecessary here. We still reject a non-positive
        // ceiling — a zero/negative absolute ceiling would make every
        // install_policy / install_agent_session impossible (or, worse, defeat
        // the C3 guard if mishandled).
        if max_absolute_per_charge <= 0 {
            panic_with_error!(&env, Error::InvalidConfig);
        }
        env.storage().instance().set(&DataKey::PasskeyPubkey, &passkey_pubkey);
        env.storage().instance().set(&DataKey::PasskeyCredId, &passkey_cred_id);
        env.storage().instance().set(&DataKey::Admin, &admin);
        // C3: persist the immutable absolute ceiling. There is intentionally NO
        // setter for this key anywhere in the contract — it is write-once here.
        env.storage()
            .instance()
            .set(&DataKey::MaxAbsolutePerCharge, &max_absolute_per_charge);
        env.events().publish(
            (Symbol::new(&env, "wallet_initialized"),),
            (passkey_pubkey, passkey_cred_id, admin, max_absolute_per_charge),
        );
    }

    /// SECURITY_AUDIT C2 · guarded no-op kept only to default-deny a stray
    /// `init` call. Initialization is now atomic via `__constructor`, so by the
    /// time the contract exists `PasskeyPubkey` is always present. Any direct
    /// `init` invocation — e.g. a front-runner attempting the old C2 exploit —
    /// therefore always errors `AlreadyInitialized`. It can never (re)claim
    /// ownership or reset state.
    pub fn init(
        env: Env,
        _passkey_pubkey: BytesN<65>,
        _passkey_cred_id: BytesN<32>,
        _admin: Address,
    ) {
        // Constructor already ran at deploy; this path is unreachable for
        // legitimate setup and exists solely to reject front-running attempts.
        panic_with_error!(&env, Error::AlreadyInitialized);
    }

    /// Install (or replace) a spending policy for a specific merchant. Requires
    /// the wallet's own auth — i.e., a passkey signature validated by
    /// `__check_auth`. This is the *only* path to grant a merchant the right
    /// to pull funds.
    pub fn install_policy(
        env: Env,
        merchant: Address,
        token: Address,
        amount_per_charge: i128,
        max_per_charge: i128,
        interval_seconds: u64,
        expires_at: u64,
    ) {
        // v0.1: install gated by an admin Ed25519 G-account set at init.
        // For the spike, admin is the deployer key driving the trusted-setup
        // server. v0.2 migrates admin to `env.current_contract_address()`
        // so install flows through `__check_auth` and is gated by the
        // user's passkey via secp256r1_verify.
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .unwrap_or_else(|| panic_with_error!(&env, Error::NotInitialized));
        admin.require_auth();

        if amount_per_charge <= 0 || max_per_charge < amount_per_charge {
            panic_with_error!(&env, Error::InvalidConfig);
        }
        // SECURITY_AUDIT N1 (second pass): bound max_per_charge to a small
        // multiple of amount_per_charge. Without this, a compromised admin
        // could install max=i128::MAX and drain the wallet to the policy
        // merchant in a single transfer. 10x amount gives merchants room
        // to handle proration / fee bumps while keeping blast radius small.
        let max_allowed = amount_per_charge.saturating_mul(MAX_CAP_MULTIPLIER);
        if max_per_charge > max_allowed {
            panic_with_error!(&env, Error::InvalidConfig);
        }
        // SECURITY_AUDIT C3: absolute per-charge ceiling. The ratio guard above
        // (max <= amount*10) is RELATIVE — a compromised admin can still set
        // amount_per_charge = full balance and pass it trivially. The immutable
        // `max_absolute_per_charge` (set once at __constructor) caps BOTH the
        // expected amount AND the hard cap absolutely, so the single-charge
        // drain is bounded no matter what ratios the admin chooses.
        let max_absolute: i128 = env
            .storage()
            .instance()
            .get(&DataKey::MaxAbsolutePerCharge)
            .unwrap_or_else(|| panic_with_error!(&env, Error::NotInitialized));
        if amount_per_charge > max_absolute || max_per_charge > max_absolute {
            panic_with_error!(&env, Error::ExceedsAbsoluteCeiling);
        }
        if interval_seconds < 60 {
            panic_with_error!(&env, Error::InvalidConfig);
        }
        if expires_at != 0 && expires_at <= env.ledger().timestamp() {
            panic_with_error!(&env, Error::InvalidConfig);
        }
        // SECURITY_AUDIT H3: a compromised admin must not be able to
        // designate themselves (or the wallet itself) as the merchant
        // and drain. Reject those configurations at install time.
        if merchant == admin || merchant == env.current_contract_address() {
            panic_with_error!(&env, Error::InvalidConfig);
        }

        let policy = Policy {
            merchant: merchant.clone(),
            token,
            amount_per_charge,
            max_per_charge,
            interval_seconds,
            expires_at,
            last_charge_at: 0,
            revoked: false,
        };
        let key = DataKey::Policy(merchant.clone());
        env.storage().persistent().set(&key, &policy);
        env.storage().persistent().extend_ttl(&key, TTL_THRESHOLD_LEDGERS, TTL_TARGET_LEDGERS);
        env.events().publish(
            (Symbol::new(&env, "policy_installed"), merchant),
            (policy.amount_per_charge, policy.max_per_charge, policy.interval_seconds, policy.expires_at),
        );
    }

    /// User-controlled kill switch. After this call, all further merchant
    /// pulls fail authorization until `install_policy` is called again with
    /// a fresh passkey signature.
    pub fn revoke_policy(env: Env, merchant: Address) {
        // v0.1: gated by the same admin as install_policy. v0.2 migrates to
        // wallet's own __check_auth path.
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .unwrap_or_else(|| panic_with_error!(&env, Error::NotInitialized));
        admin.require_auth();

        let key = DataKey::Policy(merchant.clone());
        let mut policy: Policy = env.storage().persistent().get(&key)
            .unwrap_or_else(|| panic_with_error!(&env, Error::PolicyNotFound));
        policy.revoked = true;
        env.storage().persistent().set(&key, &policy);
        env.storage().persistent().extend_ttl(&key, TTL_THRESHOLD_LEDGERS, TTL_TARGET_LEDGERS);
        env.events().publish(
            (Symbol::new(&env, "policy_revoked"), merchant),
            (),
        );
    }

    /// Read-only accessor used by the frontend to render the four-guarantee
    /// panel. Returns the policy as stored or panics with `PolicyNotFound`.
    pub fn get_policy(env: Env, merchant: Address) -> Policy {
        let key = DataKey::Policy(merchant.clone());
        env.storage().persistent().get(&key)
            .unwrap_or_else(|| panic_with_error!(&env, Error::PolicyNotFound))
    }

    /// Install (or replace) a delegated agent spending session. Gated by the
    /// same admin as `install_policy` in v0.1.
    pub fn install_agent_session(
        env: Env,
        session_pubkey: BytesN<32>,
        token: Address,
        per_tx_cap: i128,
        window_seconds: u64,
        window_cap: i128,
        expires_at: u64,
        allow_recipients: Vec<Address>,
        ssl_hash: BytesN<32>,
    ) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .unwrap_or_else(|| panic_with_error!(&env, Error::NotInitialized));
        admin.require_auth();

        // SECURITY_AUDIT (agent-session reinstall): reject installing over an
        // EXISTING session pubkey. Silently resetting cur_spent/prev_spent/
        // epoch_start (and un-revoking) would defeat the proved 2*window_cap
        // exposure bound, which assumes the accumulator starts at (0,0) and only
        // grows. A session pubkey is therefore single-use: a new delegation must
        // use a fresh pubkey. (To retire a key, revoke it; it stays retired.)
        if env
            .storage()
            .persistent()
            .has(&DataKey::AgentSession(session_pubkey.clone()))
        {
            panic_with_error!(&env, Error::SessionExists);
        }

        // Config validation. `window_cap >= per_tx_cap` keeps a single allowed
        // transfer consistent with the aggregate budget. The `window_seconds`
        // floor prevents a degenerate window that rolls every call — which
        // would silently disable the aggregate cap and collapse enforcement to
        // per-tx only. Blast radius is `window_cap` by design (user-chosen),
        // bounded further by `expires_at` and revocation.
        if per_tx_cap <= 0 || window_cap < per_tx_cap {
            panic_with_error!(&env, Error::InvalidConfig);
        }
        // SECURITY_AUDIT A2.3: bound window_cap to a small multiple of
        // per_tx_cap. Mirrors the policy path's N1 guard — without it a
        // compromised admin could install a window_cap orders of magnitude
        // larger than a single transfer, defeating the per-tx cap as a
        // meaningful limit on aggregate exfiltration before revocation.
        let max_window = per_tx_cap.saturating_mul(MAX_WINDOW_MULTIPLIER);
        if window_cap > max_window {
            panic_with_error!(&env, Error::InvalidConfig);
        }
        // SECURITY_AUDIT C3: absolute per-charge ceiling on the agent path. The
        // A2.3 guard above bounds window_cap RELATIVE to per_tx_cap; it does not
        // bound a single transfer absolutely. The immutable
        // `max_absolute_per_charge` caps `per_tx_cap` (the largest single
        // agent-initiated transfer) so a compromised admin cannot delegate a
        // single-transfer drain. window_cap is bounded transitively
        // (window_cap <= per_tx_cap * 100, with per_tx_cap <= the ceiling).
        let max_absolute: i128 = env
            .storage()
            .instance()
            .get(&DataKey::MaxAbsolutePerCharge)
            .unwrap_or_else(|| panic_with_error!(&env, Error::NotInitialized));
        if per_tx_cap > max_absolute {
            panic_with_error!(&env, Error::ExceedsAbsoluteCeiling);
        }
        if window_seconds < 60 {
            panic_with_error!(&env, Error::InvalidConfig);
        }
        let now = env.ledger().timestamp();
        if expires_at != 0 && expires_at <= now {
            panic_with_error!(&env, Error::InvalidConfig);
        }
        // SECURITY_AUDIT A2.1: an empty allowlist + a stolen hot session key
        // = drain to ANY address within budget. Require a non-empty allowlist
        // so the agent can only pay pre-approved counterparties. This is the
        // primary mitigation for the stolen-key threat model.
        if allow_recipients.is_empty() {
            panic_with_error!(&env, Error::EmptyAllowlist);
        }
        // SECURITY_AUDIT A2.2 (H3 analog): a compromised admin must not be able
        // to name itself or the wallet's own contract address as an allowed
        // recipient and drain the wallet to itself / in a self-loop.
        let self_addr = env.current_contract_address();
        for r in allow_recipients.iter() {
            if r == admin || r == self_addr {
                panic_with_error!(&env, Error::RecipientNotAllowed);
            }
        }
        let session = AgentSession {
            session_pubkey: session_pubkey.clone(),
            token,
            per_tx_cap,
            window_seconds,
            window_cap,
            epoch_start: now,
            cur_spent: 0,
            prev_spent: 0,
            expires_at,
            revoked: false,
            allow_recipients,
            ssl_hash: ssl_hash.clone(),
            // Pin the AXL-proved bound into the session, bound to ssl_hash. Read
            // back by the hot path; CI binds the constant to the certificate.
            window_cap_multiplier: PROVED_WINDOW_MULTIPLIER,
        };
        let key = DataKey::AgentSession(session_pubkey.clone());
        env.storage().persistent().set(&key, &session);
        env.storage()
            .persistent()
            .extend_ttl(&key, TTL_THRESHOLD_LEDGERS, TTL_TARGET_LEDGERS);
        // Emit ssl_hash in the install event so indexers / the drift detector
        // can bind a session to its governing spec without a contract read.
        env.events().publish(
            (Symbol::new(&env, "agent_session_installed"), session_pubkey),
            (per_tx_cap, window_seconds, window_cap, expires_at, ssl_hash),
        );
    }

    /// Read-only accessor for a delegated agent session.
    pub fn get_agent_session(env: Env, session_pubkey: BytesN<32>) -> AgentSession {
        let key = DataKey::AgentSession(session_pubkey);
        env.storage().persistent().get(&key)
            .unwrap_or_else(|| panic_with_error!(&env, Error::SessionNotFound))
    }

    /// User-controlled kill switch for a delegated agent session. After this
    /// call, all agent transfers under this key fail until the session is
    /// re-installed.
    pub fn revoke_agent_session(env: Env, session_pubkey: BytesN<32>) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .unwrap_or_else(|| panic_with_error!(&env, Error::NotInitialized));
        admin.require_auth();

        let key = DataKey::AgentSession(session_pubkey.clone());
        let mut s: AgentSession = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| panic_with_error!(&env, Error::SessionNotFound));
        s.revoked = true;
        env.storage().persistent().set(&key, &s);
        env.storage()
            .persistent()
            .extend_ttl(&key, TTL_THRESHOLD_LEDGERS, TTL_TARGET_LEDGERS);
        env.events()
            .publish((Symbol::new(&env, "agent_session_revoked"), session_pubkey), ());
    }

    /// Custom account interface (CAP-46-11). Called by the Soroban host on
    /// every auth attempt where this contract is the authorizing principal.
    ///
    /// Authorization rule (SECURITY_AUDIT A1 — dispatch on credential FIRST,
    /// exactly one authorization model per entry):
    /// - `WalletAuth::Agent`: authenticate the ed25519 session key, then
    ///   authorize EVERY context against the session's allowlist + windowed
    ///   budget. This path NEVER runs the pull-policy loop, so an agent
    ///   credential can never mutate policy `last_charge_at`.
    /// - `WalletAuth::Passkey`: first try the pull-policy path — if **every**
    ///   `auth_context` matches an active on-chain policy (a
    ///   `token.transfer(this_wallet, merchant, amount)` with a non-revoked,
    ///   non-expired policy, `amount <= max_per_charge`, interval elapsed),
    ///   authorize without consulting the signature, bumping `last_charge_at`
    ///   per matched policy. Otherwise verify the passkey secp256r1 signature
    ///   over `signature_payload` (panics on failure → host auth rejection).
    pub fn __check_auth(
        env: Env,
        signature_payload: soroban_sdk::crypto::Hash<32>,
        auth: WalletAuth,
        auth_contexts: Vec<Context>,
    ) -> Result<(), Error> {
        // SECURITY_AUDIT A1: dispatch on the credential type FIRST, then run
        // exactly ONE authorization model per entry. The previous structure
        // ran the pull-policy loop (which has the `last_charge_at` side effect)
        // on EVERY entry before dispatch, so an Agent credential could mutate
        // policy state as a side effect of authenticating. Now the Agent path
        // never touches `try_match_policy`, and only the Passkey path runs the
        // pull-policy loop (where its side effects are intended).
        //
        // Signature verification (secp256r1 / ed25519) panics on failure, which
        // the host turns into an auth rejection. These crypto paths are
        // exercised in the testnet e2e run, not unit tests — mirroring how the
        // v0.1 spike deferred secp256r1 to M4.
        match auth {
            // Delegated agent: authenticate the ed25519 session key over the
            // host payload, then authorize EVERY context against the session's
            // allowlist + windowed budget. A single non-authorizable context
            // rejects the whole entry (no partial authorization). NEVER calls
            // try_match_policy — an agent credential cannot mutate policy state.
            WalletAuth::Agent(a) => {
                let msg = Bytes::from_array(&env, &signature_payload.to_array());
                env.crypto().ed25519_verify(&a.session_pubkey, &msg, &a.signature);
                for ctx in auth_contexts.iter() {
                    let authorized = match ctx {
                        Context::Contract(cc) => {
                            try_authorize_agent_context(&env, &a.session_pubkey, &cc)?
                        }
                        Context::CreateContractHostFn(_)
                        | Context::CreateContractWithCtorHostFn(_) => {
                            return Err(Error::AuthContextUnsupported);
                        }
                    };
                    if !authorized {
                        return Err(Error::SignatureInvalid);
                    }
                }
                Ok(())
            }
            // Human passkey: first try the pull-policy path (a merchant pull
            // matching a pre-installed policy authorizes WITHOUT consuming the
            // signature, and the side effects on `last_charge_at` are intended
            // here). If the pull path does not authorize all contexts, fall
            // back to verifying the secp256r1 signature over the host payload —
            // which authorizes any context (e.g. the wallet's own
            // install/revoke via __check_auth in the v0.2 admin migration).
            WalletAuth::Passkey(wa) => {
                if pull_policy_authorizes(&env, &auth_contexts)? {
                    return Ok(());
                }
                let pubkey: BytesN<65> = env
                    .storage()
                    .instance()
                    .get(&DataKey::PasskeyPubkey)
                    .ok_or(Error::NotInitialized)?;
                verify_webauthn(&env, &pubkey, &signature_payload, &wa)?;
                Ok(())
            }
        }
    }
}

/// Verify a REAL WebAuthn assertion against the wallet's stored secp256r1
/// passkey, bound to THIS transaction's host payload.
///
/// 1. **Challenge binding (replay defense):** base64url-no-pad of the Soroban
///    `signature_payload` MUST appear verbatim in `client_data_json` — the
///    authenticator put it there as the WebAuthn challenge, so an assertion
///    captured for one tx cannot authorize another.
/// 2. **Signature:** the authenticator signed
///    `SHA256(authenticator_data || SHA256(client_data_json))`. We rebuild that
///    digest and run native secp256r1 verification (panics → host auth reject).
pub(crate) fn verify_webauthn(
    env: &Env,
    pubkey: &BytesN<65>,
    payload: &soroban_sdk::crypto::Hash<32>,
    wa: &WebAuthnAuth,
) -> Result<(), Error> {
    let expected = base64url_nopad(env, &payload.to_array());
    if !bytes_contains(&wa.client_data_json, &expected) {
        return Err(Error::SignatureInvalid);
    }
    let client_hash = env.crypto().sha256(&wa.client_data_json);
    let mut signed = wa.authenticator_data.clone();
    signed.append(&Bytes::from_array(env, &client_hash.to_array()));
    let digest = env.crypto().sha256(&signed);
    env.crypto().secp256r1_verify(pubkey, &digest, &wa.signature);
    Ok(())
}

/// base64url (RFC 4648 §5), no padding — the encoding WebAuthn uses for the
/// challenge field of `client_data_json`. Encodes the 32-byte host payload.
pub(crate) fn base64url_nopad(env: &Env, input: &[u8; 32]) -> Bytes {
    const A: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut out = Bytes::new(env);
    let mut i = 0usize;
    while i + 3 <= input.len() {
        let n = ((input[i] as u32) << 16) | ((input[i + 1] as u32) << 8) | (input[i + 2] as u32);
        out.push_back(A[((n >> 18) & 63) as usize]);
        out.push_back(A[((n >> 12) & 63) as usize]);
        out.push_back(A[((n >> 6) & 63) as usize]);
        out.push_back(A[(n & 63) as usize]);
        i += 3;
    }
    // 32 mod 3 == 2 → two trailing bytes → three base64 chars, no '=' padding.
    let rem = input.len() - i;
    if rem == 2 {
        let n = ((input[i] as u32) << 16) | ((input[i + 1] as u32) << 8);
        out.push_back(A[((n >> 18) & 63) as usize]);
        out.push_back(A[((n >> 12) & 63) as usize]);
        out.push_back(A[((n >> 6) & 63) as usize]);
    } else if rem == 1 {
        let n = (input[i] as u32) << 16;
        out.push_back(A[((n >> 18) & 63) as usize]);
        out.push_back(A[((n >> 12) & 63) as usize]);
    }
    out
}

/// Naive substring search over `Bytes` (no allocator-friendly std available).
fn bytes_contains(hay: &Bytes, needle: &Bytes) -> bool {
    let hlen = hay.len();
    let nlen = needle.len();
    if nlen == 0 || nlen > hlen {
        return false;
    }
    let mut start = 0u32;
    while start + nlen <= hlen {
        let mut j = 0u32;
        let mut matched = true;
        while j < nlen {
            if hay.get(start + j) != needle.get(j) {
                matched = false;
                break;
            }
            j += 1;
        }
        if matched {
            return true;
        }
        start += 1;
    }
    false
}

/// SECURITY_AUDIT A1: extracted pull-policy "do all contexts match an active
/// policy" loop. Returns `Ok(true)` iff there is at least one context and
/// EVERY context matches an active policy (each match bumps `last_charge_at`
/// as a side effect via `try_match_policy`). Returns `Ok(false)` if some
/// context does not match a policy (caller falls back to signature
/// verification). Returns `Err` if a policy exists but a context violates it
/// — the host turns this into an auth rejection.
///
/// NOTE on side effects: like the original inline loop, a partial run can bump
/// `last_charge_at` on policies matched before a later context returns
/// `Ok(false)`. This preserves the pre-refactor semantics exactly; it is only
/// ever reached on the Passkey path now (A1), never the Agent path.
fn pull_policy_authorizes(env: &Env, auth_contexts: &Vec<Context>) -> Result<bool, Error> {
    let mut all_matched = !auth_contexts.is_empty();
    for ctx in auth_contexts.iter() {
        let matched = match ctx {
            Context::Contract(cc) => try_match_policy(env, &cc)?,
            Context::CreateContractHostFn(_) | Context::CreateContractWithCtorHostFn(_) => {
                return Err(Error::AuthContextUnsupported);
            }
        };
        if !matched {
            all_matched = false;
        }
    }
    Ok(all_matched)
}

/// Try to satisfy a single auth context via an active on-chain policy.
/// Returns `Ok(true)` if the context is a token.transfer matching a valid
/// policy (and bumps `last_charge_at`). Returns `Ok(false)` if the context
/// is not a transfer or no policy exists for the recipient. Returns `Err`
/// when a policy exists but the context violates its constraints — the
/// host turns this into an auth rejection.
fn try_match_policy(env: &Env, cc: &ContractContext) -> Result<bool, Error> {
    let transfer_sym = Symbol::new(env, "transfer");
    if cc.fn_name != transfer_sym {
        return Ok(false);
    }
    if cc.args.len() != 3 {
        return Ok(false);
    }

    // SEP-41 `transfer(from: Address, to: Address, amount: i128)`.
    // SECURITY_AUDIT N2 cleanup · use `if let Some` rather than `.unwrap()`.
    // The `args.len() != 3` guard above made unwrap safe, but the explicit
    // pattern is auditor-friendly and matches the "no panic in __check_auth"
    // invariant.
    let to_val: Val = match cc.args.get(1) {
        Some(v) => v,
        None => return Ok(false),
    };
    let amount_val: Val = match cc.args.get(2) {
        Some(v) => v,
        None => return Ok(false),
    };
    let to = match Address::try_from_val(env, &to_val) {
        Ok(a) => a,
        Err(_) => return Ok(false),
    };
    let amount = match i128::try_from_val(env, &amount_val) {
        Ok(a) => a,
        Err(_) => return Ok(false),
    };

    let key = DataKey::Policy(to.clone());
    let mut policy: Policy = match env.storage().persistent().get(&key) {
        Some(p) => p,
        None => return Ok(false),
    };
    if cc.contract != policy.token {
        return Ok(false);
    }
    if policy.revoked {
        return Err(Error::PolicyRevoked);
    }
    let now = env.ledger().timestamp();
    if policy.expires_at != 0 && now >= policy.expires_at {
        return Err(Error::PolicyExpired);
    }
    if amount > policy.max_per_charge {
        return Err(Error::AmountExceedsCap);
    }
    if policy.last_charge_at != 0
        && now < policy.last_charge_at.saturating_add(policy.interval_seconds)
    {
        return Err(Error::PeriodNotElapsed);
    }

    policy.last_charge_at = now;
    env.storage().persistent().set(&key, &policy);
    env.storage()
        .persistent()
        .extend_ttl(&key, TTL_THRESHOLD_LEDGERS, TTL_TARGET_LEDGERS);
    Ok(true)
}

/// SECURITY_AUDIT A5: the single budget chokepoint. Authorizes a single
/// agent-initiated transfer to `to` for `amount` against a delegated session,
/// enforcing allowlist + per-tx cap + sliding-window aggregate cap + revoke +
/// expiry TOGETHER. Because the allowlist is checked HERE (not only in the
/// context wrapper), this function cannot authorize a non-allowlisted recipient
/// even when called directly. Reads the session exactly once.
///
/// Tri-state like `try_match_policy`: `Ok(true)` authorizes (and charges the
/// windowed budget), `Ok(false)` means no session for this key / wrong token
/// (caller falls through), `Err` means a session exists but the transfer
/// violates it (host turns into an auth rejection).
fn try_authorize_agent_transfer(
    env: &Env,
    session_pubkey: &BytesN<32>,
    token: &Address,
    to: &Address,
    amount: i128,
) -> Result<bool, Error> {
    let key = DataKey::AgentSession(session_pubkey.clone());
    let mut s: AgentSession = match env.storage().persistent().get(&key) {
        Some(s) => s,
        None => return Ok(false),
    };
    // Wrong asset for this session — fall through (a different session or the
    // pull-policy path may still authorize).
    if &s.token != token {
        return Ok(false);
    }
    // A5: allowlist enforced at the chokepoint, before any budget mutation.
    if !recipient_allowed(&s, to) {
        return Err(Error::RecipientNotAllowed);
    }
    if s.revoked {
        return Err(Error::SessionRevoked);
    }
    let now = env.ledger().timestamp();
    if s.expires_at != 0 && now >= s.expires_at {
        return Err(Error::SessionExpired);
    }
    if amount <= 0 {
        return Err(Error::InvalidConfig);
    }
    if amount > s.per_tx_cap {
        return Err(Error::AmountExceedsCap);
    }

    // SECURITY_AUDIT A3: O(1) sliding-window counter. The previous fixed-window
    // reset allowed a 2x burst: spend window_cap just before a boundary, then
    // another window_cap just after (because the counter reset to 0). Here we
    // keep cur_spent (current epoch) and prev_spent (previous epoch), roll
    // epochs lazily, and estimate the rolling spend as a time-weighted sum:
    //   estimate = prev_spent * (1 - elapsed_fraction) + cur_spent
    // where elapsed_fraction = (now - epoch_start) / window_seconds in [0,1).
    // Just after a boundary, elapsed_fraction ≈ 0 so prev_spent is counted at
    // (almost) full weight — the burst is shaped. The previous epoch's weight
    // decays linearly to 0 across the new epoch. NOTE: this weighted estimate
    // does NOT bound real-time-window spend to window_cap — a delayed straddle
    // can place up to ~2× window_cap into one real W-length interval. The hard
    // un-weighted ceiling below (N-A3) is what makes the worst case provably
    // <= 2 * window_cap.
    let w = s.window_seconds; // >= 60 by install-time validation
    let elapsed = now.saturating_sub(s.epoch_start);
    if elapsed >= w {
        // Rolled into a new epoch. If the gap is within one window of the old
        // epoch boundary (adjacent epoch), carry cur_spent into prev_spent so
        // it decays across the new epoch; otherwise (>= 2 windows elapsed) the
        // previous activity is fully decayed and dropped.
        if elapsed < w.saturating_mul(2) {
            s.prev_spent = s.cur_spent;
        } else {
            s.prev_spent = 0;
        }
        s.cur_spent = 0;
        s.epoch_start = now;
    }

    // Recompute elapsed against the (possibly rolled) epoch_start. Integer
    // weighted estimate: prev_spent * (W - elapsed_in_epoch) / W + cur_spent.
    // All values are non-negative; use i128/u128 with saturating/checked math
    // to avoid overflow. elapsed_in_epoch is in [0, W).
    let elapsed_in_epoch = now.saturating_sub(s.epoch_start); // < w here
    let remaining = w.saturating_sub(elapsed_in_epoch); // in (0, w]
    // weighted_prev = prev_spent * remaining / w  (floor). prev_spent and
    // remaining are bounded (prev_spent <= window_cap <= per_tx*100), but use
    // u128 intermediate to be safe against i128 overflow on the product.
    let weighted_prev: i128 = if w == 0 {
        0
    } else {
        let prod = (s.prev_spent.max(0) as u128)
            .saturating_mul(remaining as u128);
        (prod / (w as u128)) as i128
    };
    let estimate = weighted_prev
        .checked_add(s.cur_spent)
        .ok_or(Error::WindowCapExceeded)?;
    let projected = estimate
        .checked_add(amount)
        .ok_or(Error::WindowCapExceeded)?;
    if projected > s.window_cap {
        return Err(Error::WindowCapExceeded);
    }

    // SECURITY_AUDIT N-A3: hard un-weighted ceiling. The weighted estimate
    // above shapes throughput but counts `cur_spent` at full weight regardless
    // of when in the epoch it was spent, so a "delayed straddle" (spend late in
    // one epoch, roll, spend early in the next) can place spend that exceeds
    // `window_cap` inside a single real W-length interval. That interval
    // overlaps at most two adjacent epochs, whose combined UN-weighted spend is
    // `prev_spent + cur_spent`. Bounding that sum + this charge to
    // `window_cap_multiplier * window_cap` makes the worst-case real-time-window
    // spend provably `<= window_cap_multiplier * window_cap`. The multiplier is
    // read from the SESSION (pinned at install to the AXL-proved
    // `PROVED_WINDOW_MULTIPLIER` and bound to `ssl_hash`), NOT a source literal,
    // so the enforced bound is on-chain state an auditor re-checks against the
    // certificate. Saturating/checked i128, fail-closed; redundant with the
    // weighted check for in-invariant states and load-bearing as a
    // defense-in-depth guard. A corrupt/zero multiplier yields a 0 ceiling that
    // rejects all positive charges (fail-closed), and the install path + the
    // `MAX_CAP_MULTIPLIER` compile guard keep the stored value in `[1, 10]`.
    let unweighted = s
        .prev_spent
        .saturating_add(s.cur_spent)
        .saturating_add(amount);
    let hard_ceiling = s
        .window_cap
        .saturating_mul(s.window_cap_multiplier as i128);
    if unweighted > hard_ceiling {
        return Err(Error::WindowCapExceeded);
    }

    s.cur_spent = s
        .cur_spent
        .checked_add(amount)
        .ok_or(Error::WindowCapExceeded)?;
    env.storage().persistent().set(&key, &s);
    env.storage()
        .persistent()
        .extend_ttl(&key, TTL_THRESHOLD_LEDGERS, TTL_TARGET_LEDGERS);
    Ok(true)
}

/// Whether `to` is an allowed recipient under this session. A non-empty
/// allowlist (enforced at install time by A2) restricts transfers to exactly
/// its members. An empty allowlist returns `true` (open) — but A2 prevents an
/// empty allowlist from ever being installed, so in practice this is always a
/// membership check. The open-case branch is retained for defense in depth and
/// direct unit testing of the predicate.
fn recipient_allowed(session: &AgentSession, to: &Address) -> bool {
    if session.allow_recipients.is_empty() {
        return true;
    }
    session.allow_recipients.iter().any(|a| &a == to)
}

/// Authorize a single auth context against a delegated agent session. Parses a
/// `token.transfer(wallet, to, amount)` context and defers ALL enforcement
/// (allowlist + cap + window + revoke + expiry) to the single chokepoint
/// `try_authorize_agent_transfer`. Tri-state like `try_match_policy`.
///
/// SECURITY_AUDIT A5: this wrapper no longer reads the session or checks the
/// allowlist itself — it only parses the context and the token from it, then
/// hands off to the chokepoint (one storage read). This removes the previous
/// double storage read and ensures the allowlist is enforced at the budget
/// chokepoint rather than only in this wrapper.
fn try_authorize_agent_context(
    env: &Env,
    session_pubkey: &BytesN<32>,
    cc: &ContractContext,
) -> Result<bool, Error> {
    let transfer_sym = Symbol::new(env, "transfer");
    if cc.fn_name != transfer_sym {
        return Ok(false);
    }
    if cc.args.len() != 3 {
        return Ok(false);
    }
    let to_val: Val = match cc.args.get(1) {
        Some(v) => v,
        None => return Ok(false),
    };
    let amount_val: Val = match cc.args.get(2) {
        Some(v) => v,
        None => return Ok(false),
    };
    let to = match Address::try_from_val(env, &to_val) {
        Ok(a) => a,
        Err(_) => return Ok(false),
    };
    let amount = match i128::try_from_val(env, &amount_val) {
        Ok(a) => a,
        Err(_) => return Ok(false),
    };

    // The token the transfer is on (cc.contract) is the asset; the chokepoint
    // re-checks it against the session's token and falls through on mismatch.
    try_authorize_agent_transfer(env, session_pubkey, &cc.contract, &to, amount)
}

#[cfg(test)]
mod test;
