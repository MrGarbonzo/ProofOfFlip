import * as fs from 'fs';
import * as path from 'path';

export interface StorageProvider {
  exists(key: string): Promise<boolean>;
  read(key: string): Promise<string>;
  write(key: string, data: string): Promise<void>;
}

export class FileStorageProvider implements StorageProvider {
  private basePath: string;

  constructor(basePath?: string) {
    this.basePath = basePath || process.env.STORAGE_PATH || './data';
    if (!fs.existsSync(this.basePath)) {
      fs.mkdirSync(this.basePath, { recursive: true });
    }
  }

  private filePath(key: string): string {
    return path.join(this.basePath, `${key}.json`);
  }

  async exists(key: string): Promise<boolean> {
    return fs.existsSync(this.filePath(key));
  }

  async read(key: string): Promise<string> {
    return fs.readFileSync(this.filePath(key), 'utf-8');
  }

  async write(key: string, data: string): Promise<void> {
    fs.writeFileSync(this.filePath(key), data, 'utf-8');
  }
}
