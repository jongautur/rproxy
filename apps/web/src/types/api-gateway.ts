import type { Api, ApiRoute, Certificate, ApiRouteMethod, ApiRouteAuthType, ProxyStatus, Customer, ApiKey, ApiAccess, ApiRouteAccess } from "@prisma/client";

export interface ApiFormData {
  name: string;
  domain: string;
  basePath?: string;
  description?: string;
  listenPort: number;
  httpsPort: number;
  sslEnabled: boolean;
  maxRequestsPerSecond?: number;
  maxBodySizeMb?: number;
  corsEnabled: boolean;
  certificateId?: string;
}

export interface ApiRouteFormData {
  path: string;
  methods: ApiRouteMethod[]; // empty = any method
  upstreamScheme: "http" | "https";
  upstreamHost: string;
  upstreamPort: number;
  upstreamPath?: string;
  authRequired: boolean;
  maxRequestsPerSecond?: number;
  enabled?: boolean;
  // Credential rproxy itself presents to the backend — see the schema
  // comment on ApiRoute. upstreamAuthValue is the plaintext secret: on
  // update, an empty/omitted value means "keep whatever's already stored",
  // never "clear it" (switch type to NONE to clear).
  upstreamAuthType?: ApiRouteAuthType;
  upstreamAuthHeaderName?: string;
  upstreamAuthValue?: string;
}

// The client-safe view of a route — never carries the encrypted upstream
// auth secret, only whether one is set (same "configured" pattern as the
// Cloudflare integration's apiToken).
export type ApiRoutePublic = Omit<ApiRoute, "upstreamAuthValueEncrypted"> & { upstreamAuthConfigured: boolean };

export interface ApiWithRelations extends Api {
  certificate: Certificate | null;
  routes: ApiRoutePublic[];
  _count?: { routes: number; access: number };
}

export interface CustomerFormData {
  name: string;
  email?: string;
  enabled: boolean;
  notes?: string;
}

// ApiKey minus keyHash — never send the hash to the client, even though it
// can't be reversed to the plaintext; there's no legitimate reason a
// browser response needs it.
export type ApiKeyPublic = Omit<ApiKey, "keyHash">;

// Returned exactly once, from the generate-key endpoint only.
export interface ApiKeyWithPlaintext {
  apiKey: ApiKeyPublic;
  plaintextKey: string;
}

export interface AccessLimitFormData {
  enabled: boolean;
  rateLimitOverride?: number;
  dailyQuota?: number;
  monthlyQuota?: number;
  // Date, not string — these types describe zod-parsed output
  // (z.coerce.date()), not the raw JSON request body.
  expiresAt?: Date;
}

export interface ApiAccessFormData extends AccessLimitFormData {
  apiId: string;
}

export interface ApiRouteAccessFormData extends AccessLimitFormData {
  routeId: string;
}

export interface ApiAccessWithApi extends ApiAccess {
  api: Pick<Api, "id" | "name" | "domain">;
}

export interface CustomerWithRelations extends Customer {
  apiKeys: ApiKeyPublic[];
  access: ApiAccessWithApi[];
  _count?: { apiKeys: number; access: number };
}

export interface KeyScopeRoute {
  routeId: string;
  path: string;
  apiName: string;
  // The route's OWN full method set (empty = any) — what's pickable below.
  routeMethods: string[];
  // This key's chosen subset for the route; empty = inherit routeMethods
  // in full (the default).
  methods: string[];
}

export interface KeyScope {
  scopeRestricted: boolean;
  routes: KeyScopeRoute[];
}

// Routes available to pick from when scoping a key — one Api's granted
// routes, fetched per ApiAccess grant the customer holds (see
// customer-keys-editor.tsx).
export interface ScopableApi {
  apiId: string;
  apiName: string;
  routes: { id: string; path: string; methods: string[] }[];
}

// ── Documentation ─────────────────────────────────────────────────────────
export interface DocParameter {
  name: string;
  in: "query" | "path" | "header";
  required: boolean;
  description?: string;
}

export interface DocResponse {
  status: string;
  description?: string;
  example?: string;
}

export interface ApiDocsSettingsFormData {
  docsEnabled: boolean;
  docsTitle?: string;
  docsDescription?: string;
  docsVersion?: string;
  docsIntro?: string;
  docsAuthContent?: string;
  docsErrorsContent?: string;
  docsNotes?: string;
  docsPublic: boolean;
  docsSlug?: string;
  docsLogoUrl?: string;
  docsCountDisabledRoutes: boolean;
}

export interface ApiRouteDocsFormData {
  docInclude: boolean;
  docSummary?: string;
  docDescription?: string;
  docCategory?: string;
  docDeprecated: boolean;
  docParameters: DocParameter[];
  docRequestBodyDescription?: string;
  docRequestBodyExample?: string;
  docResponses: DocResponse[];
  docNotes?: string;
  docAnyMethods: ApiRouteMethod[];
}

// One dashboard card on the Docs tab.
export interface ApiDocsSummary {
  apiId: string;
  apiName: string;
  apiDomain: string;
  docsEnabled: boolean;
  docsPublic: boolean;
  docsSlug: string | null;
  docsTitle: string | null;
  totalRoutes: number;
  documentedRoutes: number;
  undocumentedRoutes: number;
  coveragePercent: number;
}

export interface MissingDocRoute {
  routeId: string;
  path: string;
  methods: string[];
}

export interface ApiDocsCoverage {
  totalRoutes: number;
  documentedRoutes: number;
  undocumentedRoutes: number;
  coveragePercent: number;
  missing: MissingDocRoute[];
}

export type { ApiRouteMethod, ApiRouteAuthType, ProxyStatus, ApiRouteAccess };
