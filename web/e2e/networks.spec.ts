import { test, expect, type Page } from "@playwright/test";
import { encodeAbiParameters } from "viem";

const owner = "0x1111111111111111111111111111111111111111";
const account = "0x3333333333333333333333333333333333333333";
const networks = [
  { id: 11155111, name: "Ethereum Sepolia", balance: "1.000000", explorer: "https://sepolia.etherscan.io" },
  { id: 84532, name: "Base Sepolia", balance: "2.000000", explorer: "https://sepolia.basescan.org" },
  { id: 421614, name: "Arbitrum Sepolia", balance: "3.000000", explorer: "https://sepolia.arbiscan.io" },
  { id: 1, name: "Ethereum", balance: "4.000000", explorer: "https://etherscan.io" },
  { id: 8453, name: "Base", balance: "5.000000", explorer: "https://basescan.org" },
  { id: 42161, name: "Arbitrum One", balance: "6.000000", explorer: "https://arbiscan.io" },
];

type TestProvider = {
  setAccount(address: string): void;
  beginTransaction(id: number): () => void;
  request(args: { method: string; params?: unknown[]; transaction?: unknown }): Promise<unknown>;
};
declare global { interface Window { testWallet: TestProvider; releaseTestTransaction: () => void } }

async function prepare(page: Page) {
  let selected = networks[0];
  let failBalances = false;
  let holdBalance = false;
  let releaseBalance: (() => void) | undefined;
  await page.addInitScript(() => {
    window.addEventListener("eip6963:announceProvider", event => {
      const { info, provider } = (event as CustomEvent).detail;
      if (info.rdns === "xyz.openfort.opensigner") window.testWallet = provider;
    });
  });
  await page.route("**/api/auth/get-session**", route => route.fulfill({ json: null }));
  await page.route(url => url.protocol === "https:", async route => {
    const request = route.request();
    if (request.method() !== "POST") return route.continue();
    const body = request.postDataJSON();
    let result;
    switch (body.method) {
      case "eth_chainId": result = `0x${selected.id.toString(16)}`; break;
      case "eth_getCode": result = [owner, account].includes(body.params[0].toLowerCase()) ? "0x" : "0x1234"; break;
      case "eth_call": result = body.params[0].data === "0x9cfd7cff"
        ? encodeAbiParameters([{ type: "string" }], ["biconomy.nexus.1.3.3"])
        : encodeAbiParameters([{ type: "address" }], [account]); break;
      case "eth_getBalance": {
        if (failBalances) return route.fulfill({ json: { jsonrpc: "2.0", id: body.id, error: { code: -32000, message: "Balance unavailable" } } });
        result = `0x${(BigInt(selected.balance.split(".")[0]) * 10n ** 18n).toString(16)}`;
        if (holdBalance) {
          holdBalance = false;
          await new Promise<void>(resolve => { releaseBalance = resolve; });
        }
        break;
      }
      default: throw new Error(`Unexpected RPC in browser test: ${body.method}`);
    }
    await route.fulfill({ json: { jsonrpc: "2.0", id: body.id, result } });
  });
  await page.goto("/");
  await expect(page.getByText("Continue with Google", { exact: true })).toBeAttached();
  await page.waitForFunction(() => !!window.testWallet);
  return {
    holdNextBalance() { holdBalance = true; },
    hasHeldBalance() { return !!releaseBalance; },
    releaseBalance() { releaseBalance?.(); },
    failBalances() { failBalances = true; },
    async select(network: typeof networks[number]) {
      selected = network;
      await page.getByRole("combobox", { name: "Network", exact: true }).selectOption(String(network.id));
      await expect(page.getByRole("heading", { name: `${network.name} dApp`, exact: true })).toBeVisible();
    },
    async connect() {
      await page.evaluate(address => window.testWallet.setAccount(address), owner);
      await expect(page.getByText(selected.balance, { exact: true })).toBeVisible();
    },
  };
}

test("switches balances, account setup and receive links across all networks; persists selection", async ({ page }) => {
  const app = await prepare(page);
  await app.connect();
  for (const network of networks) {
    await app.select(network);
    await expect(page.getByText(network.balance, { exact: true })).toBeVisible();
    await page.getByRole("button", { name: /^receive$/i }).click();
    await expect(page.getByRole("link", { name: /scan ↗/ })).toHaveAttribute("href", `${network.explorer}/address/${account}`);
    await expect(page.getByText(`Your Nexus Account address on ${network.name}`, { exact: true })).toBeVisible();
    expect(await page.getByRole("link", { name: "Get test ETH ↗" }).count()).toBe(network.id > 100000 || network.id === 84532 ? 1 : 0);
  }
  await page.reload();
  await expect(page.getByRole("combobox", { name: "Network", exact: true })).toHaveValue("42161");
  await expect(page.getByRole("heading", { name: "Arbitrum One dApp", exact: true })).toBeVisible();
});

test("mobile approvals show the selected mainnet, lock switching and leave the wallet sheet closed", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const app = await prepare(page);
  await app.select(networks[4]);
  await app.connect();
  await page.evaluate(({ owner, account }) => {
    window.releaseTestTransaction = window.testWallet.beginTransaction(8453);
    void window.testWallet.request({ method: "personal_sign", params: [`0x${"ab".repeat(32)}`, owner],
      transaction: { from: account, to: owner, valueWei: "1000000000000000", chainId: 8453 },
    }).catch(() => {});
  }, { owner, account });
  await expect(page.getByText("Authorize Transaction", { exact: true })).toBeVisible();
  await expect(page.locator("dd").filter({ hasText: "Base · Mainnet · real ETH" })).toBeVisible();
  await expect(page.getByText("0.001 ETH", { exact: true })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Network", exact: true })).toBeDisabled();
  await expect(page.locator("aside")).toBeHidden();
  await page.getByRole("button", { name: "Reject", exact: true }).click();
  await expect(page.getByText("Authorize Transaction", { exact: true })).toBeHidden();
  await expect(page.getByRole("combobox", { name: "Network", exact: true })).toBeDisabled();
  await page.evaluate(() => window.releaseTestTransaction());
  await expect(page.getByRole("combobox", { name: "Network", exact: true })).toBeEnabled();
  await expect(page.locator("aside")).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("mobile-network.png") });
  await page.getByRole("button", { name: "Wallet", exact: true }).click();
  await expect(page.locator("aside")).toBeVisible();
});


test("ignores a late balance from the previous chain and reports RPC failures", async ({ page }) => {
  const app = await prepare(page);
  app.holdNextBalance();
  await page.evaluate(address => window.testWallet.setAccount(address), owner);
  await expect.poll(() => app.hasHeldBalance()).toBe(true);
  await app.select(networks[1]);
  await expect(page.getByText("2.000000", { exact: true })).toBeVisible();
  app.releaseBalance();
  await expect(page.getByText("1.000000", { exact: true })).toHaveCount(0);
  app.failBalances();
  await app.select(networks[3]);
  await expect(page.getByText("Balance unavailable. Try refreshing.", { exact: true })).toBeVisible();
  await expect(page.getByText("0.000000", { exact: true })).toHaveCount(0);
});

test("keeps the selected external wallet when switching networks", async ({ page }) => {
  const app = await prepare(page);
  await page.evaluate(() => {
    let chainId = "0xaa36a7";
    const provider = {
      async request({ method, params }: { method: string; params?: { chainId: string }[] }) {
        if (method === "eth_chainId") return chainId;
        if (method === "wallet_switchEthereumChain") { chainId = params![0].chainId; return null; }
        if (method === "eth_accounts" || method === "eth_requestAccounts") return ["0x2222222222222222222222222222222222222222"];
        throw new Error(`Unexpected external wallet method: ${method}`);
      },
      on() {}, removeListener() {},
    };
    const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: {
      info: { uuid: "test-external", rdns: "test.external", name: "Test external wallet", icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E" }, provider,
    } }));
    window.addEventListener("eip6963:requestProvider", announce);
    announce();
  });
  await page.getByRole("button", { name: /1 other wallet/ }).click();
  await page.getByRole("button", { name: "Test external wallet", exact: true }).click();
  await expect(page.getByText("Owner: 0x22222222…2222", { exact: true })).toBeVisible();
  await app.select(networks[1]);
  await expect(page.getByText("Owner: 0x22222222…2222", { exact: true })).toBeVisible();
  await expect(page.getByText("2.000000", { exact: true })).toBeVisible();
});
