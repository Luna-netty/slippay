export const NETWORK = {
  testnet: {
    horizon: "https://horizon-testnet.stellar.org",
    passphrase: "Test SDF Network ; September 2015",
    // Circle USDC issuer on Stellar testnet — verified 2026-05-07
    // https://developers.circle.com/stablecoins/stellar
    usdc_issuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
    // PayPal PYUSD on Stellar testnet — VERIFY BEFORE USE.
    // Set via env override (PYUSD_ISSUER_TESTNET) until SDF/PayPal publish a stable testnet pubkey.
    pyusd_issuer: null as string | null,
  },
  mainnet: {
    horizon: "https://horizon.stellar.org",
    passphrase: "Public Global Stellar Network ; September 2015",
    // Circle USDC issuer on Stellar mainnet — verified 2026-05-07
    // https://developers.circle.com/stablecoins/stellar
    usdc_issuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
    // PayPal PYUSD on Stellar mainnet — VERIFY ON CHAIN BEFORE PRODUCTION.
    // Live since 2025 per https://stellar.org/press/paypal-pyusd
    // Set via env override (PYUSD_ISSUER_MAINNET) until issuer pubkey is verified
    // against stellar.expert and PayPal/SDF documentation.
    pyusd_issuer: null as string | null,
  },
} as const;

export const ASSET_CODES = {
  USDC: "USDC",
  PYUSD: "PYUSD",
} as const;
export type AssetCode = keyof typeof ASSET_CODES;
// Back-compat: keep USDC_ASSET_CODE export until callers migrate.
export const USDC_ASSET_CODE = ASSET_CODES.USDC;
export const STELLAR_ADDRESS_LENGTH = 56;
export const MEMO_HASH_HEX_LENGTH = 64; // 32 bytes
export const DEFAULT_PLATFORM_FEE_BP = 297; // 2.97%
export const ORDER_DEFAULT_EXPIRY_MINUTES = 30;
export const API_KEY_PREFIX = "sk_live_";
export const API_KEY_BYTES = 32;
