import type { AuthenticationCreds, AuthenticationState, SignalDataTypeMap } from "@whiskeysockets/baileys";
import { BufferJSON, initAuthCreds } from "@whiskeysockets/baileys";
import { prisma } from "@/lib/db";

// DB-backed Baileys auth state (creds + keys)
export async function useDbAuthState(sessionId: string): Promise<{ state: AuthenticationState; saveCreds: () => Promise<void> }>
{
  try {
    // load creds or initialize
    const existing = await prisma.waAuthCreds.findUnique({ where: { sessionId } });
    let creds: AuthenticationCreds;
    if (existing?.data) {
      creds = JSON.parse(existing.data, BufferJSON.reviver) as AuthenticationCreds;
    } else {
      creds = initAuthCreds();
      await prisma.waAuthCreds.upsert({
        where: { sessionId },
        update: { data: JSON.stringify(creds, BufferJSON.replacer) },
        create: { sessionId, data: JSON.stringify(creds, BufferJSON.replacer) },
      });
    }

    const keyStore: AuthenticationState["keys"] = {
      get: async <T extends keyof SignalDataTypeMap>(type: T, ids: string[]) => {
        const rows = await prisma.waAuthKey.findMany({
          where: { sessionId, type, keyId: { in: ids } },
        });
        const result: { [key: string]: SignalDataTypeMap[T] } = {} as any;
        for (const id of ids) {
          const row = rows.find((r) => r.keyId === id);
          if (row) {
            result[id] = JSON.parse(row.value, BufferJSON.reviver);
          }
        }
        return result;
      },
      set: async (data) => {
        const actions: any[] = [];
        for (const type in data) {
          const typeData = (data as any)[type] as Record<string, any>;
          for (const id in typeData) {
            const value = typeData[id];
            if (value == null) {
              actions.push(
                prisma.waAuthKey.deleteMany({ where: { sessionId, type, keyId: id } })
              );
            } else {
              actions.push(
                prisma.waAuthKey.upsert({
                  where: { wa_authkey_unique: { sessionId, type, keyId: id } },
                  update: { value: JSON.stringify(value, BufferJSON.replacer) },
                  create: { sessionId, type, keyId: id, value: JSON.stringify(value, BufferJSON.replacer) },
                })
              );
            }
          }
        }
        if (actions.length) await prisma.$transaction(actions);
      },
    };

    const saveCreds = async () => {
      await prisma.waAuthCreds.update({
        where: { sessionId },
        data: { data: JSON.stringify(creds, BufferJSON.replacer) },
      });
    };

    const state: AuthenticationState = { creds, keys: keyStore };
    return { state, saveCreds };
  } catch (e: any) {
    const msg = String(e?.message || e)
    if (msg.includes("no such table") || msg.includes("does not exist") || e?.code === "P2021") {
      const err = new Error("Database not migrated. Run: npx prisma migrate deploy (or npx prisma db push for dev)") as Error & { code?: string }
      err.code = "DB_NOT_MIGRATED"
      throw err
    }
    throw e
  }
}
