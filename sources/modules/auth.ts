// Single-user mode: Authentication disabled - all functions are no-ops
import { log } from "@/utils/log";

interface TokenCacheEntry {
    userId: string;
    extras?: any;
    cachedAt: number;
}

class AuthModule {
    private tokenCache = new Map<string, TokenCacheEntry>();
    
    async init(): Promise<void> {
        log({ module: 'auth' }, 'Single-user mode: Auth module disabled');
    }
    
    async createToken(userId: string, extras?: any): Promise<string> {
        // Single-user mode: return a placeholder token
        const token = `single-user-token-${userId}-${Date.now()}`;
        this.tokenCache.set(token, {
            userId,
            extras,
            cachedAt: Date.now()
        });
        return token;
    }
    
    async verifyToken(token: string): Promise<{ userId: string; extras?: any } | null> {
        // Single-user mode: always return default user
        return {
            userId: 'default-user',
            extras: undefined
        };
    }
    
    invalidateUserTokens(userId: string): void {
        // Single-user mode: no-op
        log({ module: 'auth' }, `Single-user mode: Invalidated tokens for user: ${userId}`);
    }
    
    invalidateToken(token: string): void {
        // Single-user mode: no-op
        this.tokenCache.delete(token);
    }
    
    getCacheStats(): { size: number; oldestEntry: number | null } {
        if (this.tokenCache.size === 0) {
            return { size: 0, oldestEntry: null };
        }
        
        let oldest = Date.now();
        for (const entry of this.tokenCache.values()) {
            if (entry.cachedAt < oldest) {
                oldest = entry.cachedAt;
            }
        }
        
        return {
            size: this.tokenCache.size,
            oldestEntry: oldest
        };
    }
    
    async createGithubToken(userId: string): Promise<string> {
        // Single-user mode: return a placeholder token
        return `single-user-github-token-${userId}-${Date.now()}`;
    }

    async verifyGithubToken(token: string): Promise<{ userId: string } | null> {
        // Single-user mode: always return default user
        return { userId: 'default-user' };
    }

    // Cleanup old entries (optional - can be called periodically)
    cleanup(): void {
        const stats = this.getCacheStats();
        log({ module: 'auth' }, `Single-user mode: Token cache size: ${stats.size} entries`);
    }
}

// Global instance
export const auth = new AuthModule();