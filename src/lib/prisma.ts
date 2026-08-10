/**
 * Prisma client singleton.
 *
 * Avoids creating a new connection per request in dev where Next.js hot-reloads
 * server modules. See https://www.prisma.io/docs/orm/more/help-and-troubleshooting/help-articles/nextjs-prisma-client-dev-practices
 *
 * Prisma 7: datasource `url` is no longer declared in schema.prisma.
 * Pass it here via `datasourceUrl`. See https://pris.ly/d/prisma7-client-config
 */
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasourceUrl: process.env.DATABASE_URL,
    log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
