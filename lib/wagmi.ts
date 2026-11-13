// `injected` from the wagmi root avoids bundling every optional connector SDK (wagmi/connectors).
import { createConfig, http, injected } from "wagmi";
import { mezoTestnet, RPC_URL } from "./config";

export const wagmiConfig = createConfig({
  chains: [mezoTestnet],
  connectors: [injected()],
  transports: { [mezoTestnet.id]: http(RPC_URL, { batch: true }) },
  ssr: true,
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
