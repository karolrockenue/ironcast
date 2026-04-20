import React, { createContext, useContext, useEffect, useState } from "react";
import * as SQLite from "expo-sqlite";
import { initDB } from "./schema";

const DBContext = createContext<SQLite.SQLiteDatabase | null>(null);

export function useDB() {
  const db = useContext(DBContext);
  if (!db) throw new Error("useDB must be used within DBProvider");
  return db;
}

export function DBProvider({ children }: { children: React.ReactNode }) {
  const [db, setDb] = useState<SQLite.SQLiteDatabase | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const database = await SQLite.openDatabaseAsync("ironlog.db");
      await initDB(database);
      if (mounted) setDb(database);
    })();
    return () => {
      mounted = false;
    };
  }, []);

  if (!db) return null;
  return <DBContext.Provider value={db}>{children}</DBContext.Provider>;
}
