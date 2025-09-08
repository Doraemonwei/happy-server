import { startApi } from "@/app/api";
import { log } from "@/utils/log";
import { awaitShutdown, onShutdown } from "@/utils/shutdown";
import { db } from './storage/db';
import { startTimeout } from "./app/timeout";
import { activityCache } from "@/modules/sessionCache";
import { auth } from "./modules/auth";
import { initEncrypt } from "./modules/encrypt";
import { initGithub } from "./modules/github";

async function initializeDefaultUser() {
    // Ensure default user exists for single-user mode
    try {
        await db.account.upsert({
            where: { id: 'default-user' },
            create: { 
                id: 'default-user',
                publicKey: 'single-user-mode-placeholder', // Required by schema, unused in single-user mode
                createdAt: new Date(),
                updatedAt: new Date()
            },
            update: {
                updatedAt: new Date()
            }
        });
        log({}, 'Default user initialized successfully');
    } catch (error) {
        log({ level: 'error' }, `Failed to initialize default user: ${error}`);
        throw error;
    }
}

async function main() {

    // Storage
    await db.$connect();
    onShutdown('db', async () => {
        await db.$disconnect();
    });
    onShutdown('activity-cache', async () => {
        activityCache.shutdown();
    });

    // Single-user mode: ensure default user exists
    await initializeDefaultUser();

    // Single-user mode: Skip authentication and encryption initialization
    await initGithub();
    await auth.init();

    //
    // Start
    //

    await startApi();
    startTimeout();

    //
    // Ready
    //

    log({}, 'Ready');
    await awaitShutdown();
    log({}, 'Shutting down...');
}

// Process-level error handling
process.on('uncaughtException', (error) => {
    log({
        module: 'process-error',
        level: 'error',
        stack: error.stack,
        name: error.name
    }, `Uncaught Exception: ${error.message}`);
    
    console.error('Uncaught Exception:', error);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    const errorMsg = reason instanceof Error ? reason.message : String(reason);
    const errorStack = reason instanceof Error ? reason.stack : undefined;
    
    log({
        module: 'process-error',
        level: 'error',
        stack: errorStack,
        reason: String(reason)
    }, `Unhandled Rejection: ${errorMsg}`);
    
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    process.exit(1);
});

process.on('warning', (warning) => {
    log({
        module: 'process-warning',
        level: 'warn',
        name: warning.name,
        stack: warning.stack
    }, `Process Warning: ${warning.message}`);
});

// Log when the process is about to exit
process.on('exit', (code) => {
    if (code !== 0) {
        log({
            module: 'process-exit',
            level: 'error',
            exitCode: code
        }, `Process exiting with code: ${code}`);
    } else {
        log({
            module: 'process-exit',
            level: 'info',
            exitCode: code
        }, 'Process exiting normally');
    }
});

main().catch((e) => {
    console.error(e);
    process.exit(1);
}).then(() => {
    process.exit(0);
});