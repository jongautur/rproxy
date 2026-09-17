import type { Api, ApiRoute, Certificate, ApiRouteMethod, ProxyStatus, Customer, ApiKey, ApiAccess, ApiRouteAccess } from "@prisma/client";

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
}

export interface ApiWithRelations extends Api {
  certificate: Certificate | null;
  routes: ApiRoute[];
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

export type { ApiRouteMethod, ProxyStatus, ApiRouteAccess };
