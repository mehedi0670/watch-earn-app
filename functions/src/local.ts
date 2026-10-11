import path from "path";
import { createApp } from "./http";
import { MemoryRepo } from "./repo";
import { seedDemo } from "./seed";
import { EarnService } from "./service";
import { fetchAdmobKeys } from "./ssv";

async function main() {
const port = Number(process.env.PORT || 8787);
const dataPath = process.env.DATA_PATH || path.join(process.cwd(), ".data", "db.json");
const adminEmails = (process.env.ADMIN_EMAILS || "mehedi@earnza.local")
  .split(",")
  .map((item) => item.trim().toLowerCase())
  .filter(Boolean);

const repo = new MemoryRepo(dataPath);
await repo.init();
const service = new EarnService(repo, {
  demoMode: process.env.DEMO_SSV !== "false",
  adminEmails,
});

if ((await repo.userCount()) === 0 && process.env.SEED_DEMO !== "false") {
  await seedDemo(service);
  console.log("Seeded demo accounts.");
  console.log("  Admin  mehedi@earnza.local  /  EarnZA-admin-demo");
  console.log("  User   thabo@earnza.local   /  EarnZA-user-demo");
}

const app = createApp(service, {
  authMode: "local",
  jwtSecret: process.env.JWT_SECRET || "earnza-local-dev-secret-change-me",
  tokenTtlSeconds: 60 * 60 * 24 * 14,
  loadSsvKeys: fetchAdmobKeys,
});

app.listen(port, "0.0.0.0", () => {
  console.log(`EarnZA API listening on http://127.0.0.1:${port}`);
});
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
