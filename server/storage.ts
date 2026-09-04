import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { DemoState } from "../shared/types.js";

const stateFile = "runtime-state.json";

export class JsonStateStore {
  constructor(private readonly dataDir: string) {}

  async read(): Promise<DemoState | null> {
    try {
      const raw = await readFile(path.join(this.dataDir, stateFile), "utf8");
      return JSON.parse(raw) as DemoState;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }

  async write(state: DemoState): Promise<void> {
    await mkdir(this.dataDir, { recursive: true });
    await writeFile(path.join(this.dataDir, stateFile), JSON.stringify(state, null, 2));
  }

  async writeJson(name: string, value: unknown): Promise<string> {
    await mkdir(this.dataDir, { recursive: true });
    const filePath = path.join(this.dataDir, name);
    await writeFile(filePath, JSON.stringify(value, null, 2));
    return filePath;
  }
}
