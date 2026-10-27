import {z} from 'zod';
import {IdSchema,ModelIdSchema,StageSchema,ProjectStatusSchema,UtcSchema} from './검증.js';

const version=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const text=z.string().min(1).max(1000);
export const ProjectSummarySchema=z.strictObject({
 projectId:IdSchema,topic:text,stage:StageSchema,status:ProjectStatusSchema,updatedAt:UtcSchema,
 cardCount:version,activeRunId:IdSchema.nullable(),claudeModel:ModelIdSchema.nullable(),projectVersion:z.number().int().positive().optional(),deletionPending:z.boolean().optional(),deletionRequestId:IdSchema.optional()
});
export const ProjectListSchema=z.strictObject({projects:z.array(ProjectSummarySchema)});
export type ProjectSummary=z.infer<typeof ProjectSummarySchema>;
export type ProjectList=z.infer<typeof ProjectListSchema>;
export const ModelSelectionRequestSchema=z.strictObject({requestId:IdSchema,version,model:ModelIdSchema.nullable()});
export const ModelSelectionResponseSchema=z.strictObject({projectId:IdSchema,model:ModelIdSchema.nullable(),version,appliesTo:z.literal('next_run')});
export type ModelSelectionRequest=z.infer<typeof ModelSelectionRequestSchema>;
export type ModelSelectionResponse=z.infer<typeof ModelSelectionResponseSchema>;
export const DeleteProjectRequestSchema=z.strictObject({requestId:IdSchema,version:z.number().int().positive().max(Number.MAX_SAFE_INTEGER),confirm:z.literal(true)});
export const DeleteProjectResponseSchema=z.strictObject({projectId:IdSchema,deleted:z.literal(true)});
export type DeleteProjectRequest=z.infer<typeof DeleteProjectRequestSchema>;
export type DeleteProjectResponse=z.infer<typeof DeleteProjectResponseSchema>;

export const MetadataErrorCodeSchema=z.enum(['AUTH_PATH_FORBIDDEN','AUTH_MODE_UNKNOWN','METADATA_CLEANUP_UNCONFIRMED','METADATA_UNAVAILABLE']);
export type MetadataErrorCode=z.infer<typeof MetadataErrorCodeSchema>;
export const ModelCatalogSchema=z.strictObject({
 status:z.enum(['unknown','ready','error']),checkedAt:UtcSchema.nullable(),
 models:z.array(z.strictObject({value:ModelIdSchema,displayName:text,description:z.string().max(4000)})),error:text.nullable(),errorCode:MetadataErrorCodeSchema.optional()
});
export const QuotaMetricSchema=z.strictObject({id:text,label:text,remainingPercent:z.number().min(0).max(100).nullable(),resetsAt:UtcSchema.nullable(),scope:z.enum(['account','model','image']),source:text});
export const QuotaProviderSchema=z.strictObject({provider:z.enum(['claude','agy']),label:text,status:z.enum(['unknown','ready','error']),checkedAt:UtcSchema.nullable(),metrics:z.array(QuotaMetricSchema),message:text.nullable(),errorCode:MetadataErrorCodeSchema.optional()});
export const ProviderDashboardSchema=z.strictObject({refreshing:z.boolean(),models:ModelCatalogSchema,providers:z.array(QuotaProviderSchema)});
export const ProviderRefreshRequestSchema=z.strictObject({requestId:IdSchema});
export type ModelCatalog=z.infer<typeof ModelCatalogSchema>;
export type QuotaMetric=z.infer<typeof QuotaMetricSchema>;
export type QuotaProvider=z.infer<typeof QuotaProviderSchema>;
export type ProviderDashboard=z.infer<typeof ProviderDashboardSchema>;
export type ProviderReading=Pick<ProviderDashboard,'models'|'providers'>;
export interface ProviderService {
 status():ProviderDashboard;
 refresh(requestId:string):ProviderDashboard;
 assertModel(model:string|null):void;
 invalidate?():void;
 dispose():Promise<void>;
}
export interface WorkspaceClient {
 deleteProject(projectId:string,input:DeleteProjectRequest):Promise<DeleteProjectResponse>;
 listProjects():Promise<ProjectList>;
 setProjectModel(projectId:string,input:ModelSelectionRequest):Promise<ModelSelectionResponse>;
 providerStatus():Promise<ProviderDashboard>;
 refreshProviders(requestId:string):Promise<ProviderDashboard>;
}
