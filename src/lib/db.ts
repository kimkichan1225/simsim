import { PrismaClient } from "@/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaPg } from "@prisma/adapter-pg";

type Adapter = ReturnType<typeof makeAdapter>;

function makeAdapter() {
  const url = process.env.DATABASE_URL ?? "file:./dev.db";
  if (url.startsWith("postgres://") || url.startsWith("postgresql://")) {
    return new PrismaPg({ connectionString: url });
  }
  const sqlitePath = url.startsWith("file:") ? url.slice("file:".length) : url;
  return new PrismaBetterSqlite3({ url: sqlitePath });
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  prismaAdapter: Adapter | undefined;
};

const adapter = globalForPrisma.prismaAdapter ?? makeAdapter();

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
  globalForPrisma.prismaAdapter = adapter;
}
