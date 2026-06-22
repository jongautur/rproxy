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
  authUsers: AccessListUser[];
  ipRules: AccessListIpRule[];
  proxyHosts: { id: string; domain: string }[];
  createdAt: string;
  updatedAt: string;
}
