export interface AccessListUser {
  id: string;
  username: string;
}

export interface AccessListIpRule {
  id: string;
  address: string;
  action: "allow" | "deny";
  sortOrder: number;
}

export interface AccessListWithRelations {
  id: string;
  name: string;
  authEnabled: boolean;
  authRealm: string;
  defaultAction: "allow" | "deny";
  authUsers: AccessListUser[];
  ipRules: AccessListIpRule[];
  proxyHosts: { id: string; domain: string }[];
  redirectHosts: { id: string; sourceDomain: string }[];
  streamHosts: { id: string; name: string }[];
  createdAt: string;
  updatedAt: string;
}
