export class RateLimiter {
  private tokens: Map<string, number> = new Map();
  private lastUpdate: Map<string, number> = new Map();
  private readonly maxTokens: number = 3;
  private readonly intervalMs: number = 5000;

  consume(socketId: string): boolean {
    const now = Date.now();
    let currentTokens = this.tokens.get(socketId) ?? this.maxTokens;
    const lastUpdate = this.lastUpdate.get(socketId) ?? now;

    // Refill tokens
    const elapsed = now - lastUpdate;
    if (elapsed > this.intervalMs) {
      currentTokens = this.maxTokens;
      this.lastUpdate.set(socketId, now);
    }

    if (currentTokens > 0) {
      this.tokens.set(socketId, currentTokens - 1);
      return true;
    }

    return false;
  }

  cleanup(socketId: string) {
    this.tokens.delete(socketId);
    this.lastUpdate.delete(socketId);
  }
}
