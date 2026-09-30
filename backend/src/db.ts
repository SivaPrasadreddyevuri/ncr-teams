/**
 * The Prisma client.
 *
 * A singleton rather than a per-request client. Prisma's client owns a
 * connection pool, so constructing one per request would open a new pool each
 * time and exhaust the database's connection limit under any real traffic.
 *
 * The instance is cached on `globalThis` in development. Without that, every
 * edit under `tsx --watch` would leave the previous client -- and its pool --
 * open, and the process would slowly run out of connections while looking like
 * an ordinary slow query.
 */

import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
