import type { OrderStatus } from "./schemas/order.ts";

export type Network = "testnet" | "mainnet";

export interface Merchant {
  id: string;
  display_name: string;
  email: string;
  stellar_address: string | null;
  network: Network;
  api_key_prefix: string;
  webhook_url: string | null;
  platform_fee_bp: number;
  active: boolean;
  created_at: string;
}

export interface Order {
  id: string;
  merchant_id: string;
  external_ref: string | null;
  brl_amount: string;
  usdc_amount: string;
  rate_brl_usdc: string;
  memo: string;
  status: OrderStatus;
  tx_hash: string | null;
  created_at: string;
  expires_at: string;
  paid_at: string | null;
}
