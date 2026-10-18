import { StellarWalletsKit, Networks } from "@creit.tech/stellar-wallets-kit";
import { FREIGHTER_ID, FreighterModule } from "@creit.tech/stellar-wallets-kit/modules/freighter";
import { LobstrModule } from "@creit.tech/stellar-wallets-kit/modules/lobstr";
import { xBullModule } from "@creit.tech/stellar-wallets-kit/modules/xbull";
import { AlbedoModule } from "@creit.tech/stellar-wallets-kit/modules/albedo";
import { HanaModule } from "@creit.tech/stellar-wallets-kit/modules/hana";

const network = (import.meta.env.VITE_STELLAR_NETWORK ?? "TESTNET").toUpperCase();
export const NETWORK = network === "PUBLIC" ? Networks.PUBLIC : Networks.TESTNET;

StellarWalletsKit.init({
  network: NETWORK,
  selectedWalletId: FREIGHTER_ID,
  modules: [
    new FreighterModule(),
    new LobstrModule(),
    new xBullModule(),
    new AlbedoModule(),
    new HanaModule(),
  ],
});

export async function connectWallet(): Promise<string> {
  const { address } = await StellarWalletsKit.authModal();
  return address;
}

export async function signTx(xdr: string): Promise<string> {
  const { signedTxXdr } = await StellarWalletsKit.signTransaction(xdr, {
    networkPassphrase: NETWORK,
  });
  return signedTxXdr;
}
