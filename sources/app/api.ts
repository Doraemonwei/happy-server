import fastify, { FastifyInstance } from "fastify";
import { log, logger } from "@/utils/log";
import { serializerCompiler, validatorCompiler, ZodTypeProvider } from "fastify-type-provider-zod";
import { Server, Socket } from "socket.io";
import { z } from "zod";
import { db } from "@/storage/db";
import { Account, Prisma } from "@prisma/client";
import { onShutdown } from "@/utils/shutdown";
import { allocateSessionSeq, allocateUserSeq } from "@/services/seq";
import { randomKeyNaked } from "@/utils/randomKeyNaked";
import { AsyncLock } from "@/utils/lock";
import { auth } from "@/modules/auth";
import {
    EventRouter,
    ClientConnection,
    buildNewSessionUpdate,
    buildNewMessageUpdate,
    buildUpdateSessionUpdate,
    buildUpdateAccountUpdate,
    buildUpdateMachineUpdate,
    buildSessionActivityEphemeral,
    buildMachineActivityEphemeral,
    buildUsageEphemeral,
} from "@/modules/eventRouter";
import { activityCache } from "@/modules/sessionCache";
import { encryptBytes, encryptString } from "@/modules/encrypt";
import { separateName } from "@/utils/separateName";


declare module 'fastify' {
    interface FastifyRequest {
        userId: string;
        startTime?: number;
    }
    interface FastifyInstance {
        authenticate: any;
    }
}


export async function startApi(): Promise<{ app: FastifyInstance; io: Server }> {

    // Configure
    log({}, 'Starting API...');

    // Start API
    const app = fastify({
        loggerInstance: logger,
        bodyLimit: 1024 * 1024 * 100, // 100MB
    });
    app.register(import('@fastify/cors'), {
        origin: '*',
        allowedHeaders: '*',
        methods: ['GET', 'POST', 'DELETE']
    });
    app.get('/', function (request, reply) {
        reply.send('Welcome to Happy Server!');
    });

    // Health check endpoint
    app.get('/health', async (request, reply) => {
        try {
            // Test database connectivity
            await db.$queryRaw`SELECT 1`;
            reply.send({
                status: 'ok',
                timestamp: new Date().toISOString(),
                service: 'happy-server'
            });
        } catch (error) {
            log({ module: 'health', level: 'error' }, `Health check failed: ${error}`);
            reply.code(503).send({
                status: 'error',
                timestamp: new Date().toISOString(),
                service: 'happy-server',
                error: 'Database connectivity failed'
            });
        }
    });

    // Add content type parser for webhook endpoints to preserve raw body
    app.addContentTypeParser(
        'application/json',
        { parseAs: 'string' },
        function (req, body, done) {
            try {
                const bodyStr = body as string;

                // Handle empty body case - common for DELETE, GET requests
                if (!bodyStr || bodyStr.trim() === '') {
                    (req as any).rawBody = bodyStr;
                    // For DELETE and GET methods, empty body is expected
                    if (req.method === 'DELETE' || req.method === 'GET') {
                        done(null, undefined);
                        return;
                    }
                    // For other methods, return empty object
                    done(null, {});
                    return;
                }

                const json = JSON.parse(bodyStr);
                // Store raw body for webhook signature verification
                (req as any).rawBody = bodyStr;
                done(null, json);
            } catch (err: any) {
                log({ module: 'content-parser', level: 'error' }, `JSON parse error on ${req.method} ${req.url}: ${err.message}, body: "${body}"`);
                err.statusCode = 400;
                done(err, undefined);
            }
        }
    );

    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    const typed = app.withTypeProvider<ZodTypeProvider>();

    // Add metrics hooks
    app.addHook('onRequest', async (request, reply) => {
        request.startTime = Date.now();
    });

    app.addHook('onResponse', async (request, reply) => {
        const duration = (Date.now() - (request.startTime || Date.now())) / 1000;
        const method = request.method;
        // Use routeOptions.url for the route template, fallback to parsed URL path
        const route = request.routeOptions?.url || request.url.split('?')[0] || 'unknown';
        const status = reply.statusCode.toString();

        // Increment request counter

        // Record request duration
    });

    // Global error handler
    app.setErrorHandler(async (error, request, reply) => {
        const method = request.method;
        const url = request.url;
        const userAgent = request.headers['user-agent'] || 'unknown';
        const ip = request.ip || 'unknown';

        // Log the error with comprehensive context
        log({
            module: 'fastify-error',
            level: 'error',
            method,
            url,
            userAgent,
            ip,
            statusCode: error.statusCode || 500,
            errorCode: error.code,
            stack: error.stack
        }, `Unhandled error: ${error.message}`);

        // Return appropriate error response
        const statusCode = error.statusCode || 500;

        if (statusCode >= 500) {
            // Internal server errors - don't expose details
            return reply.code(statusCode).send({
                error: 'Internal Server Error',
                message: 'An unexpected error occurred',
                statusCode
            });
        } else {
            // Client errors - can expose more details
            return reply.code(statusCode).send({
                error: error.name || 'Error',
                message: error.message || 'An error occurred',
                statusCode
            });
        }
    });

    // Error hook for additional logging
    app.addHook('onError', async (request, reply, error) => {
        const method = request.method;
        const url = request.url;
        const duration = (Date.now() - (request.startTime || Date.now())) / 1000;

        log({
            module: 'fastify-hook-error',
            level: 'error',
            method,
            url,
            duration,
            statusCode: reply.statusCode || error.statusCode || 500,
            errorName: error.name,
            errorCode: error.code
        }, `Request error: ${error.message}`);
    });

    // Handle uncaught exceptions in routes
    app.addHook('preHandler', async (request, reply) => {
        // Store original reply.send to catch errors in response serialization
        const originalSend = reply.send.bind(reply);
        reply.send = function (payload: any) {
            try {
                return originalSend(payload);
            } catch (error: any) {
                log({
                    module: 'fastify-serialization-error',
                    level: 'error',
                    method: request.method,
                    url: request.url,
                    stack: error.stack
                }, `Response serialization error: ${error.message}`);
                throw error;
            }
        };
    });

    // Single-user mode: simplified authentication decorator
    app.decorate('authenticate', async function (request: any, reply: any) {
        // Single user mode: directly set fixed userId
        request.userId = 'default-user';
        log({ module: 'auth-decorator' }, `Single-user mode: using default user`);
    });

    // Initialize event router
    const eventRouter = new EventRouter();

    // Single-user mode: Authentication endpoints removed





    // Single-user mode: Authentication endpoints removed

    // OpenAI Realtime ephemeral token generation
    typed.post('/v1/openai/realtime-token', {
        preHandler: app.authenticate,
        schema: {
            response: {
                200: z.object({
                    token: z.string()
                }),
                500: z.object({
                    error: z.string()
                })
            }
        }
    }, async (request, reply) => {
        try {
            // Check if OpenAI API key is configured on server
            const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
            if (!OPENAI_API_KEY) {
                return reply.code(500).send({
                    error: 'OpenAI API key not configured on server'
                });
            }

            // Generate ephemeral token from OpenAI
            const response = await fetch('https://api.openai.com/v1/realtime/sessions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${OPENAI_API_KEY}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    model: 'gpt-4o-realtime-preview-2024-12-17',
                    voice: 'verse',
                }),
            });

            if (!response.ok) {
                throw new Error(`OpenAI API error: ${response.status}`);
            }

            const data = await response.json() as {
                client_secret: {
                    value: string;
                    expires_at: number;
                };
                id: string;
            };

            return reply.send({
                token: data.client_secret.value
            });
        } catch (error) {
            log({ module: 'openai', level: 'error' }, 'Failed to generate ephemeral token', error);
            return reply.code(500).send({
                error: 'Failed to generate ephemeral token'
            });
        }
    });

    // Sessions API
    typed.get('/v1/sessions', {
        preHandler: app.authenticate,
    }, async (request, reply) => {
        const userId = request.userId;

        const sessions = await db.session.findMany({
            where: { accountId: userId },
            orderBy: { updatedAt: 'desc' },
            take: 150,
            select: {
                id: true,
                seq: true,
                createdAt: true,
                updatedAt: true,
                metadata: true,
                metadataVersion: true,
                agentState: true,
                agentStateVersion: true,
                active: true,
                lastActiveAt: true,
                // messages: {
                //     orderBy: { seq: 'desc' },
                //     take: 1,
                //     select: {
                //         id: true,
                //         seq: true,
                //         content: true,
                //         localId: true,
                //         createdAt: true
                //     }
                // }
            }
        });

        return reply.send({
            sessions: sessions.map((v) => {
                // const lastMessage = v.messages[0];
                const sessionUpdatedAt = v.updatedAt.getTime();
                // const lastMessageCreatedAt = lastMessage ? lastMessage.createdAt.getTime() : 0;

                return {
                    id: v.id,
                    seq: v.seq,
                    createdAt: v.createdAt.getTime(),
                    updatedAt: sessionUpdatedAt,
                    active: v.active,
                    activeAt: v.lastActiveAt.getTime(),
                    metadata: v.metadata,
                    metadataVersion: v.metadataVersion,
                    agentState: v.agentState,
                    agentStateVersion: v.agentStateVersion,
                    lastMessage: null
                };
            })
        });
    });

    // V2 Sessions API - Active sessions only
    typed.get('/v2/sessions/active', {
        preHandler: app.authenticate,
        schema: {
            querystring: z.object({
                limit: z.coerce.number().int().min(1).max(500).default(150)
            }).optional()
        }
    }, async (request, reply) => {
        const userId = request.userId;
        const limit = request.query?.limit || 150;

        const sessions = await db.session.findMany({
            where: {
                accountId: userId,
                active: true,
                lastActiveAt: { gt: new Date(Date.now() - 1000 * 60 * 15) /* 15 minutes */ }
            },
            orderBy: { lastActiveAt: 'desc' },
            take: limit,
            select: {
                id: true,
                seq: true,
                createdAt: true,
                updatedAt: true,
                metadata: true,
                metadataVersion: true,
                agentState: true,
                agentStateVersion: true,
                active: true,
                lastActiveAt: true,
            }
        });

        return reply.send({
            sessions: sessions.map((v) => ({
                id: v.id,
                seq: v.seq,
                createdAt: v.createdAt.getTime(),
                updatedAt: v.updatedAt.getTime(),
                active: v.active,
                activeAt: v.lastActiveAt.getTime(),
                metadata: v.metadata,
                metadataVersion: v.metadataVersion,
                agentState: v.agentState,
                agentStateVersion: v.agentStateVersion,
            }))
        });
    });

    // V2 Sessions API - Cursor-based pagination with change tracking
    typed.get('/v2/sessions', {
        preHandler: app.authenticate,
        schema: {
            querystring: z.object({
                cursor: z.string().optional(),
                limit: z.coerce.number().int().min(1).max(200).default(50),
                changedSince: z.coerce.number().int().positive().optional()
            }).optional()
        }
    }, async (request, reply) => {
        const userId = request.userId;
        const { cursor, limit = 50, changedSince } = request.query || {};

        // Decode cursor - simple ID-based cursor
        let cursorSessionId: string | undefined;
        if (cursor) {
            if (cursor.startsWith('cursor_v1_')) {
                cursorSessionId = cursor.substring(10);
            } else {
                return reply.code(400).send({ error: 'Invalid cursor format' });
            }
        }

        // Build where clause
        const where: Prisma.SessionWhereInput = { accountId: userId };

        // Add changedSince filter (just a filter, doesn't affect pagination)
        if (changedSince) {
            where.updatedAt = {
                gt: new Date(changedSince)
            };
        }

        // Add cursor pagination - always by ID descending (most recent first)
        if (cursorSessionId) {
            where.id = {
                lt: cursorSessionId  // Get sessions with ID less than cursor (for desc order)
            };
        }

        // Always sort by ID descending for consistent pagination
        const orderBy = { id: 'desc' as const };

        const sessions = await db.session.findMany({
            where,
            orderBy,
            take: limit + 1, // Fetch one extra to determine if there are more
            select: {
                id: true,
                seq: true,
                createdAt: true,
                updatedAt: true,
                metadata: true,
                metadataVersion: true,
                agentState: true,
                agentStateVersion: true,
                active: true,
                lastActiveAt: true,
            }
        });

        // Check if there are more results
        const hasNext = sessions.length > limit;
        const resultSessions = hasNext ? sessions.slice(0, limit) : sessions;

        // Generate next cursor - simple ID-based cursor
        let nextCursor: string | null = null;
        if (hasNext && resultSessions.length > 0) {
            const lastSession = resultSessions[resultSessions.length - 1];
            nextCursor = `cursor_v1_${lastSession.id}`;
        }

        return reply.send({
            sessions: resultSessions.map((v) => ({
                id: v.id,
                seq: v.seq,
                createdAt: v.createdAt.getTime(),
                updatedAt: v.updatedAt.getTime(),
                active: v.active,
                activeAt: v.lastActiveAt.getTime(),
                metadata: v.metadata,
                metadataVersion: v.metadataVersion,
                agentState: v.agentState,
                agentStateVersion: v.agentStateVersion,
            })),
            nextCursor,
            hasNext
        });
    });

    // Create or load session by tag
    typed.post('/v1/sessions', {
        schema: {
            body: z.object({
                tag: z.string(),
                metadata: z.string(),
                agentState: z.string().nullish()
            })
        },
        preHandler: app.authenticate
    }, async (request, reply) => {
        const userId = request.userId;
        const { tag, metadata } = request.body;

        const session = await db.session.findFirst({
            where: {
                accountId: userId,
                tag: tag
            }
        });
        if (session) {
            logger.info({ module: 'session-create', sessionId: session.id, userId, tag }, `Found existing session: ${session.id} for tag ${tag}`);
            return reply.send({
                session: {
                    id: session.id,
                    seq: session.seq,
                    metadata: session.metadata,
                    metadataVersion: session.metadataVersion,
                    agentState: session.agentState,
                    agentStateVersion: session.agentStateVersion,
                    active: session.active,
                    activeAt: session.lastActiveAt.getTime(),
                    createdAt: session.createdAt.getTime(),
                    updatedAt: session.updatedAt.getTime(),
                    lastMessage: null
                }
            });
        } else {

            // Resolve seq
            const updSeq = await allocateUserSeq(userId);

            // Create session
            logger.info({ module: 'session-create', userId, tag }, `Creating new session for user ${userId} with tag ${tag}`);
            const session = await db.session.create({
                data: {
                    accountId: userId,
                    tag: tag,
                    metadata: metadata
                }
            });
            logger.info({ module: 'session-create', sessionId: session.id, userId }, `Session created: ${session.id}`);

            // Emit new session update
            const updatePayload = buildNewSessionUpdate(session, updSeq, randomKeyNaked(12));
            logger.info({
                module: 'session-create',
                userId,
                sessionId: session.id,
                updateType: 'new-session',
                updatePayload: JSON.stringify(updatePayload)
            }, `Emitting new-session update to all user connections`);
            eventRouter.emitUpdate({
                userId,
                payload: updatePayload,
                recipientFilter: { type: 'all-user-authenticated-connections' }
            });

            return reply.send({
                session: {
                    id: session.id,
                    seq: session.seq,
                    metadata: session.metadata,
                    metadataVersion: session.metadataVersion,
                    agentState: session.agentState,
                    agentStateVersion: session.agentStateVersion,
                    active: session.active,
                    activeAt: session.lastActiveAt.getTime(),
                    createdAt: session.createdAt.getTime(),
                    updatedAt: session.updatedAt.getTime(),
                    lastMessage: null
                }
            });
        }
    });




    typed.get('/v1/account/profile', {
        preHandler: app.authenticate,
    }, async (request, reply) => {
        const userId = request.userId;
        const user = await db.account.findUniqueOrThrow({
            where: { id: userId },
            select: {
                firstName: true,
                lastName: true
            }
        });
        return reply.send({
            id: userId,
            timestamp: Date.now(),
            firstName: user.firstName,
            lastName: user.lastName,
            github: null // Single-user mode: GitHub integration disabled
        });
    });

    // Get Account Settings API
    typed.get('/v1/account/settings', {
        preHandler: app.authenticate,
        schema: {
            response: {
                200: z.object({
                    settings: z.string().nullable(),
                    settingsVersion: z.number()
                }),
                500: z.object({
                    error: z.literal('Failed to get account settings')
                })
            }
        }
    }, async (request, reply) => {
        try {
            // Single-user mode: Return default settings
            return reply.send({
                settings: null, // No custom settings in single-user mode
                settingsVersion: 0 // Always version 0 in single-user mode
            });
        } catch (error) {
            return reply.code(500).send({ error: 'Failed to get account settings' });
        }
    });

    // Update Account Settings API
    typed.post('/v1/account/settings', {
        schema: {
            body: z.object({
                settings: z.string().nullable(),
                expectedVersion: z.number().int().min(0)
            }),
            response: {
                200: z.union([z.object({
                    success: z.literal(true),
                    version: z.number()
                }), z.object({
                    success: z.literal(false),
                    error: z.literal('version-mismatch'),
                    currentVersion: z.number(),
                    currentSettings: z.string().nullable()
                })]),
                500: z.object({
                    success: z.literal(false),
                    error: z.literal('Failed to update account settings')
                })
            }
        },
        preHandler: app.authenticate
    }, async (request, reply) => {
        try {
            // Single-user mode: Accept settings updates but don't persist them
            // Always return success with incremented version
            const { expectedVersion } = request.body;
            return reply.send({
                success: true,
                version: expectedVersion + 1
            });
        } catch (error) {
            log({ module: 'api', level: 'error' }, `Failed to update account settings: ${error}`);
            return reply.code(500).send({
                success: false,
                error: 'Failed to update account settings'
            });
        }
    });

    // Single-user mode: Usage reporting removed

    // Messages API
    typed.get('/v1/sessions/:sessionId/messages', {
        schema: {
            params: z.object({
                sessionId: z.string()
            })
        },
        preHandler: app.authenticate
    }, async (request, reply) => {
        const userId = request.userId;
        const { sessionId } = request.params;

        // Verify session belongs to user
        const session = await db.session.findFirst({
            where: {
                id: sessionId,
                accountId: userId
            }
        });

        if (!session) {
            return reply.code(404).send({ error: 'Session not found' });
        }

        const messages = await db.sessionMessage.findMany({
            where: { sessionId },
            orderBy: { createdAt: 'desc' },
            take: 150,
            select: {
                id: true,
                seq: true,
                localId: true,
                content: true,
                createdAt: true,
                updatedAt: true
            }
        });

        return reply.send({
            messages: messages.map((v) => ({
                id: v.id,
                seq: v.seq,
                content: v.content,
                localId: v.localId,
                createdAt: v.createdAt.getTime(),
                updatedAt: v.updatedAt.getTime()
            }))
        });
    });

    // Machines

    // POST /v1/machines - Create machine or return existing
    typed.post('/v1/machines', {
        preHandler: app.authenticate,
        schema: {
            body: z.object({
                id: z.string(),
                metadata: z.string(), // Encrypted metadata
                daemonState: z.string().optional() // Encrypted daemon state
            })
        }
    }, async (request, reply) => {
        const userId = request.userId;
        const { id, metadata, daemonState } = request.body;

        // Check if machine exists (like sessions do)
        const machine = await db.machine.findFirst({
            where: {
                accountId: userId,
                id: id
            }
        });

        if (machine) {
            // Machine exists - just return it
            logger.info({ module: 'machines', machineId: id, userId }, 'Found existing machine');
            return reply.send({
                machine: {
                    id: machine.id,
                    metadata: machine.metadata,
                    metadataVersion: machine.metadataVersion,
                    daemonState: machine.daemonState,
                    daemonStateVersion: machine.daemonStateVersion,
                    active: machine.active,
                    activeAt: machine.lastActiveAt.getTime(),  // Return as activeAt for API consistency
                    createdAt: machine.createdAt.getTime(),
                    updatedAt: machine.updatedAt.getTime()
                }
            });
        } else {
            // Create new machine
            logger.info({ module: 'machines', machineId: id, userId }, 'Creating new machine');

            const newMachine = await db.machine.create({
                data: {
                    id,
                    accountId: userId,
                    metadata,
                    metadataVersion: 1,
                    daemonState: daemonState || null,
                    daemonStateVersion: daemonState ? 1 : 0,
                    // Default to offline - in case the user does not start daemon
                    active: false,
                    // lastActiveAt and activeAt defaults to now() in schema
                }
            });

            // Emit update for new machine
            const updSeq = await allocateUserSeq(userId);
            const machineMetadata = {
                version: 1,
                value: metadata
            };
            const updatePayload = buildUpdateMachineUpdate(newMachine.id, updSeq, randomKeyNaked(12), machineMetadata);
            eventRouter.emitUpdate({
                userId,
                payload: updatePayload
            });

            return reply.send({
                machine: {
                    id: newMachine.id,
                    metadata: newMachine.metadata,
                    metadataVersion: newMachine.metadataVersion,
                    daemonState: newMachine.daemonState,
                    daemonStateVersion: newMachine.daemonStateVersion,
                    active: newMachine.active,
                    activeAt: newMachine.lastActiveAt.getTime(),  // Return as activeAt for API consistency
                    createdAt: newMachine.createdAt.getTime(),
                    updatedAt: newMachine.updatedAt.getTime()
                }
            });
        }
    });


    // Machines API
    typed.get('/v1/machines', {
        preHandler: app.authenticate,
    }, async (request, reply) => {
        const userId = request.userId;

        const machines = await db.machine.findMany({
            where: { accountId: userId },
            orderBy: { lastActiveAt: 'desc' }
        });

        return machines.map(m => ({
            id: m.id,
            metadata: m.metadata,
            metadataVersion: m.metadataVersion,
            daemonState: m.daemonState,
            daemonStateVersion: m.daemonStateVersion,
            seq: m.seq,
            active: m.active,
            activeAt: m.lastActiveAt.getTime(),
            createdAt: m.createdAt.getTime(),
            updatedAt: m.updatedAt.getTime()
        }));
    });

    // GET /v1/machines/:id - Get single machine by ID
    typed.get('/v1/machines/:id', {
        preHandler: app.authenticate,
        schema: {
            params: z.object({
                id: z.string()
            })
        }
    }, async (request, reply) => {
        const userId = request.userId;
        const { id } = request.params;

        const machine = await db.machine.findFirst({
            where: {
                accountId: userId,
                id: id
            }
        });

        if (!machine) {
            return reply.code(404).send({ error: 'Machine not found' });
        }

        return {
            machine: {
                id: machine.id,
                metadata: machine.metadata,
                metadataVersion: machine.metadataVersion,
                daemonState: machine.daemonState,
                daemonStateVersion: machine.daemonStateVersion,
                seq: machine.seq,
                active: machine.active,
                activeAt: machine.lastActiveAt.getTime(),
                createdAt: machine.createdAt.getTime(),
                updatedAt: machine.updatedAt.getTime()
            }
        };
    });

    // Combined logging endpoint (only when explicitly enabled)
    if (process.env.DANGEROUSLY_LOG_TO_SERVER_FOR_AI_AUTO_DEBUGGING) {
        typed.post('/logs-combined-from-cli-and-mobile-for-simple-ai-debugging', {
            schema: {
                body: z.object({
                    timestamp: z.string(),
                    level: z.string(),
                    message: z.string(),
                    messageRawObject: z.any().optional(),
                    source: z.enum(['mobile', 'cli']),
                    platform: z.string().optional()
                })
            }
        }, async (request, reply) => {
            const { timestamp, level, message, source, platform } = request.body;

            // Log ONLY to separate remote logger (file only, no console)
            const logData = {
                source,
                platform,
                timestamp
            };

            // Use the file-only logger if available
            const { fileConsolidatedLogger } = await import('@/utils/log');

            if (!fileConsolidatedLogger) {
                // Should never happen since we check env var above, but be safe
                return reply.send({ success: true });
            }

            switch (level.toLowerCase()) {
                case 'error':
                    fileConsolidatedLogger.error(logData, message);
                    break;
                case 'warn':
                case 'warning':
                    fileConsolidatedLogger.warn(logData, message);
                    break;
                case 'debug':
                    fileConsolidatedLogger.debug(logData, message);
                    break;
                default:
                    fileConsolidatedLogger.info(logData, message);
            }

            return reply.send({ success: true });
        });
    }

    // Catch-all route for debugging 404s
    app.setNotFoundHandler((request, reply) => {
        log({ module: '404-handler' }, `404 - Method: ${request.method}, Path: ${request.url}, Headers: ${JSON.stringify(request.headers)}`);
        reply.code(404).send({ error: 'Not found', path: request.url, method: request.method });
    });

    // Start
    const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3005;
    await app.listen({ port, host: '0.0.0.0' });

    // Socket IO - Create after server is listening
    if (!app.server) {
        throw new Error('Fastify server not available');
    }

    const io = new Server(app.server, {
        cors: {
            origin: "*",
            methods: ["GET", "POST", "OPTIONS"],
            credentials: true,
            allowedHeaders: ["*"]
        },
        transports: ['websocket', 'polling'],
        pingTimeout: 45000,
        pingInterval: 15000,
        path: '/v1/updates',
        allowUpgrades: true,
        upgradeTimeout: 10000,
        connectTimeout: 20000,
        serveClient: false // Don't serve the client files
    });

    // Connection tracking is now handled by EventRouter

    // Track RPC listeners: Map<userId, Map<rpcMethodWithSessionPrefix, Socket>>
    // Only session-scoped clients (CLI) register handlers, only user-scoped clients (mobile) call them
    const rpcListeners = new Map<string, Map<string, Socket>>();

    io.on("connection", async (socket) => {
        log({ module: 'websocket' }, `New connection attempt from socket: ${socket.id}`);
        // Single-user mode: extract connection parameters (no token required)
        const clientType = socket.handshake.auth.clientType as 'session-scoped' | 'user-scoped' | 'machine-scoped' | undefined;
        const sessionId = socket.handshake.auth.sessionId as string | undefined;
        const machineId = socket.handshake.auth.machineId as string | undefined;

        // Validate session-scoped clients have sessionId
        if (clientType === 'session-scoped' && !sessionId) {
            log({ module: 'websocket' }, `Session-scoped client missing sessionId`);
            socket.emit('error', { message: 'Session ID required for session-scoped clients' });
            socket.disconnect();
            return;
        }

        // Validate machine-scoped clients have machineId
        if (clientType === 'machine-scoped' && !machineId) {
            log({ module: 'websocket' }, `Machine-scoped client missing machineId`);
            socket.emit('error', { message: 'Machine ID required for machine-scoped clients' });
            socket.disconnect();
            return;
        }

        // Single-user mode: use fixed default user
        const userId = 'default-user';
        log({ module: 'websocket' }, `Single-user connection: ${userId}, clientType: ${clientType || 'user-scoped'}, sessionId: ${sessionId || 'none'}, machineId: ${machineId || 'none'}, socketId: ${socket.id}`);

        // Store connection based on type
        const metadata = { clientType: clientType || 'user-scoped', sessionId, machineId };
        let connection: ClientConnection;
        if (metadata.clientType === 'session-scoped' && sessionId) {
            connection = {
                connectionType: 'session-scoped',
                socket,
                userId,
                sessionId
            };
        } else if (metadata.clientType === 'machine-scoped' && machineId) {
            connection = {
                connectionType: 'machine-scoped',
                socket,
                userId,
                machineId
            };
        } else {
            connection = {
                connectionType: 'user-scoped',
                socket,
                userId
            };
        }
        eventRouter.addConnection(userId, connection);

        // Broadcast daemon online status
        if (connection.connectionType === 'machine-scoped') {
            // Broadcast daemon online
            const machineActivity = buildMachineActivityEphemeral(machineId!, true, Date.now());
            eventRouter.emitEphemeral({
                userId,
                payload: machineActivity,
                recipientFilter: { type: 'user-scoped-only' }
            });
        }

        // Lock
        const receiveMessageLock = new AsyncLock();
        const receiveUsageLock = new AsyncLock();

        socket.on('disconnect', () => {

            // Cleanup connections
            eventRouter.removeConnection(userId, connection);

            // Clean up RPC listeners for this socket
            const userRpcMap = rpcListeners.get(userId);
            if (userRpcMap) {
                // Remove all RPC methods registered by this socket
                const methodsToRemove: string[] = [];
                for (const [method, registeredSocket] of userRpcMap.entries()) {
                    if (registeredSocket === socket) {
                        methodsToRemove.push(method);
                    }
                }

                if (methodsToRemove.length > 0) {
                    log({ module: 'websocket-rpc' }, `Cleaning up RPC methods on disconnect for socket ${socket.id}: ${methodsToRemove.join(', ')}`);
                    methodsToRemove.forEach(method => userRpcMap.delete(method));
                }

                if (userRpcMap.size === 0) {
                    rpcListeners.delete(userId);
                    log({ module: 'websocket-rpc' }, `All RPC listeners removed for user ${userId}`);
                }
            }

            log({ module: 'websocket' }, `User disconnected: ${userId}`);

            // Broadcast daemon offline status
            if (connection.connectionType === 'machine-scoped') {
                const machineActivity = buildMachineActivityEphemeral(connection.machineId, false, Date.now());
                eventRouter.emitEphemeral({
                    userId,
                    payload: machineActivity,
                    recipientFilter: { type: 'user-scoped-only' }
                });
            }
        });

        socket.on('session-alive', async (data: {
            sid: string;
            time: number;
            thinking?: boolean;
        }) => {
            try {
                // Track metrics

                // Basic validation
                if (!data || typeof data.time !== 'number' || !data.sid) {
                    return;
                }

                let t = data.time;
                if (t > Date.now()) {
                    t = Date.now();
                }
                if (t < Date.now() - 1000 * 60 * 10) {
                    return;
                }

                const { sid, thinking } = data;

                // Check session validity using cache
                const isValid = await activityCache.isSessionValid(sid, userId);
                if (!isValid) {
                    return;
                }

                // Queue database update (will only update if time difference is significant)
                activityCache.queueSessionUpdate(sid, t);

                // Emit session activity update
                const sessionActivity = buildSessionActivityEphemeral(sid, true, t, thinking || false);
                eventRouter.emitEphemeral({
                    userId,
                    payload: sessionActivity,
                    recipientFilter: { type: 'all-user-authenticated-connections' }
                });
            } catch (error) {
                log({ module: 'websocket', level: 'error' }, `Error in session-alive: ${error}`);
            }
        });

        socket.on('machine-alive', async (data: {
            machineId: string;
            time: number;
        }) => {
            try {
                // Track metrics

                // Basic validation
                if (!data || typeof data.time !== 'number' || !data.machineId) {
                    return;
                }

                let t = data.time;
                if (t > Date.now()) {
                    t = Date.now();
                }
                if (t < Date.now() - 1000 * 60 * 10) {
                    return;
                }

                // Check machine validity using cache
                const isValid = await activityCache.isMachineValid(data.machineId, userId);
                if (!isValid) {
                    return;
                }

                // Queue database update (will only update if time difference is significant)
                activityCache.queueMachineUpdate(data.machineId, t);

                const machineActivity = buildMachineActivityEphemeral(data.machineId, true, t);
                eventRouter.emitEphemeral({
                    userId,
                    payload: machineActivity,
                    recipientFilter: { type: 'user-scoped-only' }
                });
            } catch (error) {
                log({ module: 'websocket', level: 'error' }, `Error in machine-alive: ${error}`);
            }
        });

        socket.on('session-end', async (data: {
            sid: string;
            time: number;
        }) => {
            try {
                const { sid, time } = data;
                let t = time;
                if (typeof t !== 'number') {
                    return;
                }
                if (t > Date.now()) {
                    t = Date.now();
                }
                if (t < Date.now() - 1000 * 60 * 10) { // Ignore if time is in the past 10 minutes
                    return;
                }

                // Resolve session
                const session = await db.session.findUnique({
                    where: { id: sid, accountId: userId }
                });
                if (!session) {
                    return;
                }

                // Update last active at
                await db.session.update({
                    where: { id: sid },
                    data: { lastActiveAt: new Date(t), active: false }
                });

                // Emit session activity update
                const sessionActivity = buildSessionActivityEphemeral(sid, false, t, false);
                eventRouter.emitEphemeral({
                    userId,
                    payload: sessionActivity,
                    recipientFilter: { type: 'all-user-authenticated-connections' }
                });
            } catch (error) {
                log({ module: 'websocket', level: 'error' }, `Error in session-end: ${error}`);
            }
        });

        socket.on('message', async (data: any) => {
            await receiveMessageLock.inLock(async () => {
                try {
                    const { sid, message, localId } = data;

                    log({ module: 'websocket' }, `Received message from socket ${socket.id}: sessionId=${sid}, messageLength=${message.length} bytes, connectionType=${connection.connectionType}, connectionSessionId=${connection.connectionType === 'session-scoped' ? connection.sessionId : 'N/A'}`);

                    // Resolve session
                    const session = await db.session.findUnique({
                        where: { id: sid, accountId: userId }
                    });
                    if (!session) {
                        return;
                    }
                    let useLocalId = typeof localId === 'string' ? localId : null;

                    // Create plaintext message (single-user mode)
                    const msgContent = {
                        t: 'plain',
                        c: message
                    };

                    // Resolve seq
                    const updSeq = await allocateUserSeq(userId);
                    const msgSeq = await allocateSessionSeq(sid);

                    // Check if message already exists
                    if (useLocalId) {
                        const existing = await db.sessionMessage.findFirst({
                            where: { sessionId: sid, localId: useLocalId }
                        });
                        if (existing) {
                            return { msg: existing, update: null };
                        }
                    }

                    // Create message
                    const msg = await db.sessionMessage.create({
                        data: {
                            sessionId: sid,
                            seq: msgSeq,
                            content: msgContent,
                            localId: useLocalId
                        }
                    });

                    // Emit new message update to relevant clients
                    const updatePayload = buildNewMessageUpdate(msg, sid, updSeq, randomKeyNaked(12));
                    eventRouter.emitUpdate({
                        userId,
                        payload: updatePayload,
                        recipientFilter: { type: 'all-interested-in-session', sessionId: sid },
                        skipSenderConnection: connection
                    });
                } catch (error) {
                    log({ module: 'websocket', level: 'error' }, `Error in message handler: ${error}`);
                }
            });
        });

        socket.on('update-metadata', async (data: any, callback: (response: any) => void) => {
            try {
                const { sid, metadata, expectedVersion } = data;

                // Validate input
                if (!sid || typeof metadata !== 'string' || typeof expectedVersion !== 'number') {
                    if (callback) {
                        callback({ result: 'error' });
                    }
                    return;
                }

                // Resolve session
                const session = await db.session.findUnique({
                    where: { id: sid, accountId: userId }
                });
                if (!session) {
                    return;
                }

                // Check version
                if (session.metadataVersion !== expectedVersion) {
                    callback({ result: 'version-mismatch', version: session.metadataVersion, metadata: session.metadata });
                    return null;
                }

                // Update metadata
                const { count } = await db.session.updateMany({
                    where: { id: sid, metadataVersion: expectedVersion },
                    data: {
                        metadata: metadata,
                        metadataVersion: expectedVersion + 1
                    }
                });
                if (count === 0) {
                    callback({ result: 'version-mismatch', version: session.metadataVersion, metadata: session.metadata });
                    return null;
                }

                // Generate session metadata update
                const updSeq = await allocateUserSeq(userId);
                const metadataUpdate = {
                    value: metadata,
                    version: expectedVersion + 1
                };
                const updatePayload = buildUpdateSessionUpdate(sid, updSeq, randomKeyNaked(12), metadataUpdate);
                eventRouter.emitUpdate({
                    userId,
                    payload: updatePayload,
                    recipientFilter: { type: 'all-interested-in-session', sessionId: sid }
                });

                // Send success response with new version via callback
                callback({ result: 'success', version: expectedVersion + 1, metadata: metadata });
            } catch (error) {
                log({ module: 'websocket', level: 'error' }, `Error in update-metadata: ${error}`);
                if (callback) {
                    callback({ result: 'error' });
                }
            }
        });

        socket.on('update-state', async (data: any, callback: (response: any) => void) => {
            try {
                const { sid, agentState, expectedVersion } = data;

                // Validate input
                if (!sid || (typeof agentState !== 'string' && agentState !== null) || typeof expectedVersion !== 'number') {
                    if (callback) {
                        callback({ result: 'error' });
                    }
                    return;
                }

                // Resolve session
                const session = await db.session.findUnique({
                    where: {
                        id: sid,
                        accountId: userId
                    }
                });
                if (!session) {
                    callback({ result: 'error' });
                    return null;
                }

                // Check version
                if (session.agentStateVersion !== expectedVersion) {
                    callback({ result: 'version-mismatch', version: session.agentStateVersion, agentState: session.agentState });
                    return null;
                }

                // Update agent state
                const { count } = await db.session.updateMany({
                    where: { id: sid, agentStateVersion: expectedVersion },
                    data: {
                        agentState: agentState,
                        agentStateVersion: expectedVersion + 1
                    }
                });
                if (count === 0) {
                    callback({ result: 'version-mismatch', version: session.agentStateVersion, agentState: session.agentState });
                    return null;
                }

                // Generate session agent state update
                const updSeq = await allocateUserSeq(userId);
                const agentStateUpdate = {
                    value: agentState,
                    version: expectedVersion + 1
                };
                const updatePayload = buildUpdateSessionUpdate(sid, updSeq, randomKeyNaked(12), undefined, agentStateUpdate);
                eventRouter.emitUpdate({
                    userId,
                    payload: updatePayload,
                    recipientFilter: { type: 'all-interested-in-session', sessionId: sid }
                });

                // Send success response with new version via callback
                callback({ result: 'success', version: expectedVersion + 1, agentState: agentState });
            } catch (error) {
                log({ module: 'websocket', level: 'error' }, `Error in update-state: ${error}`);
                if (callback) {
                    callback({ result: 'error' });
                }
            }
        });

        // Machine metadata update with optimistic concurrency control
        socket.on('machine-update-metadata', async (data: any, callback: (response: any) => void) => {
            try {
                const { machineId, metadata, expectedVersion } = data;

                // Validate input
                if (!machineId || typeof metadata !== 'string' || typeof expectedVersion !== 'number') {
                    if (callback) {
                        callback({ result: 'error', message: 'Invalid parameters' });
                    }
                    return;
                }

                // Resolve machine
                const machine = await db.machine.findFirst({
                    where: {
                        accountId: userId,
                        id: machineId
                    }
                });
                if (!machine) {
                    if (callback) {
                        callback({ result: 'error', message: 'Machine not found' });
                    }
                    return;
                }

                // Check version
                if (machine.metadataVersion !== expectedVersion) {
                    callback({
                        result: 'version-mismatch',
                        version: machine.metadataVersion,
                        metadata: machine.metadata
                    });
                    return;
                }

                // Update metadata with atomic version check
                const { count } = await db.machine.updateMany({
                    where: {
                        accountId: userId,
                        id: machineId,
                        metadataVersion: expectedVersion  // Atomic CAS
                    },
                    data: {
                        metadata: metadata,
                        metadataVersion: expectedVersion + 1
                        // NOT updating active or lastActiveAt here
                    }
                });

                if (count === 0) {
                    // Re-fetch current version
                    const current = await db.machine.findFirst({
                        where: {
                            accountId: userId,
                            id: machineId
                        }
                    });
                    callback({
                        result: 'version-mismatch',
                        version: current?.metadataVersion || 0,
                        metadata: current?.metadata
                    });
                    return;
                }

                // Generate machine metadata update
                const updSeq = await allocateUserSeq(userId);
                const metadataUpdate = {
                    value: metadata,
                    version: expectedVersion + 1
                };
                const updatePayload = buildUpdateMachineUpdate(machineId, updSeq, randomKeyNaked(12), metadataUpdate);
                eventRouter.emitUpdate({
                    userId,
                    payload: updatePayload,
                    recipientFilter: { type: 'all-user-authenticated-connections' }
                });

                // Send success response with new version
                callback({
                    result: 'success',
                    version: expectedVersion + 1,
                    metadata: metadata
                });
            } catch (error) {
                log({ module: 'websocket', level: 'error' }, `Error in machine-update-metadata: ${error}`);
                if (callback) {
                    callback({ result: 'error', message: 'Internal error' });
                }
            }
        });

        // Machine daemon state update with optimistic concurrency control
        socket.on('machine-update-state', async (data: any, callback: (response: any) => void) => {
            try {
                const { machineId, daemonState, expectedVersion } = data;

                // Validate input
                if (!machineId || typeof daemonState !== 'string' || typeof expectedVersion !== 'number') {
                    if (callback) {
                        callback({ result: 'error', message: 'Invalid parameters' });
                    }
                    return;
                }

                // Resolve machine
                const machine = await db.machine.findFirst({
                    where: {
                        accountId: userId,
                        id: machineId
                    }
                });
                if (!machine) {
                    if (callback) {
                        callback({ result: 'error', message: 'Machine not found' });
                    }
                    return;
                }

                // Check version
                if (machine.daemonStateVersion !== expectedVersion) {
                    callback({
                        result: 'version-mismatch',
                        version: machine.daemonStateVersion,
                        daemonState: machine.daemonState
                    });
                    return;
                }

                // Update daemon state with atomic version check
                const { count } = await db.machine.updateMany({
                    where: {
                        accountId: userId,
                        id: machineId,
                        daemonStateVersion: expectedVersion  // Atomic CAS
                    },
                    data: {
                        daemonState: daemonState,
                        daemonStateVersion: expectedVersion + 1,
                        active: true,
                        lastActiveAt: new Date()
                    }
                });

                if (count === 0) {
                    // Re-fetch current version
                    const current = await db.machine.findFirst({
                        where: {
                            accountId: userId,
                            id: machineId
                        }
                    });
                    callback({
                        result: 'version-mismatch',
                        version: current?.daemonStateVersion || 0,
                        daemonState: current?.daemonState
                    });
                    return;
                }

                // Generate machine daemon state update
                const updSeq = await allocateUserSeq(userId);
                const daemonStateUpdate = {
                    value: daemonState,
                    version: expectedVersion + 1
                };
                const updatePayload = buildUpdateMachineUpdate(machineId, updSeq, randomKeyNaked(12), undefined, daemonStateUpdate);
                eventRouter.emitUpdate({
                    userId,
                    payload: updatePayload,
                    recipientFilter: { type: 'all-user-authenticated-connections' }
                });

                // Send success response with new version
                callback({
                    result: 'success',
                    version: expectedVersion + 1,
                    daemonState: daemonState
                });
            } catch (error) {
                log({ module: 'websocket', level: 'error' }, `Error in machine-update-state: ${error}`);
                if (callback) {
                    callback({ result: 'error', message: 'Internal error' });
                }
            }
        });

        // RPC register - Register this socket as a listener for an RPC method
        socket.on('rpc-register', async (data: any) => {
            try {
                const { method } = data;

                if (!method || typeof method !== 'string') {
                    socket.emit('rpc-error', { type: 'register', error: 'Invalid method name' });
                    return;
                }

                // Get or create user's RPC map
                let userRpcMap = rpcListeners.get(userId);
                if (!userRpcMap) {
                    userRpcMap = new Map<string, Socket>();
                    rpcListeners.set(userId, userRpcMap);
                }

                // Check if method was already registered
                const previousSocket = userRpcMap.get(method);
                if (previousSocket && previousSocket !== socket) {
                    log({ module: 'websocket-rpc' }, `RPC method ${method} re-registered: ${previousSocket.id} -> ${socket.id}`);
                }

                // Register this socket as the listener for this method
                userRpcMap.set(method, socket);

                socket.emit('rpc-registered', { method });
                log({ module: 'websocket-rpc' }, `RPC method registered: ${method} on socket ${socket.id} (user: ${userId})`);
                log({ module: 'websocket-rpc' }, `Active RPC methods for user ${userId}: ${Array.from(userRpcMap.keys()).join(', ')}`);
            } catch (error) {
                log({ module: 'websocket', level: 'error' }, `Error in rpc-register: ${error}`);
                socket.emit('rpc-error', { type: 'register', error: 'Internal error' });
            }
        });

        // RPC unregister - Remove this socket as a listener for an RPC method
        socket.on('rpc-unregister', async (data: any) => {
            try {
                const { method } = data;

                if (!method || typeof method !== 'string') {
                    socket.emit('rpc-error', { type: 'unregister', error: 'Invalid method name' });
                    return;
                }

                const userRpcMap = rpcListeners.get(userId);
                if (userRpcMap && userRpcMap.get(method) === socket) {
                    userRpcMap.delete(method);
                    log({ module: 'websocket-rpc' }, `RPC method unregistered: ${method} from socket ${socket.id} (user: ${userId})`);

                    if (userRpcMap.size === 0) {
                        rpcListeners.delete(userId);
                        log({ module: 'websocket-rpc' }, `All RPC methods unregistered for user ${userId}`);
                    } else {
                        log({ module: 'websocket-rpc' }, `Remaining RPC methods for user ${userId}: ${Array.from(userRpcMap.keys()).join(', ')}`);
                    }
                } else {
                    log({ module: 'websocket-rpc' }, `RPC unregister ignored: ${method} not registered on socket ${socket.id}`);
                }

                socket.emit('rpc-unregistered', { method });
            } catch (error) {
                log({ module: 'websocket', level: 'error' }, `Error in rpc-unregister: ${error}`);
                socket.emit('rpc-error', { type: 'unregister', error: 'Internal error' });
            }
        });

        // RPC call - Call an RPC method on another socket of the same user
        socket.on('rpc-call', async (data: any, callback: (response: any) => void) => {
            try {
                const { method, params } = data;

                if (!method || typeof method !== 'string') {
                    if (callback) {
                        callback({
                            ok: false,
                            error: 'Invalid parameters: method is required'
                        });
                    }
                    return;
                }

                // Find the RPC listener for this method within the same user
                const userRpcMap = rpcListeners.get(userId);
                if (!userRpcMap) {
                    log({ module: 'websocket-rpc' }, `RPC call failed: No RPC methods registered for user ${userId}`);
                    if (callback) {
                        callback({
                            ok: false,
                            error: 'No RPC methods registered'
                        });
                    }
                    return;
                }

                const targetSocket = userRpcMap.get(method);
                if (!targetSocket || !targetSocket.connected) {
                    log({ module: 'websocket-rpc' }, `RPC call failed: Method ${method} not available (disconnected or not registered)`);
                    if (callback) {
                        callback({
                            ok: false,
                            error: 'RPC method not available'
                        });
                    }
                    return;
                }

                // Don't allow calling your own socket
                if (targetSocket === socket) {
                    log({ module: 'websocket-rpc' }, `RPC call failed: Attempted self-call on method ${method}`);
                    if (callback) {
                        callback({
                            ok: false,
                            error: 'Cannot call RPC on the same socket'
                        });
                    }
                    return;
                }

                // Log RPC call initiation
                const startTime = Date.now();
                log({ module: 'websocket-rpc' }, `RPC call initiated: ${socket.id} -> ${method} (target: ${targetSocket.id})`);

                // Forward the RPC request to the target socket using emitWithAck
                try {
                    const response = await targetSocket.timeout(30000).emitWithAck('rpc-request', {
                        method,
                        params
                    });

                    const duration = Date.now() - startTime;
                    log({ module: 'websocket-rpc' }, `RPC call succeeded: ${method} (${duration}ms)`);

                    // Forward the response back to the caller via callback
                    if (callback) {
                        callback({
                            ok: true,
                            result: response
                        });
                    }

                } catch (error) {
                    const duration = Date.now() - startTime;
                    const errorMsg = error instanceof Error ? error.message : 'RPC call failed';
                    log({ module: 'websocket-rpc' }, `RPC call failed: ${method} - ${errorMsg} (${duration}ms)`);

                    // Timeout or error occurred
                    if (callback) {
                        callback({
                            ok: false,
                            error: errorMsg
                        });
                    }
                }
            } catch (error) {
                log({ module: 'websocket', level: 'error' }, `Error in rpc-call: ${error}`);
                if (callback) {
                    callback({
                        ok: false,
                        error: 'Internal error'
                    });
                }
            }
        });

        socket.on('ping', async (callback: (response: any) => void) => {
            try {
                callback({});
            } catch (error) {
                log({ module: 'websocket', level: 'error' }, `Error in ping: ${error}`);
            }
        });

        // Single-user mode: Usage reporting removed

        socket.emit('auth', { success: true, user: userId });
        log({ module: 'websocket' }, `User connected: ${userId}`);
    });

    // End
    log({}, 'API ready on port http://localhost:' + port);

    onShutdown('api', async () => {
        await app.close();
    });
    onShutdown('api', async () => {
        await io.close();
    });

    return { app: app as unknown as FastifyInstance, io };
}