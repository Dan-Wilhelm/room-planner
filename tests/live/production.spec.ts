import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

// Final acceptance run on the deployed app with real AI calls (section 13 of the build spec).
const PASSWORD = process.env.E2E_PASSWORD ?? "";
const ASSETS = process.env.LIVE_ASSETS ?? "";
const OUT = process.env.LIVE_OUT ?? "test-results/live";
const PIN = "https://www.pinterest.com/pin/warm-cozy-bedroom-vibes--3799980929874813/";

const TEST_ROOM = {
  version: 2,
  corners: [
    { x: 0, y: 0 },
    { x: 0, y: 360 },
    { x: 420, y: 360 },
    { x: 420, y: 150 },
    { x: 540, y: 150 },
    { x: 540, y: 0 },
  ],
  northAngle: 0,
  ceilingHeight: 250,
  slopes: [{ id: "s1", wallIndex: 2, kneeWallHeight: 100, fullHeightDistance: 160 }],
  wallFeatures: [
    { id: "f-door", kind: "door", wallIndex: 6, offset: 400, width: 80, z: 0, height: 200, hinge: "end", opens: "inward" },
    { id: "f-win", kind: "window", wallIndex: 5, offset: 25, width: 100, z: 90, height: 120, opening: "tilt-turn" },
    { id: "f-rad", kind: "radiator", wallIndex: 5, offset: 25, width: 100, z: 15, height: 60 },
    { id: "f-s1", kind: "socket", wallIndex: 3, offset: 20, width: 8, z: 30, height: 8 },
    { id: "f-s2", kind: "socket", wallIndex: 3, offset: 190, width: 8, z: 30, height: 8 },
    { id: "f-s3", kind: "socket", wallIndex: 6, offset: 485, width: 8, z: 30, height: 8 },
    { id: "f-sw", kind: "switch", wallIndex: 6, offset: 490, width: 8, z: 105, height: 8 },
  ],
  ceilingFeatures: [
    { id: "c-rw", kind: "roofWindow", x: 210, y: 296, width: 78, length: 118, lowerEdgeZ: 120, typeCode: "GGL MK06" },
    { id: "c-light", kind: "ceilingLight", x: 210, y: 180 },
  ],
  wallColor: "white",
  floorType: "oak-look laminate",
  template: { kind: "rectNiche", params: { width: 420, depth: 360, nicheWall: 3, nicheOffset: 210, nicheWidth: 150, nicheDepth: 120 } },
  estimates: { corners: { source: "user" }, template: { source: "user" }, ceilingHeight: { source: "user" }, slopes: { source: "user" }, wallFeatures: { source: "user" }, ceilingFeatures: { source: "user" } },
};

/** Direct IndexedDB access in the page (the test data is entered exactly; capture UI is covered by the mock e2e). */
async function idb<T>(page: Page, fn: string, arg: unknown): Promise<T> {
  return page.evaluate(
    async ({ fn, arg }) => {
      const open = () =>
        new Promise<IDBDatabase>((res, rej) => {
          const r = indexedDB.open("room-planner", 1);
          r.onsuccess = () => res(r.result);
          r.onerror = () => rej(r.error);
        });
      const db = await open();
      const run = new Function("db", "arg", `return (${fn})(db, arg)`);
      return run(db, arg);
    },
    { fn, arg },
  ) as Promise<T>;
}

const PUT = `async (db, { store, value }) => new Promise((res, rej) => { const tx = db.transaction(store, "readwrite"); tx.objectStore(store).put(value); tx.oncomplete = () => res(true); tx.onerror = () => rej(tx.error); })`;
const GET = `async (db, { store, key }) => new Promise((res, rej) => { const r = db.transaction(store).objectStore(store).get(key); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); })`;
const ALL = `async (db, { store }) => new Promise((res, rej) => { const r = db.transaction(store).objectStore(store).getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); })`;

function log(msg: string) {
  console.log(`[live ${new Date().toISOString().slice(11, 19)}] ${msg}`);
  fs.appendFileSync(path.join(OUT, "live-log.txt"), `${msg}\n`);
}

async function saveResults(page: Page, label: string) {
  const designs = await idb<Array<Record<string, unknown>>>(page, ALL, { store: "designs" });
  fs.writeFileSync(path.join(OUT, "designs.json"), JSON.stringify(designs, null, 1));
  const total = designs.reduce((s, d) => s + (d.costs as { usd: number }[]).reduce((a, c) => a + c.usd, 0), 0);
  log(`${label}: ${designs.length} designs stored, recorded cost $${total.toFixed(3)}`);
}

async function waitRunDone(page: Page, minutes: number) {
  const deadline = Date.now() + minutes * 60_000;
  for (;;) {
    const done = await page.getByText(/^Done/).count();
    const err = await page.locator("div.ring-red-200").count();
    if (done > 0) return;
    if (err > 0) throw new Error("Run error: " + (await page.locator("div.ring-red-200").first().innerText()));
    if (Date.now() > deadline) throw new Error("Run did not finish in time");
    await page.waitForTimeout(5000);
  }
}

test("final acceptance run on production", async ({ page }) => {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, "live-log.txt"), "");
  page.on("dialog", (d) => d.accept());
  expect(PASSWORD, "E2E_PASSWORD must be set").not.toBe("");

  // --- Login, project, room 1
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Your projects" })).toBeVisible();
  await page.waitForLoadState("networkidle");
  await page.getByPlaceholder(/New project name/).fill("Test apartment");
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByLabel("Project name")).toHaveValue("Test apartment");
  const projectUrl = page.url();
  await page.waitForLoadState("networkidle");
  await page.getByPlaceholder(/New room/).fill("Attic bedroom");
  await page.getByRole("button", { name: "Add room" }).click();
  await expect(page.getByRole("heading", { name: "Attic bedroom" })).toBeVisible();
  await page.waitForLoadState("networkidle");
  const [, projectId, roomId] = page.url().match(/\/p\/([^/]+)\/r\/([^/?#]+)/)!;

  // --- Exact test data: room model + furniture
  const room = await idb<Record<string, unknown>>(page, GET, { store: "rooms", key: roomId });
  await idb(page, PUT, { store: "rooms", value: { ...room, model: TEST_ROOM, modelConfirmed: false, description: "L-shaped attic bedroom with a niche to the east and a sloped ceiling on the north side." } });
  const inv = (id: string, name: string, category: string, w: number, d: number, h: number, flag: string, shapeHint = "") => ({ id, projectId, roomId, name, category, w, d, h, flag, color: "white", material: "wood", shapeHint });
  await idb(page, PUT, { store: "inventory", value: inv("inv-bed", "Double bed", "bed", 140, 200, 90, "keep", "bed with 90 cm headboard, frame 45 cm high") });
  await idb(page, PUT, { store: "inventory", value: inv("inv-wardrobe", "Wardrobe", "wardrobe", 100, 60, 200, "replaceable") });
  await idb(page, PUT, { store: "inventory", value: inv("inv-desk", "Desk", "desk", 120, 60, 75, "keep") });
  await page.reload();
  await page.waitForLoadState("networkidle");

  // --- Review & confirm
  await page.getByRole("button", { name: "2 · Review" }).click();
  await page.getByRole("button", { name: "Confirm room model" }).click();
  log("room 1 confirmed");

  // --- Taste & idea
  await page.getByRole("button", { name: "4 · Taste & idea" }).click();
  await page.getByText("I don't know yet — show me different directions.").click();
  await page.getByPlaceholder("e.g. bedroom with a home office corner").fill("bedroom with a home office corner");
  await page.locator("input[inputmode=decimal]").last().fill("300");
  await page.getByRole("button", { name: /Next: designs/ }).click();

  // --- 3 designs (live)
  const t0 = Date.now();
  await page.getByRole("button", { name: "Create 3 designs" }).click();
  await waitRunDone(page, 25);
  log(`run 1 done in ${Math.round((Date.now() - t0) / 1000)} s`);
  const compare = page.locator("section", { has: page.getByRole("heading", { name: "Compare" }) });
  await expect(compare.getByRole("row")).toHaveCount(4);
  await page.screenshot({ path: path.join(OUT, "01-designs.png"), fullPage: false });

  await saveResults(page, "after run 1");

  // --- Alternatives on the rug (or the first furniture item if this design has no new rug)
  const cards = page.locator("div.rounded-lg").filter({ has: page.getByRole("button", { name: "Alternatives" }) });
  const rugCard = cards.filter({ hasText: /Rug ·/ });
  const target = (await rugCard.count()) ? rugCard.first() : cards.filter({ hasNotText: /^(Paint|Material|Cushion|Throw|Other) ·/ }).first();
  log(`alternatives for: ${(await target.locator("span").first().innerText()).slice(0, 80)}`);
  await target.getByRole("button", { name: "Alternatives" }).click();
  await page.getByPlaceholder(/cheaper, in green/).fill("cheaper");
  await page.getByRole("button", { name: "Find alternatives" }).click();
  const swaps = page.locator("aside").getByRole("button", { name: /Swap/ });
  await expect(swaps.first()).toBeVisible({ timeout: 5 * 60_000 });
  log(`alternatives shown: ${await swaps.count()}`);
  const labels = await page.locator("aside span").filter({ hasText: /^(fits|fits if moved|doesn't fit)$/ }).allInnerTexts();
  log(`alternative fit labels: ${labels.join(", ")}`);
  await swaps.first().click();
  await expect(page.locator("aside").getByText(/Current \(Budget\)/)).toBeVisible();

  // --- Image
  await page.getByRole("button", { name: "Generate image" }).click();
  await expect(page.getByAltText(/Photorealistic render of/)).toBeVisible({ timeout: 5 * 60_000 });
  await page.getByAltText(/Photorealistic render of/).screenshot({ path: path.join(OUT, "02-render.png") });
  log("image generated");

  // --- Shopping list CSV
  await page.getByRole("button", { name: "Shopping list" }).click();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "CSV" }).click()]);
  await download.saveAs(path.join(OUT, "shopping-list.csv"));
  await page.getByRole("button", { name: "Close", exact: true }).click();
  log("CSV exported");

  // --- Build on this design with one locked item
  await page.getByRole("button", { name: "Build on this design" }).click();
  await page.getByPlaceholder(/desk by the window/).fill("warmer light, cheaper rug");
  await page.locator("div.max-h-48 input[type=checkbox]").first().check();
  await page.getByRole("button", { name: "Create variations" }).click();
  const t1 = Date.now();
  await expect(page.getByText(/History \(1 earlier run/)).toBeVisible({ timeout: 5 * 60_000 });
  await waitRunDone(page, 20);
  await expect(compare.getByRole("row")).toHaveCount(3);
  log(`build-on done in ${Math.round((Date.now() - t1) / 1000)} s`);
  await saveResults(page, "after build-on");

  // --- Mark chosen
  await page.getByRole("button", { name: "Mark as chosen" }).click();
  await expect(page.getByRole("button", { name: "Unmark as chosen" })).toBeVisible();

  // --- Room 2: estimation test (analysis only)
  await page.goto(projectUrl);
  await page.waitForLoadState("networkidle");
  await page.getByPlaceholder(/New room/).fill("Living room (estimation test)");
  await page.getByRole("button", { name: "Add room" }).click();
  await expect(page.getByRole("heading", { name: "Living room (estimation test)" })).toBeVisible();
  await page.waitForLoadState("networkidle");
  await page.getByPlaceholder(/What is the room used for/).fill("Living room with a sofa, a dining area and a big window. Roughly 5 by 4 metres. Ceiling height 2.50 m (measured).");
  await page.locator("input[type=file]").first().setInputFiles([1, 2, 3].map((i) => path.join(ASSETS, `living${i}.jpg`)));
  await expect(page.locator("img").nth(2)).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: "Enter dimensions" }).click();
  const ceiling = page.getByLabel("Ceiling height").first();
  await ceiling.fill("250");
  await ceiling.blur();
  await page.getByRole("button", { name: "Analyse with AI" }).click();
  await expect(page.getByText(/Estimated values \(\d+\)/)).toBeVisible({ timeout: 10 * 60_000 });
  await expect(page.getByLabel("Ceiling height").first()).toHaveValue("250");
  log(`room 2 estimates: ${await page.getByText(/Estimated values \(\d+\)/).innerText()}`);
  await page.screenshot({ path: path.join(OUT, "03-estimation.png"), fullPage: true });

  // --- Inspiration test
  await page.goto(projectUrl);
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Inspiration board" }).click();
  await page.getByPlaceholder("https://www.pinterest.com/pin/…").fill(PIN);
  await page.getByPlaceholder("What is meant? (optional)").fill("only the colours and the lighting");
  await page.getByRole("button", { name: "Add link" }).click();
  const notice = page.locator("div.ring-emerald-200, div.ring-amber-200, div.ring-red-200").first();
  await expect(notice).toBeVisible({ timeout: 2 * 60_000 });
  log(`pinterest preview: ${await notice.innerText()}`);
  if (!(await page.getByText(/Added \d+ image/).count())) {
    await page.locator("input[type=file]").nth(1).setInputFiles([2, 3].map((i) => path.join(ASSETS, `living${i}.jpg`)));
    log("preview failed → uploaded 2 images");
  }
  await page.getByRole("button", { name: /Analyse design idea/ }).click();
  await expect(page.getByText("Design DNA")).toBeVisible({ timeout: 5 * 60_000 });
  log("design DNA extracted");

  // --- Room 1: start over following the inspiration
  await page.goto(`${projectUrl}/r/${roomId}`);
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "4 · Taste & idea" }).click();
  await page.getByText("Follow inspiration(s)").click();
  await page.getByRole("button", { name: /Next: designs/ }).click();
  const t2 = Date.now();
  await page.getByRole("button", { name: /Start over/ }).click();
  await page.waitForTimeout(3000);
  await waitRunDone(page, 25);
  log(`inspiration run done in ${Math.round((Date.now() - t2) / 1000)} s`);
  await saveResults(page, "after inspiration run");
  await page.screenshot({ path: path.join(OUT, "04-inspiration-designs.png") });

  // --- Overview
  await page.goto(projectUrl);
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Overview & shopping list" }).click();
  await expect(page.getByText(/Combined shopping list — €\d/)).toBeVisible();
  log(`overview: ${await page.getByText(/Combined shopping list — €\d/).innerText()}`);
  await page.screenshot({ path: path.join(OUT, "05-overview.png"), fullPage: true });

  // --- Collect results
  const designs = await idb<Array<Record<string, unknown>>>(page, ALL, { store: "designs" });
  fs.writeFileSync(path.join(OUT, "designs.json"), JSON.stringify(designs, null, 1));
  log(`designs stored: ${designs.length}`);
});
