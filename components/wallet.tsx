"use client";
import { useAccount, useBalance, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { mezoTestnet } from "@/lib/config";
import { Button, Notice, fmt, short } from "./ui";

export function ConnectButton() {
  const { address, isConnected, chainId } = useAccount();
  const { connect, connectors, isPending, error } = useConnect();
  const { disconnect } = useDisconnect();
  const wrong = isConnected && chainId !== mezoTestnet.id;
  const { switchChain, isPending: switching } = useSwitchChain();

  if (!isConnected) {
    const c = connectors[0];
    return (
      <div className="flex flex-col items-end gap-1">
        <Button onClick={() => c && connect({ connector: c, chainId: mezoTestnet.id })} disabled={!c || isPending}>
          {isPending ? "Connecting…" : "Connect wallet"}
        </Button>
        {error && <span className="max-w-60 text-right text-xs text-bad">{error.message.split("\n")[0]}</span>}
      </div>
    );
  }
  if (wrong) {
    return (
      <Button variant="danger" onClick={() => switchChain({ chainId: mezoTestnet.id })} disabled={switching}>
        {switching ? "Switching…" : "Wrong network — switch to Mezo Testnet"}
      </Button>
    );
  }
  return (
    <button onClick={() => disconnect()} title="Disconnect" className="rounded-lg border border-border px-3 py-2 font-mono text-sm hover:bg-surface-2">
      {short(address)}
    </button>
  );
}

/** Blocks children unless connected to Mezo testnet; shows gas warning. */
export function RequireMezo({ children, purpose = "use Ballast" }: { children: React.ReactNode; purpose?: string }) {
  const { address, isConnected, chainId } = useAccount();
  const { data: bal } = useBalance({ address, chainId: mezoTestnet.id, query: { enabled: !!address } });
  if (!isConnected) return <Notice tone="neutral" title="Connect a wallet">Connect a wallet on Mezo Testnet (chain 31611) to {purpose}.</Notice>;
  if (chainId !== mezoTestnet.id) return <Notice tone="bad" title="Wrong network">Your wallet is on chain {chainId}. Switch to Mezo Testnet (31611) using the button in the header.</Notice>;
  return (
    <>
      {bal && bal.value === 0n && (
        <div className="mb-4"><Notice tone="warn" title="No testnet BTC for gas">This wallet has 0 BTC on Mezo Testnet. Get some from <a className="underline" href="https://faucet.test.mezo.org/" target="_blank" rel="noreferrer">faucet.test.mezo.org</a>.</Notice></div>
      )}
      {bal && bal.value > 0n && bal.value < 10n ** 12n && <div className="mb-4"><Notice tone="warn">Low BTC gas balance: {fmt(bal.value, 18, 8)} BTC.</Notice></div>}
      {children}
    </>
  );
}
