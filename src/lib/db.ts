import { PrismaClient } from "@/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaPg } from "@prisma/adapter-pg";

const PLACEHOLDER_URL = "postgresql://placeholder:placeholder@localhost:5432/placeholder";

function makeClient(): PrismaClient {
  const url = process.env.DATABASE_URL ?? PLACEHOLDER_URL;
  const adapter =
    url.startsWith("postgres://") || url.startsWith("postgresql://")
      ? new PrismaPg({ connectionString: url })
      : new PrismaBetterSqlite3({
          url: url.startsWith("file:") ? url.slice("file:".length) : url,
        });
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function getClient(): PrismaClient {
  if (process.env.NODE_ENV === "production") {
    if (!productionClient) productionClient = makeClient();
    return productionClient;
  }
  if (!globalForPrisma.prisma) globalForPrisma.prisma = makeClient();
  return globalForPrisma.prisma;
}

let productionClient: PrismaClient | undefined;

export const prisma = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    return Reflect.get(getClient(), prop, getClient());
  },
}) as PrismaClient;
