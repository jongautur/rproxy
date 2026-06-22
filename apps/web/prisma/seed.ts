import { PrismaClient, Role } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const existingAdmin = await prisma.user.findFirst({
    where: { role: Role.ADMIN },
  });

  if (existingAdmin) {
    console.log("Admin user already exists — skipping seed");
    return;
  }

  const passwordHash = await bcrypt.hash("admin", 12);

  const admin = await prisma.user.create({
    data: {
      username: "admin",
      email: "admin@localhost",
      passwordHash,
      role: Role.ADMIN,
      mustChangePassword: true,
    },
  });

  await prisma.setting.createMany({
    data: [
      { key: "nginx_config_dir", value: "/etc/nginx/sites-available" },
      { key: "nginx_enabled_dir", value: "/etc/nginx/sites-enabled" },
      { key: "nginx_ssl_dir", value: "/etc/nginx/ssl" },
      { key: "acme_home", value: `${process.env.HOME}/.acme.sh` },
      { key: "acme_email", value: "admin@localhost" },
      { key: "health_check_interval_seconds", value: "30" },
    ],
    skipDuplicates: true,
  });

  console.log(`Created admin user: ${admin.username} (password: admin)`);
  console.log("IMPORTANT: Change the default password immediately after first login!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
