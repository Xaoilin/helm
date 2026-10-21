import { observeEdgeHandler } from '../_shared/observability.ts';
import { handleRequest } from './handler.ts';

Deno.serve(observeEdgeHandler('sabah-one-employment-mcp', handleRequest));
