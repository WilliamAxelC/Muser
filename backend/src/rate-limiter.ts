export class RateLimiter {
  private tokens: Map<string, number> = new Map();
  private lastUpdate: Map<string, number> = new Map();
  private readonly maxTokens: number = 3;
  private readonly intervalMs: number = 5000;

  consume(socketId: string, customMaxTokens?: number, customIntervalMs?: number): { allowed: boolean, remainingMs: number } {
    const now = Date.now();
    const maxTokens = customMaxTokens ?? this.maxTokens;
    const intervalMs = customIntervalMs ?? this.intervalMs;

    let currentTokens = this.tokens.get(socketId);
    let lastUpdate = this.lastUpdate.get(socketId);

    if (currentTokens === undefined || lastUpdate === undefined) {
      currentTokens = maxTokens;
      lastUpdate = now;
      this.lastUpdate.set(socketId, now);
      this.tokens.set(socketId, maxTokens);
    }

    const elapsed = now - lastUpdate;
    if (elapsed >= intervalMs) {
      currentTokens = maxTokens;
      this.lastUpdate.set(socketId, now);
      lastUpdate = now;
    } else if (currentTokens > maxTokens) {
      currentTokens = maxTokens;
    }

    if (currentTokens > 0) {
      this.tokens.set(socketId, currentTokens - 1);
      return { allowed: true, remainingMs: 0 };
    }

    const remainingMs = intervalMs - (now - lastUpdate);
    return { allowed: false, remainingMs: remainingMs > 0 ? remainingMs : 0 };
  }

  cleanup(socketId: string) {
    this.tokens.delete(socketId);
    this.lastUpdate.delete(socketId);
  }
}

