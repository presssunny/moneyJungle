import { AsyncLocalStorage } from "node:async_hooks";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient, Prisma } from "../../generated/prisma/client";
import { env } from "./env";

const adapter = new PrismaMariaDb(env.DATABASE_URL);

const rootClient = new PrismaClient({ adapter });
const context = new AsyncLocalStorage<{client:Prisma.TransactionClient;userId:number;afterCommit:Array<()=>Promise<void>>}>();

// Existing domain services participate in the same import transaction. Nested
// transaction calls reuse it instead of committing independently.
export const prisma: PrismaClient = new Proxy(rootClient, {
  get(target, property) {
    const current = context.getStore()?.client;
    if (current && property === "$transaction") {
      return (operation: ((tx: Prisma.TransactionClient) => unknown) | Promise<unknown>[]) =>
        typeof operation === "function" ? operation(current) : Promise.all(operation);
    }
    const owner = current ?? target;
    const value = Reflect.get(owner, property);
    return typeof value === "function" ? value.bind(owner) : value;
  },
});

/** Serialize financial imports per owner, including workflow state and outputs. */
export async function withFinancialTransaction<T>(userId: number, action: () => Promise<T>): Promise<T> {
  const current=context.getStore();
  if(current) {
    if(current.userId!==userId) throw new Error("Cannot nest financial transactions for different owners");
    return action();
  }
  const afterCommit:Array<()=>Promise<void>>=[];
  const result=await rootClient.$transaction(async tx => {
    await tx.$queryRaw(Prisma.sql`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`);
    return context.run({client:tx,userId,afterCommit}, action);
  }, { timeout: 60000, maxWait: 15000 });
  for(const effect of afterCommit) await effect();
  return result;
}

export async function afterFinancialCommit(effect:()=>Promise<void>) {
  const current=context.getStore();
  if(current) current.afterCommit.push(effect);
  else await effect();
}
