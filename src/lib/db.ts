import { PrismaClient } from "@/generated/prisma";

// Ensure a single Prisma instance in dev/hot-reload
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    // Keep logs minimal by default; set PRISMA_LOG_QUERY=1 to enable query logging
    log: process.env.PRISMA_LOG_QUERY === "1" ? ["query", "error", "warn"] : ["error", "warn"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
