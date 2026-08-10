import { defineConfig } from "prisma/config";

// Prisma 7: datasource URL is no longer allowed in schema.prisma.
// It must be declared here and passed to PrismaClient via a driver adapter.
// See: https://pris.ly/d/config-datasource
export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: process.env.DATABASE_URL as string,
  },
});
