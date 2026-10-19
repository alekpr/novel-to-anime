#!/usr/bin/env node
import { execSync } from "child_process";
import fs from "fs";
import path from "path";

const mongoUri = process.env.MONGO_URI ?? "mongodb://127.0.0.1:27017/novel_anime";
const dataDir = path.resolve(process.env.DATA_DIR ?? "./data");
const backupDir = path.join(dataDir, "backups");
fs.mkdirSync(backupDir, { recursive: true });

const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
const archive = path.join(backupDir, `db-${date}.gz`);

console.log(`Backing up MongoDB → ${archive}`);
execSync(`mongodump --uri="${mongoUri}" --archive="${archive}" --gzip`);
console.log("Backup complete.");
