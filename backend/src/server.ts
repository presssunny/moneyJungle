import app from "./app";
import { env } from "./config/env";
import { prisma } from "./config/database";
import { connectionSync } from "./modules/connections/connectionSync.service";

const server = app.listen(env.PORT, env.HOST, () => {
  console.log(`API running on http://localhost:${env.PORT}`);
  connectionSync.failInterrupted().catch((error: unknown) => console.error("[סנכרון] ניקוי סנכרונים שנקטעו נכשל", error));
});

async function shutdown() {
  server.close();
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
