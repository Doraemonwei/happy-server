-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Machine" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastActiveAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" TEXT NOT NULL DEFAULT '{}',
    "metadataVersion" INTEGER NOT NULL DEFAULT 0,
    "daemonState" TEXT,
    "daemonStateVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Machine_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Machine" ("accountId", "active", "createdAt", "id", "lastActiveAt", "seq", "updatedAt") SELECT "accountId", "active", "createdAt", "id", "lastActiveAt", "seq", "updatedAt" FROM "Machine";
DROP TABLE "Machine";
ALTER TABLE "new_Machine" RENAME TO "Machine";
CREATE INDEX "Machine_accountId_idx" ON "Machine"("accountId");
CREATE UNIQUE INDEX "Machine_accountId_id_key" ON "Machine"("accountId", "id");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
