import { prisma } from "@/lib/prisma";
import { redeployApi, type DeployResult } from "@/server/services/api-gateway/api.service";
import type { Api, ApiRoute, ApiRouteMethod } from "@prisma/client";
import type {
  ApiDocsSettingsFormData,
  ApiRouteDocsFormData,
  ApiDocsSummary,
  ApiDocsCoverage,
  MissingDocRoute,
  DocParameter,
  DocResponse,
} from "@/types/api-gateway";

// Per-route documentation metadata (title, description, parameters,
// examples, ...) never affects the nginx config generated for an Api — it's
// pure DB write, no redeploy (unlike route.service.ts's createRoute/
// updateRoute, which redeploy because path/method/upstream changes do
// matter to nginx). Api-level docsEnabled/docsPublic/docsSlug are the
// exception: they gate whether api-gateway-config.ts emits a `location = /`
// developer-portal block at all, so updateApiDocsSettings below DOES
// redeploy, same as api.service.ts's updateApi.

// A route "counts" for documentation purposes if it's flagged for inclusion
// AND has at minimum a title — an admin ticking "include in docs" alone
// isn't enough to call it documented, but requiring every field would make
// the coverage number too strict to be useful.
function isDocumented(route: Pick<ApiRoute, "docInclude" | "docSummary">): boolean {
  return route.docInclude && !!route.docSummary?.trim();
}

// Disabled routes are excluded from coverage by default — see
// Api.docsCountDisabledRoutes in schema.prisma.
function countsTowardCoverage(route: Pick<ApiRoute, "enabled">, countDisabled: boolean): boolean {
  return countDisabled || route.enabled;
}

export async function updateApiDocsSettings(
  apiId: string,
  data: Partial<ApiDocsSettingsFormData>,
  userId: string
): Promise<{ api: Api; deploy: DeployResult }> {
  if (data.docsSlug) {
    const existing = await prisma.api.findUnique({ where: { docsSlug: data.docsSlug } });
    if (existing && existing.id !== apiId) {
      throw new Error("This documentation slug is already in use by another API");
    }
  }

  const api = await prisma.api.update({ where: { id: apiId }, data });
  const deploy = await redeployApi(apiId);

  await prisma.auditLog.create({
    data: { userId, action: "UPDATE", entity: "ApiDocsSettings", entityId: apiId },
  });

  return { api, deploy };
}

export async function updateRouteDocs(
  apiId: string,
  routeId: string,
  data: Partial<ApiRouteDocsFormData>,
  userId: string
): Promise<ApiRoute> {
  const route = await prisma.apiRoute.update({
    where: { id: routeId },
    data: {
      ...data,
      docParameters: data.docParameters as object | undefined,
      docResponses: data.docResponses as object | undefined,
    },
  });

  await prisma.auditLog.create({
    data: { userId, action: "UPDATE", entity: "ApiRouteDocs", entityId: routeId, details: JSON.stringify({ apiId }) },
  });

  return route;
}

export async function getCoverage(apiId: string): Promise<ApiDocsCoverage> {
  const api = await prisma.api.findUniqueOrThrow({ where: { id: apiId } });
  const routes = await prisma.apiRoute.findMany({ where: { apiId }, orderBy: { path: "asc" } });

  const counted = routes.filter((r) => countsTowardCoverage(r, api.docsCountDisabledRoutes));
  const documented = counted.filter(isDocumented);
  const missing: MissingDocRoute[] = counted
    .filter((r) => !isDocumented(r))
    .map((r) => ({ routeId: r.id, path: r.path, methods: r.methods }));

  const totalRoutes = counted.length;
  const documentedRoutes = documented.length;

  return {
    totalRoutes,
    documentedRoutes,
    undocumentedRoutes: totalRoutes - documentedRoutes,
    coveragePercent: totalRoutes === 0 ? 0 : Math.round((documentedRoutes / totalRoutes) * 100),
    missing,
  };
}

export async function listDocsSummaries(): Promise<ApiDocsSummary[]> {
  const apis = await prisma.api.findMany({
    include: { routes: true },
    orderBy: { name: "asc" },
  });

  return apis.map((api) => {
    const counted = api.routes.filter((r) => countsTowardCoverage(r, api.docsCountDisabledRoutes));
    const documented = counted.filter(isDocumented);
    const totalRoutes = counted.length;
    const documentedRoutes = documented.length;

    return {
      apiId: api.id,
      apiName: api.name,
      apiDomain: api.domain,
      docsEnabled: api.docsEnabled,
      docsPublic: api.docsPublic,
      docsSlug: api.docsSlug,
      docsTitle: api.docsTitle,
      totalRoutes,
      documentedRoutes,
      undocumentedRoutes: totalRoutes - documentedRoutes,
      coveragePercent: totalRoutes === 0 ? 0 : Math.round((documentedRoutes / totalRoutes) * 100),
    };
  });
}

// ── OpenAPI generation ───────────────────────────────────────────────────────
// Renders the API Gateway's own config + doc metadata into an OpenAPI 3.1
// document from the CALLER's perspective only. Deliberately never touches
// upstreamHost/upstreamPort/upstreamScheme/upstreamPath/upstreamAuth* —
// those describe rproxy's private backend wiring, not anything a customer
// should see (see CLAUDE.md's API Gateway section).

interface OpenApiOperation {
  tags?: string[];
  summary?: string;
  description?: string;
  deprecated?: boolean;
  parameters?: Array<{ name: string; in: string; required: boolean; description?: string; schema: { type: string } }>;
  requestBody?: {
    description?: string;
    content: Record<string, { example?: unknown }>;
  };
  responses: Record<string, { description: string; content?: Record<string, { example?: unknown }> }>;
  security?: Array<Record<string, never[]>>;
}

const METHODS_WITH_BODY = new Set<ApiRouteMethod>(["POST", "PUT", "PATCH"]);

function tryParseJson(text: string | null | undefined): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text; // not JSON — pass through as a plain string example
  }
}

function buildOperation(
  api: Api,
  route: ApiRoute,
  method: ApiRouteMethod,
  parameters: DocParameter[],
  responses: DocResponse[]
): OpenApiOperation {
  const op: OpenApiOperation = {
    responses: {},
  };
  if (route.docCategory) op.tags = [route.docCategory];
  if (route.docSummary) op.summary = route.docSummary;
  if (route.docDescription) op.description = route.docDescription;
  if (route.docDeprecated) op.deprecated = true;

  if (parameters.length > 0) {
    op.parameters = parameters.map((p) => ({
      name: p.name,
      in: p.in,
      required: p.required,
      description: p.description,
      schema: { type: "string" },
    }));
  }

  if (METHODS_WITH_BODY.has(method) && (route.docRequestBodyDescription || route.docRequestBodyExample)) {
    op.requestBody = {
      description: route.docRequestBodyDescription || undefined,
      content: {
        "application/json": {
          example: tryParseJson(route.docRequestBodyExample),
        },
      },
    };
  }

  if (responses.length > 0) {
    for (const r of responses) {
      op.responses[r.status] = {
        description: r.description || r.status,
        ...(r.example ? { content: { "application/json": { example: tryParseJson(r.example) } } } : {}),
      };
    }
  } else {
    op.responses["200"] = { description: "Successful response" };
  }

  if (route.authRequired) {
    op.security = [{ ApiKeyAuth: [] }];
  }

  return op;
}

export interface OpenApiGenerationResult {
  spec: Record<string, unknown>;
  skippedAnyMethodRoutes: string[]; // paths skipped for lacking an explicit method choice
}

export async function generateOpenApiSpec(apiId: string): Promise<OpenApiGenerationResult> {
  const api = await prisma.api.findUniqueOrThrow({ where: { id: apiId }, include: { routes: { orderBy: { path: "asc" } } } });

  const scheme = api.sslEnabled ? "https" : "http";
  const isDefaultPort = (api.sslEnabled && api.httpsPort === 443) || (!api.sslEnabled && api.listenPort === 80);
  const port = api.sslEnabled ? api.httpsPort : api.listenPort;
  const serverUrl = `${scheme}://${api.domain}${isDefaultPort ? "" : `:${port}`}${api.basePath}`;

  const paths: Record<string, Record<string, OpenApiOperation>> = {};
  const skippedAnyMethodRoutes: string[] = [];

  for (const route of api.routes) {
    if (!route.docInclude || !route.enabled) continue;

    const effectiveMethods: ApiRouteMethod[] = route.methods.length > 0 ? route.methods : route.docAnyMethods;
    if (effectiveMethods.length === 0) {
      if (route.methods.length === 0) skippedAnyMethodRoutes.push(route.path);
      continue;
    }

    const parameters = ((route.docParameters as unknown as DocParameter[]) ?? []).filter(Boolean);
    const responses = ((route.docResponses as unknown as DocResponse[]) ?? []).filter(Boolean);

    const fullPath = (api.basePath === "/" ? "" : api.basePath) + (route.path === "/" ? "" : route.path) || "/";
    if (!paths[fullPath]) paths[fullPath] = {};

    for (const method of effectiveMethods) {
      paths[fullPath][method.toLowerCase()] = buildOperation(api, route, method, parameters, responses);
    }
  }

  const descriptionParts = [
    api.docsDescription,
    api.docsIntro && `## Getting Started\n\n${api.docsIntro}`,
    api.docsAuthContent && `## Authentication\n\n${api.docsAuthContent}`,
    api.docsErrorsContent && `## Common Errors\n\n${api.docsErrorsContent}`,
    api.docsNotes && `## Notes\n\n${api.docsNotes}`,
  ].filter(Boolean);

  const spec: Record<string, unknown> = {
    openapi: "3.1.0",
    info: {
      title: api.docsTitle || api.name,
      version: api.docsVersion || "1.0.0",
      ...(descriptionParts.length > 0 ? { description: descriptionParts.join("\n\n") } : {}),
    },
    servers: [{ url: serverUrl }],
    paths,
    components: {
      securitySchemes: {
        ApiKeyAuth: {
          type: "apiKey",
          in: "header",
          name: "X-Api-Key",
        },
      },
    },
  };

  return { spec, skippedAnyMethodRoutes };
}
