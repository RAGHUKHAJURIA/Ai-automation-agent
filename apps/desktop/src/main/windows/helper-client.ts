import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const responseSchema = z
  .object({
    protocolVersion: z.literal(1),
    requestId: z.string(),
    status: z.enum(['SUCCESS', 'FAILED']),
    result: z.unknown().optional(),
    errorCode: z.string().max(64).optional(),
  })
  .strict();
const helperScript = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../windows/helper.py',
);
type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

export class WindowsHelperClient {
  private process: ChildProcessWithoutNullStreams | undefined;
  private pending = new Map<string, Pending>();
  private buffer = '';
  private readonly pythonPath: string;
  constructor(pythonPath: string) {
    this.pythonPath = pythonPath;
  }
  async ping(): Promise<boolean> {
    try {
      await this.request('ping', {});
      return true;
    } catch {
      return false;
    }
  }
  async request(
    operation: string,
    payload: Record<string, unknown>,
    timeoutMs = 10_000,
  ): Promise<unknown> {
    if (process.platform !== 'win32') throw new Error('NOT_SUPPORTED');
    if (!this.process) this.start();
    if (!this.process || !this.process.stdin.writable) throw new Error('HELPER_UNAVAILABLE');
    const requestId = randomUUID();
    const boundedTimeout = Math.min(Math.max(timeoutMs, 1), 30_000);
    const body = JSON.stringify({
      protocolVersion: 1,
      requestId,
      operation,
      deadline: Date.now() + boundedTimeout,
      payload,
    });
    if (Buffer.byteLength(body) > 65_536) throw new Error('HELPER_REQUEST_TOO_LARGE');
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        this.failAll('HELPER_TIMEOUT');
        this.process?.kill();
        this.process = undefined;
        reject(new Error('HELPER_TIMEOUT'));
      }, boundedTimeout);
      this.pending.set(requestId, { resolve, reject, timer });
      this.process!.stdin.write(`${body}\n`, (error) => {
        if (error) {
          clearTimeout(timer);
          this.pending.delete(requestId);
          reject(new Error('HELPER_UNAVAILABLE'));
        }
      });
    });
  }
  close(): void {
    this.failAll('HELPER_UNAVAILABLE');
    this.process?.kill();
    this.process = undefined;
  }
  private start(): void {
    if (!path.isAbsolute(this.pythonPath)) throw new Error('HELPER_NOT_CONFIGURED');
    this.process = spawn(this.pythonPath, ['-I', helperScript], {
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.process.stdout.setEncoding('utf8');
    this.process.stdout.on('data', (chunk: string) => this.receive(chunk));
    this.process.stderr.on('data', () => {
      /* Never forward helper diagnostics or private UI content. */
    });
    this.process.on('error', () => {
      this.failAll('HELPER_UNAVAILABLE');
      this.process = undefined;
    });
    this.process.on('exit', () => {
      this.failAll('HELPER_UNAVAILABLE');
      this.process = undefined;
    });
  }
  private receive(chunk: string): void {
    this.buffer += chunk;
    if (this.buffer.length > 1_000_000) {
      this.close();
      return;
    }
    for (;;) {
      const end = this.buffer.indexOf('\n');
      if (end < 0) break;
      const line = this.buffer.slice(0, end);
      this.buffer = this.buffer.slice(end + 1);
      let result: z.infer<typeof responseSchema>;
      try {
        result = responseSchema.parse(JSON.parse(line));
      } catch {
        this.close();
        return;
      }
      const pending = this.pending.get(result.requestId);
      if (!pending) continue;
      this.pending.delete(result.requestId);
      clearTimeout(pending.timer);
      if (result.status === 'SUCCESS') pending.resolve(result.result);
      else pending.reject(new Error(result.errorCode ?? 'HELPER_OPERATION_FAILED'));
    }
  }
  private failAll(code: string): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error(code));
    }
    this.pending.clear();
  }
}
