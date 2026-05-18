import { AsyncLocalStorage } from 'node:async_hooks';
import crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';

interface RequestContext {
    requestId: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export const getRequestId = (): string | undefined => storage.getStore()?.requestId;

export const requestContextMiddleware = (req: Request, res: Response, next: NextFunction) => {
    // Honour an upstream-supplied id if it looks safe; otherwise mint a fresh one
    // so every request is traceable end-to-end.
    const headerId = req.header('x-request-id');
    const requestId = headerId && /^[a-zA-Z0-9_-]{1,128}$/.test(headerId) ? headerId : crypto.randomUUID();
    res.setHeader('x-request-id', requestId);
    storage.run({ requestId }, () => next());
};
