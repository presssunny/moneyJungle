/**
 * ONE-TIME, MANUAL backfill for the multi-user/RBAC migration.
 *
 * NOT run automatically by anything — not the migration, not app boot, not
 * the seed script. Run it yourself, once, AFTER you have applied the
 * `add_multi_user_rbac` migration:
 *
 *   cd backend
 *   npx ts-node --transpile-only prisma/scripts/backfillMultiUserAuth.ts
 *
 * What it does
 * ------------
 * The migration adds `email` / `password_hash` / `role` / `status` to
 * `users`, but cannot fill them in for rows that already existed — there is
 * no real password to migrate (the old model had one shared password in
 * .env, never stored per-account) and inventing one would be exactly the
 * kind of made-up data this task explicitly forbids.
 *
 * This script finds every existing account with no email yet and gives it
 * real login credentials, reusing the value you already know and already
 * use today: APP_GATE_USERNAME / APP_GATE_PASSWORD from backend/.env. That
 * is the one non-arbitrary choice available — it is the credential this
 * installation's owner is already typing in to reach the app right now, so
 * logging in after the migration keeps working with what you already know
 * instead of a generated value you'd have to be told separately.
 *
 * Safety
 * ------
 * - Refuses to run (prints each row and exits non-zero) if there is more
 *   than one account with no email yet — that means the app has been used
 *   in a way this script's mapping did not anticipate (e.g. the old `family`
 *   feature was used to create more than one `users` row before this
 *   migration), and deciding who becomes the admin and who becomes a
 *   FamilyMember of whom is not something this script will guess. Resolve
 *   that by hand (see the migration's own comment) and re-run.
 * - No-ops (prints and exits 0) if every account already has an email — safe
 *   to re-run.
 * - Never deletes or overwrites a row that already has an email.
 */
import { prisma } from "../../src/config/database";
import { hashPassword } from "../../src/utils/password.utils";

async function main() {
  const withoutEmail = await prisma.user.findMany({
    where: { email: null },
    orderBy: { id: "asc" },
  });

  if (withoutEmail.length === 0) {
    console.log("Nothing to backfill — every account already has an email.");
    return;
  }

  if (withoutEmail.length > 1) {
    console.error(
      `Refusing to backfill: ${withoutEmail.length} accounts have no email yet, and this script ` +
        "will not guess which one is the real admin or how the rest relate to it. Rows:"
    );
    for (const u of withoutEmail) console.error(`  id=${u.id} name=${JSON.stringify(u.name)}`);
    console.error(
      "Resolve by hand: decide which row is the admin account, set its email/password yourself " +
        "(e.g. via Prisma Studio or a short one-off script), and turn any other row into a " +
        "FamilyMember of that account (or a separate real account, if that's what it actually is) " +
        "before re-running."
    );
    process.exitCode = 1;
    return;
  }

  const target = withoutEmail[0];
  const rawUsername = process.env.APP_GATE_USERNAME;
  const rawPassword = process.env.APP_GATE_PASSWORD;

  if (!rawUsername || !rawPassword) {
    console.error(
      "APP_GATE_USERNAME and/or APP_GATE_PASSWORD are not set in the environment this script is " +
        "running in. Backfilling account id=" +
        target.id +
        " needs a real email and password — either set those two env vars to the credentials this " +
        "installation currently logs in with (they are already in backend/.env, so running this " +
        "script with `npx dotenv -e .env -- ts-node ...` or simply from the backend/ directory " +
        "should pick them up), or edit this script to supply different real values you choose."
    );
    process.exitCode = 1;
    return;
  }

  const email = rawUsername.includes("@") ? rawUsername : `${rawUsername}@moneyjungle.local`;

  const emailTaken = await prisma.user.findUnique({ where: { email } });
  if (emailTaken) {
    console.error(
      `Cannot backfill account id=${target.id}: email ${email} (derived from APP_GATE_USERNAME) is ` +
        `already in use by account id=${emailTaken.id}. This means an account with that email was ` +
        "already created some other way (e.g. through the CRM) before this script ran. Pick a " +
        "different real email for account id=" +
        target.id +
        " and edit this script's `email` value, or resolve the conflict by hand."
    );
    process.exitCode = 1;
    return;
  }

  const passwordHash = await hashPassword(rawPassword);

  await prisma.user.update({
    where: { id: target.id },
    data: { email, passwordHash, role: "ADMIN", status: "active" },
  });

  console.log(
    `Backfilled account id=${target.id} (${JSON.stringify(target.name)}) — email=${email}, role=ADMIN, status=active.`
  );
  console.log("Log in with that email and the password from APP_GATE_PASSWORD.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
