import {z} from 'zod';
export const ConnectionProviderSchema=z.enum(['claude','agy']);
export type ConnectionProvider=z.infer<typeof ConnectionProviderSchema>;
export const ConnectionStateSchema=z.object({
 provider:ConnectionProviderSchema,status:z.enum(['unknown','checking','connected','login_pending','logout_pending','login_required','error']),
 version:z.string().nullable(),authMethod:z.enum(['subscription','google_account','unknown']),
 checkedAt:z.iso.datetime().nullable(),lastActivityAt:z.iso.datetime().nullable(),message:z.string(),errorCode:z.string().nullable(),
 operationId:z.uuid().nullable(),loginUrl:z.url().nullable(),needsCode:z.boolean(),verification:z.enum(['not_checked','metadata']),
 accountId:z.string().email().max(320).nullable().optional(),externalConsole:z.boolean().optional(),autoConfirm:z.boolean().optional()
}).strict();
export type ConnectionState=z.infer<typeof ConnectionStateSchema>;
export const ConnectionListSchema=z.object({connections:z.array(ConnectionStateSchema)}).strict();
export type ConnectionList=z.infer<typeof ConnectionListSchema>;
export const ConnectionRequestSchema=z.object({requestId:z.uuid()}).strict();
export const ConnectionLogoutRequestSchema=ConnectionRequestSchema.extend({confirm:z.literal(true),expectedAccountId:z.string().email().max(320)});
export const ConnectionCancelRequestSchema=ConnectionRequestSchema.extend({operationId:z.uuid()});
export const ConnectionCodeRequestSchema=ConnectionCancelRequestSchema.extend({authorizationCode:z.string().min(1).max(4096).regex(/^[^\s\x00-\x1f\x7f]+$/)});
