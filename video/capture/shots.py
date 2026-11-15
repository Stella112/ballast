"""Capture real screens for the demo video (1920x1080, dark).
- Explorer transaction pages (public Mezo testnet explorer).
- Live app pages. For wallet-gated pages a READ-ONLY stand-in wallet is injected that only reports the demo
  owner's public address and forwards read calls to the Mezo RPC; it cannot sign anything. Everything shown is
  live on-chain state of the demo account.
Usage: python capture/shots.py [name ...]   (run from video/)"""
import json, sys, time
from playwright.sync_api import sync_playwright

SITE = "https://ballast-tawny.vercel.app"
EXP = "https://explorer.test.mezo.org/tx/"
OWNER = "0x4ff0D7c712B109dE476f21Ed443Ef0928d52a5fA"
RPC = "https://rpc.test.mezo.org"

TX = {
    "tx-pay": "0xbec250c4a877f3b637b8935e1713115d8d5989626614c9e97f3cdf12938bbd5e",
    "tx-keeper": "0x93bbadeb9ad67c95f32ca5507ee6b7d9b28cec00d4c327dd857868aaf4b1a9cd",
    "tx-cap": "0xb52b86935a203d3fe55ed858d69bbefedb655703b43a1539e2108789dac098a0",
    "tx-escrow-list": "0x2d8e01521db67bb4542be4383d3f1a053f219c17a890c19f99995ccd630f857a",
    "tx-escrow-release": "0x43626e6369e6e8304ee33348492fe1b0c45f08333d404e8937a36bd5c208b8d9",
    "tx-hedge-open": "0x09d17ce366ce7ef78439386f04b6238476f19d99a51a4a74651cf3c66c3cc447",
    "tx-hedge-close": "0xd6a52ed49876862609d15578cf56b51b5372a38a2f45065aa8337675363ded54",
    "tx-base-settle": "0x666b7277e706eef1044e650b138a68247d50e003bfb112758990578180b45c75",
    "tx-open-loan": "0x1c12b684ebebac2154275e09462345386ee597cce37f7c4ad13b58fb62dee76e",
}
APP = {"app-account": "/app", "app-radar": "/app/radar", "app-hedge": "/app/hedge", "app-payback": "/app/payback"}
PUBLIC = {"app-paylink": "/pay/a/1", "app-home": "/", "app-demo": "/demo"}
READY = {"app-paylink": "Split by the owner", "app-account": "BTC collateral", "app-radar": "MUSD ahead of you",
         "app-hedge": "Hedge reserve (in account)", "app-payback": "Current on-chain policy"}

WALLET = """
window.ethereum = {
  isMetaMask: true,
  request: async ({ method, params }) => {
    if (method === 'eth_requestAccounts' || method === 'eth_accounts') return ['%s'];
    if (method === 'eth_chainId') return '0x7b7b';
    if (method === 'net_version') return '31611';
    if (method === 'wallet_switchEthereumChain' || method === 'wallet_addEthereumChain') return null;
    if (method.startsWith('eth_send') || method.startsWith('eth_sign') || method.startsWith('personal_')) throw new Error('read-only capture wallet');
    const r = await fetch('%s', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
    const j = await r.json(); if (j.error) throw j.error; return j.result;
  },
  on() {}, removeListener() {},
};
""" % (OWNER, RPC)


def shot(page, name):
    page.screenshot(path=f"public/shots/{name}.png")
    print("ok", name, flush=True)


def main():
    want = set(sys.argv[1:])
    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(viewport={"width": 1280, "height": 720}, color_scheme="dark", device_scale_factor=1.5)
        page = ctx.new_page()
        for name, h in TX.items():
            if want and name not in want: continue
            try:
                page.goto(EXP + h, wait_until="domcontentloaded", timeout=120000)
                # wait until the transaction details are really rendered (hash prefix + a status row)
                page.wait_for_function("(h) => { const t = document.body.innerText; return t.includes('Transaction hash') && t.toLowerCase().includes(h.slice(0, 10).toLowerCase()) && /Success|Failed|Pending/.test(t); }", arg=h, timeout=150000)
                page.wait_for_timeout(3500)
                shot(page, name)
            except Exception as e:
                print("FAIL", name, str(e)[:120], flush=True)
        for name, path in PUBLIC.items():
            if want and name not in want: continue
            try:
                page.goto(SITE + path, wait_until="domcontentloaded", timeout=120000)
                if name in READY:
                    page.wait_for_function("(t) => document.body.innerText.toLowerCase().includes(t.toLowerCase())", arg=READY[name], timeout=150000)
                page.wait_for_timeout(3000)
                shot(page, name)
            except Exception as e:
                print("FAIL", name, str(e)[:120], flush=True)
        ctx2 = b.new_context(viewport={"width": 1280, "height": 720}, color_scheme="dark", device_scale_factor=1.5)
        ctx2.add_init_script(WALLET)
        page = ctx2.new_page()
        for name, path in APP.items():
            if want and name not in want: continue
            try:
                page.goto(SITE + path, wait_until="domcontentloaded", timeout=90000)
                page.wait_for_timeout(3000)
                btn = page.get_by_role("button", name="Connect wallet")
                if btn.count() > 0:
                    btn.first.click()
                page.wait_for_function("(t) => document.body.innerText.toLowerCase().includes(t.toLowerCase())", arg=READY[name], timeout=180000)
                page.wait_for_timeout(4000)
                shot(page, name)
                if name in ("app-radar", "app-hedge", "app-account"):
                    page.mouse.wheel(0, 560)
                    page.wait_for_timeout(1500)
                    shot(page, name + "-2")
            except Exception as e:
                print("FAIL", name, str(e)[:120], flush=True)
        b.close()


main()
