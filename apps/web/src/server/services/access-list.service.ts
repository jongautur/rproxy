import { writeFile, unlink } from "fs/promises";
import path from "path";
import { prisma } from "@/lib/prisma";
import { nginxHelper, hashPasswordApr1 } from "@/server/system/exec";
import { redeployProxy } from "@/server/services/proxy.service";

const STAGING_DIR = "/var/lib/rproxy/staging";

export function isValidIpOrCidr(address: string): boolean {
  const ipv4 = /^((25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(25[0-5]|2[0-4]\d|[01]?\d\d?)(\/([012]?\d|3[012]))?$/;
  return ipv4.test(address) || address === "all";
}

export function isValidHtpasswdUsername(username: string): boolean {
  return /^[a-zA-Z0-9._@-]{1,64}$/.test(username);
}

export async function listAccessLists() {
  return prisma.accessList.findMany({
    include: {
      authUsers: { select: { id: true, username: true } },
      ipRules: { orderBy: { sortOrder: "asc" } },
      proxyHosts: { select: { id: true, domain: true } },
    },
    orderBy: { name: "asc" },
  });
}

export async function getAccessList(id: string) {
  return prisma.accessList.findUniqueOrThrow({
    where: { id },
    include: {
      authUsers: { select: { id: true, username: true } },
      ipRules: { orderBy: { sortOrder: "asc" } },
      proxyHosts: { select: { id: true, domain: true } },
    },
  });
}

async function deployHtpasswd(listId: string): Promise<void> {
  const list = await prisma.accessList.findUniqueOrThrow({
    where: { id: listId },
    include: { authUsers: true },
  });

  if (!list.authEnabled || list.authUsers.length === 0) return;

  await nginxHelper("mkdir-access-lists");

  const content = list.authUsers.map((u) => `${u.username}:${u.passwordHash}`).join("\n") + "\n";
  const stagingPath = path.join(STAGING_DIR, `${listId}.htpasswd`);
  await writeFile(stagingPath, content, "utf-8");
  await nginxHelper("deploy-htpasswd", listId);
  await unlink(stagingPath).catch(() => {});
}

export async function createAccessList(data: {
  name: string;
  authEnabled: boolean;
  authRealm: string;
  users: { username: string; password: string }[];
  ipRules: { address: string; action: string; sortOrder: number }[];
}) {
  const hashed = await Promise.all(
    data.users.map(async (u) => ({
      username: u.username,
      passwordHash: await hashPasswordApr1(u.password),
    }))
  );

  const list = await prisma.accessList.create({
    data: {
      name: data.name,
      authEnabled: data.authEnabled,
      authRealm: data.authRealm,
      authUsers: { create: hashed },
      ipRules: {
        create: data.ipRules.map((r, i) => ({
          address: r.address,
          action: r.action,
          sortOrder: r.sortOrder ?? i,
        })),
      },
    },
    include: {
      authUsers: { select: { id: true, username: true } },
      ipRules: { orderBy: { sortOrder: "asc" } },
      proxyHosts: { select: { id: true, domain: true } },
    },
  });

  if (list.authEnabled && list.authUsers.length > 0) {
    await deployHtpasswd(list.id);
  }

  return list;
}

export async function updateAccessList(
  id: string,
  data: {
    name?: string;
    authEnabled?: boolean;
    authRealm?: string;
    addUsers?: { username: string; password: string }[];
    deleteUserIds?: string[];
    ipRules?: { address: string; action: string; sortOrder: number }[];
  }
) {
  if (data.addUsers?.length) {
    const hashed = await Promise.all(
      data.addUsers.map(async (u) => ({
        username: u.username,
        passwordHash: await hashPasswordApr1(u.password),
        accessListId: id,
      }))
    );
    await prisma.accessListUser.createMany({ data: hashed, skipDuplicates: true });
  }

  if (data.deleteUserIds?.length) {
    await prisma.accessListUser.deleteMany({
      where: { id: { in: data.deleteUserIds }, accessListId: id },
    });
  }

  if (data.ipRules !== undefined) {
    await prisma.accessListIpRule.deleteMany({ where: { accessListId: id } });
    if (data.ipRules.length > 0) {
      await prisma.accessListIpRule.createMany({
        data: data.ipRules.map((r, i) => ({
          accessListId: id,
          address: r.address,
          action: r.action,
          sortOrder: r.sortOrder ?? i,
        })),
      });
    }
  }

  const updated = await prisma.accessList.update({
    where: { id },
    data: {
      ...(data.name !== undefined && { name: data.name }),
      ...(data.authEnabled !== undefined && { authEnabled: data.authEnabled }),
      ...(data.authRealm !== undefined && { authRealm: data.authRealm }),
    },
    include: {
      authUsers: { select: { id: true, username: true } },
      ipRules: { orderBy: { sortOrder: "asc" } },
      proxyHosts: { select: { id: true, domain: true } },
    },
  });

  await deployHtpasswd(id).catch(() => {});

  for (const { id: proxyId } of updated.proxyHosts) {
    await redeployProxy(proxyId).catch(() => {});
  }

  return updated;
}

export async function deleteAccessList(id: string): Promise<void> {
  const affected = await prisma.proxyHost.findMany({
    where: { accessListId: id },
    select: { id: true },
  });

  await prisma.accessList.delete({ where: { id } });
  await nginxHelper("remove-htpasswd", id).catch(() => {});

  for (const { id: proxyId } of affected) {
    await redeployProxy(proxyId).catch(() => {});
  }
}
