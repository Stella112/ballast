// `injected` from the wagmi root avoids bundling every optional connector SDK (wagmi/connectors).
import { createConfig, http, injected } from "wagmi";
import { baseSepoliaChain, cfg, mezoTestnet, RPC_URL } from "./config";

export const wagmiConfig = createConfig({
  chains: [mezoTestnet, baseSepoliaChain],
  connectors: [injected()],
  transports: { [mezoTestnet.id]: http(RPC_URL, { batch: true }), [baseSepoliaChain.id]: http(cfg.baseSepolia.rpcUrl) },
  ssr: true,
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
